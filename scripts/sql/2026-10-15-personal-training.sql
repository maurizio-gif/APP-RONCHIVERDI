-- Personal training: le sessioni che i trainer registrano, la conferma del
-- responsabile e il compenso che l'amministrazione riconosce a ciascuno.
--
-- Oggi il flusso è un registro cartaceo: il trainer scrive a fine mese le
-- lezioni fatte (istruttore, cliente, orario) e il responsabile lo passa
-- all'amministrazione. Qui diventa tre passaggi nel pannello:
--
--   1. il trainer, dal telefono, registra la sessione scegliendo il cliente
--      fra le persone con un abbonamento attivo (stato «in_attesa»);
--   2. il responsabile (sezione personal-check) la conferma, la corregge o
--      la elimina — solo da confermata compare nella scheda del contatto;
--   3. l'amministrazione (sezione personal-amministrazione) imposta il
--      compenso a sessione di ogni trainer e legge il totale del mese.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq).

-- ───────────────────────────────────────────────────────────── sessioni

create table if not exists public.personal_sessioni (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),

	-- Chi eroga la sessione: l'account del trainer nel pannello. Email e non
	-- FK, come audit_log: la sessione resta attribuita anche dopo che il
	-- trainer è stato tolto da staff_users. Il nome è copiato per lo stesso
	-- motivo — il rendiconto di un mese chiuso deve restare leggibile.
	trainer_email text not null,
	trainer_nome text,

	-- Il cliente in anagrafica. Per un abbonamento corporate è la scheda
	-- «segnaposto» dell'azienda (es. nome "Corporate 1", cognome "Steeme
	-- Srl"), e chi si è allenato davvero sta in cliente_nome/cliente_cognome.
	-- SET NULL e non CASCADE: la sessione è un dato contabile, non deve
	-- sparire con una scheda cancellata.
	persona_id uuid references public.persone (id) on delete set null,

	-- L'abbonamento attivo con cui il trainer ha riconosciuto il cliente.
	abbonamento_id uuid references public.abbonamenti (id) on delete set null,
	abbonamento_nome text,

	-- Il nome di chi si è allenato, com'era al momento della registrazione:
	-- copiato dall'anagrafica per un cliente normale, scritto a mano dal
	-- trainer per un corporate.
	cliente_nome text not null,
	cliente_cognome text not null,
	corporate boolean not null default false,
	-- Solo per i corporate: l'azienda, copiata dal cognome della scheda
	-- segnaposto.
	azienda text,

	-- Quando si è svolta: giorno e ora di Roma, senza fuso, come in agenda.
	data date not null,
	ora time not null,

	stato text not null default 'in_attesa',
	confermata_il timestamptz,
	confermata_da text,

	modificata_il timestamptz,
	modificata_da text,

	constraint personal_sessioni_stato_check check (stato in ('in_attesa', 'confermata')),
	constraint personal_sessioni_cliente_check check (
		nullif(btrim(cliente_nome), '') is not null and nullif(btrim(cliente_cognome), '') is not null
	)
);

comment on table public.personal_sessioni is
	'Sessioni di personal training registrate dal trainer (stato in_attesa) e confermate dal responsabile (confermata). Una sessione confermata compare nella scheda del contatto e nel calcolo dei compensi del mese.';
comment on column public.personal_sessioni.persona_id is
	'Il cliente in anagrafica; per un corporate è la scheda segnaposto dell''azienda, e il nome di chi si è allenato sta in cliente_nome/cliente_cognome.';
comment on column public.personal_sessioni.stato is
	'in_attesa | confermata. Solo chi ha la sezione personal-check conferma, rimette in attesa, modifica o elimina.';

create index if not exists personal_sessioni_data_idx on public.personal_sessioni (data desc, ora desc);
create index if not exists personal_sessioni_trainer_idx on public.personal_sessioni (trainer_email, data desc);
create index if not exists personal_sessioni_persona_idx on public.personal_sessioni (persona_id);
create index if not exists personal_sessioni_attesa_idx on public.personal_sessioni (data) where stato = 'in_attesa';

alter table public.personal_sessioni enable row level security;
revoke all on public.personal_sessioni from anon, authenticated;

-- ───────────────────────────────────────────────────────────── compensi

-- Il compenso a sessione di un trainer, con la data da cui vale. Una riga
-- per ogni cambio, mai aggiornata: il calcolo di una sessione usa il
-- compenso in vigore nel giorno in cui si è svolta, così alzare la tariffa
-- da novembre non riscrive ottobre.
create table if not exists public.personal_compensi (
	id bigint generated always as identity primary key,
	created_at timestamptz not null default now(),
	trainer_email text not null,
	valido_dal date not null,
	compenso_sessione numeric(10, 2) not null check (compenso_sessione >= 0),
	impostato_da text not null,
	unique (trainer_email, valido_dal)
);

comment on table public.personal_compensi is
	'Compenso a sessione di ogni personal trainer, con la data da cui vale. Per una sessione si usa la riga con il valido_dal più recente non successivo alla data della sessione.';

alter table public.personal_compensi enable row level security;
revoke all on public.personal_compensi from anon, authenticated;

-- ───────────────────────────────────────────────── ricerca del cliente

-- Le persone con almeno un abbonamento attivo oggi, cercate per nome e
-- cognome: ogni parola deve comparire nel nome o nel cognome, in qualunque
-- ordine («rossi», «mario rossi», «rossi mario»).
--
-- «Attivo» come in abbonamenti_attivi_al: non cancellato in origine, già
-- iniziato e non ancora finito. Restano fuori i prodotti marcati
-- no_abbonamento (visite mediche, quote, e il Triple Pack stesso): il cliente
-- di un personal è un socio, e il pacchetto di lezioni non lo rende tale.
--
-- Una riga per persona, con gli abbonamenti attivi in un array: il trainer
-- riconosce il cliente da nome, data di nascita e abbonamento, e una persona
-- con due abbonamenti non deve comparire due volte.
create or replace function public.personal_cerca_clienti(p_query text, p_limite integer default 30)
returns table (
	persona_id uuid,
	nome text,
	cognome text,
	data_nascita date,
	abbonamento_id uuid,
	abbonamenti text[]
)
language sql
stable
security definer
set search_path = public
as $$
	with termini as (
		select termine
		from unnest(regexp_split_to_array(btrim(coalesce(p_query, '')), '\s+')) as termine
		where termine <> ''
	),
	oggi as (
		select (now() at time zone 'Europe/Rome')::date as giorno
	)
	select
		p.id as persona_id,
		p.nome,
		p.cognome,
		p.data_nascita,
		-- L'abbonamento che finisce più tardi: è quello che si aggancia alla
		-- sessione, gli altri si vedono soltanto.
		(array_agg(a.id order by a.data_fine desc nulls first))[1] as abbonamento_id,
		array_agg(distinct a.abbonamento) as abbonamenti
	from public.abbonamenti a
	join public.persone p on p.id = a.persona_id
	left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
	cross join oggi
	where exists (select 1 from termini)
		and a.cancellato_il is null
		and a.data_inizio is not null
		and a.data_inizio <= oggi.giorno
		and (a.data_fine is null or a.data_fine >= oggi.giorno)
		and not coalesce(m.no_abbonamento, false)
		and not exists (
			select 1 from termini t
			where (coalesce(p.nome, '') || ' ' || coalesce(p.cognome, '')) not ilike '%' || t.termine || '%'
		)
	group by p.id
	order by p.cognome nulls last, p.nome nulls last
	limit greatest(least(p_limite, 100), 1);
$$;

comment on function public.personal_cerca_clienti(text, integer) is
	'Persone con almeno un abbonamento attivo oggi (esclusi i prodotti no_abbonamento), cercate per nome e cognome. Una riga per persona, con l''abbonamento attivo che scade più tardi e l''elenco di tutti quelli attivi.';

revoke all on function public.personal_cerca_clienti(text, integer) from public, anon, authenticated;
grant execute on function public.personal_cerca_clienti(text, integer) to service_role;

-- Gli abbonamenti corporate attivi, cercati per nome dell'azienda.
--
-- Info4U intesta un abbonamento corporate a una scheda segnaposto: cognome =
-- l'azienda, nome = "Corporate 1", "Corporate 2"... e nessuna data di
-- nascita. Il dipendente che si allena non è in anagrafica, quindi il
-- trainer sceglie l'abbonamento dell'azienda e scrive a mano nome e cognome.
-- Le schede con una data di nascita sono persone vere con un corporate
-- intestato a sé: quelle le trova la ricerca normale, e qui confonderebbero.
--
-- Una riga per abbonamento, non per persona: ogni segnaposto è una tessera.
-- Con la query vuota restituisce tutti gli abbonamenti corporate attivi
-- (sono qualche decina): il trainer può scorrerli senza dover indovinare
-- come è scritta l'azienda.
create or replace function public.personal_cerca_corporate(p_query text, p_limite integer default 100)
returns table (
	persona_id uuid,
	nome text,
	azienda text,
	abbonamento_id uuid,
	abbonamento text,
	data_fine date
)
language sql
stable
security definer
set search_path = public
as $$
	with termini as (
		select termine
		from unnest(regexp_split_to_array(btrim(coalesce(p_query, '')), '\s+')) as termine
		where termine <> ''
	),
	oggi as (
		select (now() at time zone 'Europe/Rome')::date as giorno
	)
	select
		p.id as persona_id,
		p.nome,
		p.cognome as azienda,
		a.id as abbonamento_id,
		a.abbonamento,
		a.data_fine
	from public.abbonamenti a
	join public.persone p on p.id = a.persona_id
	left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
	cross join oggi
	where a.cancellato_il is null
		and a.abbonamento ilike '%corporate%'
		and p.data_nascita is null
		and a.data_inizio is not null
		and a.data_inizio <= oggi.giorno
		and (a.data_fine is null or a.data_fine >= oggi.giorno)
		and not coalesce(m.no_abbonamento, false)
		and not exists (
			select 1 from termini t
			where (coalesce(p.cognome, '') || ' ' || coalesce(p.nome, '')) not ilike '%' || t.termine || '%'
		)
	order by p.cognome nulls last, p.nome nulls last
	limit greatest(least(p_limite, 200), 1);
$$;

comment on function public.personal_cerca_corporate(text, integer) is
	'Abbonamenti corporate attivi intestati a una scheda segnaposto dell''azienda (senza data di nascita), cercati per nome dell''azienda. Query vuota: tutti.';

revoke all on function public.personal_cerca_corporate(text, integer) from public, anon, authenticated;
grant execute on function public.personal_cerca_corporate(text, integer) to service_role;

-- ───────────────────────────────────────────────────────────── permessi

-- Il controllo delle sessioni a Loris Citterio, il responsabile. Le altre due
-- sezioni (personal per i trainer, personal-amministrazione) si assegnano da
-- Gestione utenti: i trainer si invitano con l'accesso «Personal trainer».
update public.staff_users
set sezioni_consentite = array_append(sezioni_consentite, 'personal-check')
where email = 'l.citterio@ronchiverdi.it'
	and not ('personal-check' = any (sezioni_consentite));
