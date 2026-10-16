-- Tracking email e prova di invio, sul modello del CRM di Athlon.
--
-- Tre pezzi:
--
-- 1. `email_inviate`: ogni email che il CRM manda, con il testo integrale,
--    l'X-Message-Id di SendGrid (la chiave con cui tornano gli eventi), il
--    socio e il voucher a cui si riferisce, e chi l'ha fatta partire. La
--    scrivono lib/email.ts (pannello) e le edge function che inviano.
--
-- 2. `email_eventi`: gli esiti che SendGrid comunica con l'Event Webhook
--    (presa in carico, consegna, apertura, click, rimbalzo, spam), ricevuti
--    dalla edge function email-eventi. Si agganciano alle email per
--    provider_message_id. IP e user agent delle aperture non si salvano: non
--    servono alla prova e sono dati personali in più.
--
-- 3. L'impronta: uno SHA-256 calcolato all'invio su ora, mittente,
--    destinatari, oggetto e testo. Il database rifiuta qualunque modifica di
--    questi campi dopo l'invio, e la prova di invio ricalcola l'impronta per
--    dimostrare che il testo mostrato è quello partito.
--
-- Stato, aperture e click non sono colonne: si calcolano dagli eventi nella
-- vista email_inviate_esiti, così non possono andare fuori sincrono.
--
-- CONFIGURAZIONE SENDGRID (una volta, da Settings → Mail Settings → Event
-- Webhook): URL https://upoiasekisojikbzsymq.supabase.co/functions/v1/email-eventi,
-- eventi Processed, Delivered, Deferred, Bounced, Dropped, Opened, Clicked,
-- Spam Reports; attivare «Signed Event Webhook» e copiare la chiave pubblica
-- nel secret SENDGRID_EVENTI_CHIAVE_PUBBLICA delle edge function.

-- ───────────────────────────────────────────────────────── email inviate

create table if not exists public.email_inviate (
	id uuid primary key default gen_random_uuid(),
	inviata_il timestamptz not null default now(),

	-- Che cosa è, in parole: «Voucher: codice assegnato», «Resoconto
	-- direzionale»… È la colonna «tipo» del tracking.
	automazione text not null,

	mittente text not null,
	mittente_nome text,
	rispondi_a text,
	destinatario text not null,
	cc text[],
	oggetto text not null,
	corpo_html text,
	corpo_testo text,

	provider text not null default 'sendgrid',
	-- L'X-Message-Id restituito da SendGrid: vuoto se l'invio non è partito.
	provider_message_id text,
	esito text not null default 'inviata',
	errore text,
	-- Se aperture e click erano tracciati (pixel e link riscritti).
	tracciata boolean not null default false,

	-- A chi e a cosa si riferisce. Il socio, se non lo passa chi invia, lo
	-- trova il trigger alla nascita (dal voucher, o dall'email se è di una
	-- persona sola).
	persona_id uuid references public.persone(id) on delete set null,
	voucher_id uuid references public.voucher(id) on delete set null,
	-- L'operatore che l'ha fatta partire, o «automatico».
	inviata_da text,

	impronta text,
	impronta_il timestamptz,

	constraint email_inviate_esito_check check (esito in ('inviata', 'errore'))
);

create index if not exists email_inviate_inviata_il_idx on public.email_inviate (inviata_il desc);
create index if not exists email_inviate_msg_idx on public.email_inviate (provider_message_id) where provider_message_id is not null;
create index if not exists email_inviate_persona_idx on public.email_inviate (persona_id, inviata_il desc) where persona_id is not null;
create index if not exists email_inviate_voucher_idx on public.email_inviate (voucher_id) where voucher_id is not null;
create index if not exists email_inviate_destinatario_idx on public.email_inviate (lower(destinatario));

alter table public.email_inviate enable row level security;
revoke all on public.email_inviate from anon, authenticated;

comment on table public.email_inviate is
	'Ogni email inviata dal CRM, con testo integrale, X-Message-Id di SendGrid e impronta SHA-256 immutabile. Solo service role.';

-- ─────────────────────────────────────────────────────────────── impronta

create or replace function public.impronta_email_inviata(
	p_inviata_il timestamptz, p_mittente text, p_destinatario text, p_cc text[],
	p_oggetto text, p_corpo_html text, p_corpo_testo text
) returns text
language sql
immutable
set search_path = ''
as $$
	select encode(extensions.digest(convert_to(concat_ws(E'\n',
		'ronchiverdi-email-v1',
		'ora:' || coalesce(to_char(p_inviata_il at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
		'mittente:' || coalesce(lower(btrim(p_mittente)), ''),
		'a:' || coalesce(lower(btrim(p_destinatario)), ''),
		'cc:' || coalesce(array_to_string(p_cc, ','), ''),
		'oggetto:' || coalesce(p_oggetto, ''),
		'html:' || coalesce(p_corpo_html, ''),
		'testo:' || coalesce(p_corpo_testo, '')
	), 'UTF8'), 'sha256'), 'hex')
$$;

-- Alla nascita: impronta e, se manca, il socio a cui appartiene.
create or replace function public.email_inviate_alla_nascita()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if new.persona_id is null and new.voucher_id is not null then
		select a.persona_id into new.persona_id
		  from public.voucher v
		  join public.abbonamenti a on a.id = v.abbonamento_id
		 where v.id = new.voucher_id;
	end if;

	-- Dall'indirizzo solo se è di una persona sola: un'email condivisa in
	-- famiglia non dice a chi era destinata, e la scheda la ritrova comunque
	-- per indirizzo.
	if new.persona_id is null then
		select min(p.id::text)::uuid into new.persona_id
		  from public.persone p
		 where p.email = lower(btrim(new.destinatario))
		having count(*) = 1;
	end if;

	new.impronta := public.impronta_email_inviata(
		new.inviata_il, new.mittente, new.destinatario, new.cc, new.oggetto, new.corpo_html, new.corpo_testo);
	new.impronta_il := now();
	return new;
end
$$;

drop trigger if exists email_inviate_alla_nascita on public.email_inviate;
create trigger email_inviate_alla_nascita
	before insert on public.email_inviate
	for each row execute function public.email_inviate_alla_nascita();

-- Dopo l'invio il contenuto non si tocca: si possono aggiornare solo i
-- collegamenti (socio, voucher), mai quello che l'impronta protegge.
create or replace function public.email_inviate_immutabile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if public.impronta_email_inviata(new.inviata_il, new.mittente, new.destinatario, new.cc, new.oggetto, new.corpo_html, new.corpo_testo)
	   is distinct from old.impronta then
		raise exception 'email_inviate: il contenuto di un''email inviata non si modifica (impronta %).', old.impronta
			using errcode = 'check_violation';
	end if;
	new.impronta := old.impronta;
	new.impronta_il := old.impronta_il;
	return new;
end
$$;

drop trigger if exists email_inviate_immutabile on public.email_inviate;
create trigger email_inviate_immutabile
	before update on public.email_inviate
	for each row execute function public.email_inviate_immutabile();

create or replace function public.verifica_impronta_email_inviata(p_id uuid)
returns table (registrata text, registrata_il timestamptz, attuale text, integra boolean)
language sql
stable
security definer
set search_path = ''
as $$
	select m.impronta, m.impronta_il, x.attuale, m.impronta = x.attuale
	  from public.email_inviate m,
	       lateral (select public.impronta_email_inviata(
	           m.inviata_il, m.mittente, m.destinatario, m.cc, m.oggetto, m.corpo_html, m.corpo_testo) as attuale) x
	 where m.id = p_id
$$;

revoke all on function public.verifica_impronta_email_inviata(uuid) from public, anon, authenticated;
grant execute on function public.verifica_impronta_email_inviata(uuid) to service_role;

-- ─────────────────────────────────────────────────────────── email eventi

create table if not exists public.email_eventi (
	id uuid primary key default gen_random_uuid(),
	ricevuto_il timestamptz not null default now(),
	provider text not null default 'sendgrid',
	provider_message_id text not null,
	-- sg_event_id: SendGrid può ripetere un invio del webhook, l'unico lo
	-- rende innocuo.
	evento_id text unique,
	evento text not null,
	-- L'ora dell'evento secondo i server di SendGrid.
	momento timestamptz not null,
	destinatario text,
	-- Motivo, risposta SMTP del server del destinatario, link cliccato.
	dettaglio text,
	-- Se l'evento portava la firma digitale di SendGrid, verificata.
	firmato boolean not null default false,
	grezzo jsonb
);

create index if not exists email_eventi_msg_idx on public.email_eventi (provider_message_id, momento);
create index if not exists email_eventi_momento_idx on public.email_eventi (momento desc);

alter table public.email_eventi enable row level security;
revoke all on public.email_eventi from anon, authenticated;

comment on table public.email_eventi is
	'Esiti di consegna dal SendGrid Event Webhook (edge function email-eventi). Si agganciano a email_inviate per provider_message_id. Solo service role.';

-- ──────────────────────────────────────────────────────── esiti calcolati

create or replace view public.email_inviate_esiti
with (security_invoker = true)
as
select
	m.id, m.inviata_il, m.automazione, m.mittente, m.mittente_nome, m.destinatario, m.cc, m.oggetto,
	m.provider, m.provider_message_id, m.esito, m.errore, m.tracciata, m.persona_id, m.voucher_id, m.inviata_da,
	e.consegnata_il, e.aperta_il, coalesce(e.aperture, 0) as aperture,
	coalesce(e.aperture_automatiche, 0) as aperture_automatiche,
	e.cliccata_il, coalesce(e.clic, 0) as clic,
	coalesce(e.rimbalzata, false) as rimbalzata, coalesce(e.spam, false) as spam,
	coalesce(e.ritardata, false) as ritardata, e.motivo, coalesce(e.link, '{}') as link
from public.email_inviate m
left join lateral (
	select
		min(x.momento) filter (where x.evento = 'delivered') as consegnata_il,
		min(x.momento) filter (where x.evento = 'open') as aperta_il,
		(count(*) filter (where x.evento = 'open'))::int as aperture,
		(count(*) filter (where x.evento = 'open' and x.grezzo ->> 'sg_machine_open' = 'true'))::int as aperture_automatiche,
		min(x.momento) filter (where x.evento = 'click') as cliccata_il,
		(count(*) filter (where x.evento = 'click'))::int as clic,
		bool_or(x.evento in ('bounce', 'dropped')) as rimbalzata,
		bool_or(x.evento = 'spamreport') as spam,
		bool_or(x.evento = 'deferred') and not bool_or(x.evento in ('delivered', 'open', 'click')) as ritardata,
		(array_agg(x.dettaglio order by x.momento desc)
			filter (where x.evento in ('bounce', 'dropped', 'deferred', 'spamreport')))[1] as motivo,
		array_agg(distinct x.grezzo ->> 'url') filter (where x.evento = 'click' and x.grezzo ? 'url') as link
	from public.email_eventi x
	where x.provider_message_id = m.provider_message_id
	  and (x.destinatario is null or x.destinatario = lower(m.destinatario))
) e on m.provider_message_id is not null;

revoke all on public.email_inviate_esiti from anon, authenticated;

-- ─────────────────────────────────────────────────── sezione Tracking email

update public.staff_users
set sezioni_consentite = array_append(sezioni_consentite, 'tracking-email')
where email = 'maurizio@ready2digital.it'
	and not ('tracking-email' = any (sezioni_consentite));
