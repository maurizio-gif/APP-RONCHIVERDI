-- Le tessere CSI nel CRM.
--
-- La edge function csi-tessere legge ogni ora dal server nazionale CSI i
-- tesserati della società (operazione E, stagione corrente e precedente) e li
-- scrive qui. Da qui il CRM mostra la tessera nella scheda della persona, la
-- ricerca nella pagina Tesseramenti e l'elenco di chi ha pagato con IVA a
-- zero ma non ha una tessera in corso: la tessera è la condizione del non
-- assoggettamento all'IVA degli abbonamenti (art. 4 del DPR 633/72).
--
-- Cinque pezzi:
--
-- 1. `tessere_csi`: una riga per stagione e numero di tessera, legata alla
--    persona per codice fiscale.
-- 2. `collega_tessere_csi()`: aggancia le tessere alle persone.
-- 3. `tessere_csi_attive`: una tessera in corso per persona (la più lunga).
-- 4. `iva_zero_senza_tessera()`: chi ha pagamenti con IVA a zero e nessuna
--    tessera in corso, con l'abbonamento reale e da quando è iscritto.
-- 5. L'interruttore `csi_tessere` in `automazioni`, il job di pg_cron e il
--    permesso della pagina.
--
-- «Abbonamento reale» ha la stessa definizione del report abbonamenti: la
-- vista abbonamenti_attivi_oggi_dettaglio (non cancellato, in corso, prodotto
-- non segnato «no abbonamento» nei gruppi).
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi, nell'ordine
-- dei blocchi; si può rieseguire senza danni.

-- ───────────────────────────────────────────────────────────────── tessere
create table if not exists public.tessere_csi (
	id uuid primary key default gen_random_uuid(),
	-- Primo anno della stagione sportiva (2025 per il 2025/26).
	stagione integer not null,
	tessera text not null,
	-- Codice fiscale in maiuscolo: la chiave con cui si lega alla persona.
	cft text,
	persona_id uuid references public.persone (id) on delete set null,
	-- Come li ha CSI: servono per le tessere senza una persona nel CRM.
	cognome text,
	nome text,
	-- AT atleta, NA non atleta.
	tipotess text,
	-- Codici attività (att1..att4) e qualifiche (qua1..qua5), solo i compilati.
	attivita text[] not null default '{}',
	qualifiche text[] not null default '{}',
	rilascio date,
	scadenza date,
	foto boolean not null default false,
	-- L'ultima volta che CSI ha restituito questa tessera: una tessera che CSI
	-- non restituisce più (annullata) esce dalla tabella al giro dopo.
	visto_il timestamptz not null default now(),
	constraint tessere_csi_stagione_tessera unique (stagione, tessera)
);

create index if not exists tessere_csi_cft_idx on public.tessere_csi (cft);
create index if not exists tessere_csi_persona_idx on public.tessere_csi (persona_id);
create index if not exists tessere_csi_scadenza_idx on public.tessere_csi (scadenza desc);

comment on table public.tessere_csi is
	'Le tessere che il server CSI ha in archivio per la società, aggiornate ogni ora dalla edge function csi-tessere. Solo service role.';

alter table public.tessere_csi enable row level security;

-- ──────────────────────────────────────────────────────────────── legame
-- Per codice fiscale. Se due persone hanno lo stesso codice fiscale (un
-- doppione in anagrafica) si sceglie quella che viene da Info4U e, a parità,
-- la più vecchia: la tessera sta su una persona sola.
create or replace function public.collega_tessere_csi()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
	v_toccate integer;
begin
	with scelta as (
		select distinct on (upper(trim(codice_fiscale)))
			upper(trim(codice_fiscale)) as cf, id
		from public.persone
		where length(trim(coalesce(codice_fiscale, ''))) = 16
		order by upper(trim(codice_fiscale)), (source_utente_id is not null) desc, creato_il asc
	)
	update public.tessere_csi t
	set persona_id = s.id
	from scelta s
	where t.cft = s.cf and t.persona_id is distinct from s.id;
	get diagnostics v_toccate = row_count;

	-- Una tessera il cui codice fiscale non corrisponde più a nessuna persona
	-- resta senza legame (non si lascia puntare a chi non c'entra).
	update public.tessere_csi t
	set persona_id = null
	where t.persona_id is not null
		and not exists (
			select 1 from public.persone p
			where p.id = t.persona_id and upper(trim(p.codice_fiscale)) = t.cft
		);
	return v_toccate;
end;
$$;

revoke all on function public.collega_tessere_csi() from public, anon, authenticated;
grant execute on function public.collega_tessere_csi() to service_role;

-- ───────────────────────────────────────────────────────── tessere in corso
-- Una per persona: quella che scade più tardi fra le non scadute. La data è
-- quella di Roma.
create or replace view public.tessere_csi_attive
with (security_invoker = true) as
select distinct on (t.persona_id)
	t.persona_id, t.tessera, t.stagione, t.tipotess, t.attivita, t.qualifiche,
	t.rilascio, t.scadenza, t.cft
from public.tessere_csi t
where t.persona_id is not null
	and t.scadenza >= (now() at time zone 'Europe/Rome')::date
order by t.persona_id, t.scadenza desc;

revoke all on public.tessere_csi_attive from public, anon, authenticated;
grant select on public.tessere_csi_attive to service_role;

-- ───────────────────────────────────────── IVA a zero senza tessera in corso
-- Le persone con pagamenti a IVA zero dal giorno p_dal e senza una tessera in
-- corso. `p_titolo` è la dicitura sulla riga della ricevuta: «art. 4» è il
-- non assoggettamento degli abbonamenti ai soci (il caso che dipende dalla
-- tessera), «art. 15» è altro (visite mediche e simili); null = ogni IVA zero.
-- Le ricevute annullate non contano, e conta il netto: chi ha avuto un
-- rimborso pari al pagamento non compare.
--
-- Per ogni persona: i pagamenti (quanti, quanto, il primo e l'ultimo), l'ultimo
-- abbonamento reale in corso con le sue date, da quando è iscritta (la prima
-- data di inizio fra abbonamenti e quote associative) e l'ultima tessera
-- avuta, scaduta o mai avuta.
create or replace function public.iva_zero_senza_tessera(p_dal date, p_titolo text default 'art. 4')
returns table (
	persona_id uuid,
	nome text,
	cognome text,
	codice_fiscale text,
	n_ricevute bigint,
	importo numeric,
	primo_pagamento date,
	ultimo_pagamento date,
	abbonamento text,
	gruppo_id uuid,
	data_inizio date,
	data_fine date,
	iscritto_dal date,
	ultima_tessera text,
	ultima_tessera_scadenza date
)
language sql
stable
security definer
set search_path = public
as $$
	with pag as (
		select r.persona_id,
			count(distinct r.id) as n_ricevute,
			sum(rr.qta * rr.prezzo_unitario) as importo,
			min(r.data_ricevuta) as primo,
			max(r.data_ricevuta) as ultimo
		from public.ricevute r
		join public.ricevute_righe rr on rr.source_ricevuta_id = r.source_ricevuta_id
		where r.persona_id is not null
			and not coalesce(r.annullata, false)
			and rr.iva = 0
			and (p_titolo is null or rr.iva_descrizione = p_titolo)
			and r.data_ricevuta >= p_dal
		group by r.persona_id
		having sum(rr.qta * rr.prezzo_unitario) > 0
	)
	select pag.persona_id, p.nome, p.cognome, p.codice_fiscale,
		pag.n_ricevute, round(pag.importo::numeric, 2), pag.primo, pag.ultimo,
		ab.abbonamento, ab.gruppo_id, ab.data_inizio, ab.data_fine,
		least(
			(select min(a.data_inizio) from public.abbonamenti a
				where a.persona_id = pag.persona_id and a.cancellato_il is null),
			(select min(q.data_inizio) from public.quote_associative q where q.persona_id = pag.persona_id)
		),
		tp.tessera, tp.scadenza
	from pag
	join public.persone p on p.id = pag.persona_id
	left join lateral (
		select d.abbonamento, d.gruppo_id, d.data_inizio, d.data_fine
		from public.abbonamenti_attivi_oggi_dettaglio d
		where d.persona_id = pag.persona_id
		order by d.data_fine desc nulls first
		limit 1
	) ab on true
	left join lateral (
		select t.tessera, t.scadenza
		from public.tessere_csi t
		where t.persona_id = pag.persona_id
		order by t.scadenza desc nulls last
		limit 1
	) tp on true
	where not exists (select 1 from public.tessere_csi_attive a where a.persona_id = pag.persona_id)
	order by pag.ultimo desc, p.cognome, p.nome, pag.persona_id;
$$;

revoke all on function public.iva_zero_senza_tessera(date, text) from public, anon, authenticated;
grant execute on function public.iva_zero_senza_tessera(date, text) to service_role;

-- ───────────────────────────────────────── interruttore, cron e permesso
-- La lettura da CSI è di sola lettura, quindi nasce accesa; per fermarla:
--   update public.automazioni set attiva = false, aggiornato_il = now() where chiave = 'csi_tessere';
insert into public.automazioni (chiave, attiva, attiva_dal, descrizione)
values (
	'csi_tessere',
	true,
	now(),
	'Legge ogni ora dal server CSI le tessere della società e le scrive in tessere_csi (sola lettura su CSI).'
)
on conflict (chiave) do nothing;

select cron.schedule(
	'csi-tessere',
	'20 * * * *',
	$$select public.chiama_edge_function('csi-tessere')
	   where exists (select 1 from public.automazioni where chiave = 'csi_tessere' and attiva)$$
);

-- La pagina Tesseramenti sta in Segreteria: la ricevono chi ha già Abbonamenti
-- o è operatore di segreteria.
update public.staff_users
set sezioni_consentite = array_append(sezioni_consentite, 'tesseramenti')
where (operatore_segreteria or 'abbonamenti' = any (sezioni_consentite))
	and not ('tesseramenti' = any (sezioni_consentite));

-- Verifica
select jobname, schedule, active from cron.job where jobname = 'csi-tessere';
select chiave, attiva from public.automazioni where chiave = 'csi_tessere';
