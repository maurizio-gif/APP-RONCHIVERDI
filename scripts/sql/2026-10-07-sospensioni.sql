-- Le sospensioni degli abbonamenti di Info4U (dbo.AbbonamentiSospensioni)
-- su Supabase: una riga per sospensione. Serve alla pagina «Sospensioni»
-- sotto Abbonamenti (cliente, abbonamento, durata, causale).
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi, PRIMA di
-- lanciare la nuova versione di ops/sync-info4u/sync-abbonamenti.ps1.
--
-- Nota: le colonne sospensione già presenti in `abbonamenti`
-- (data_inizio_sospensione, gg_sospensione...) sono un residuo: l'ultima
-- data è del marzo 2025. Le sospensioni di oggi stanno in questa tabella.
--
-- Info4U NON registra qui chi ha inserito la sospensione né quando (la
-- tabella ha solo vendita, date, giorni netti e causale): `operatore_nome` e
-- `inserita_il` restano vuote finché non si trova un registro delle azioni
-- da cui ricavarli.

create table if not exists public.abbonamenti_sospensioni (
	id uuid primary key default gen_random_uuid(),

	-- IDAbbonamentoSospensioni di Info4U: chiave di upsert e watermark.
	source_sospensione_id integer not null unique,
	-- La vendita sospesa. Senza foreign key: può essere stata cancellata.
	source_iscrizione_id integer,

	data_inizio date,
	data_fine date,
	-- GGNetti di Info4U: i giorni di sospensione effettivamente sottratti,
	-- che possono differire da quelli di calendario (festivi, chiusure).
	giorni_netti integer,

	-- Il motivo scritto a mano e quello scelto da elenco (SospensioniCausali).
	causale text,
	source_causale_id integer,
	causale_descrizione text,

	-- Riservati: non disponibili in Info4U (vedi la nota in testa).
	operatore_nome text,
	inserita_il timestamptz,

	cancellato_il timestamptz,
	sincronizzato_il timestamptz not null default now()
);

create index if not exists abbonamenti_sospensioni_iscrizione_idx on public.abbonamenti_sospensioni (source_iscrizione_id);
create index if not exists abbonamenti_sospensioni_inizio_idx on public.abbonamenti_sospensioni (data_inizio);
create index if not exists abbonamenti_sospensioni_cancellato_il_idx
	on public.abbonamenti_sospensioni (cancellato_il) where cancellato_il is not null;

alter table public.abbonamenti_sospensioni enable row level security;

-- La sospensione con cliente, abbonamento e stato (al giorno di Roma):
--   in_corso     oggi è fra data_inizio e data_fine
--   programmata  comincia dopo oggi
--   conclusa     finita prima di oggi
create or replace view public.sospensioni_elenco
with (security_invoker = true) as
select
	s.id,
	s.source_sospensione_id,
	s.source_iscrizione_id,
	s.data_inizio,
	s.data_fine,
	-- Giorni di calendario, estremi compresi.
	(s.data_fine - s.data_inizio + 1) as giorni_calendario,
	s.giorni_netti,
	s.causale,
	s.causale_descrizione,
	s.operatore_nome,
	s.inserita_il,
	case
		when s.data_inizio > (now() at time zone 'Europe/Rome')::date then 'programmata'
		when s.data_fine is null or s.data_fine >= (now() at time zone 'Europe/Rome')::date then 'in_corso'
		else 'conclusa'
	end as stato,
	a.persona_id,
	p.nome as persona_nome,
	p.cognome as persona_cognome,
	a.abbonamento,
	a.variante,
	a.data_inizio as abbonamento_inizio,
	a.data_fine as abbonamento_fine,
	(a.id is null) as vendita_assente
from public.abbonamenti_sospensioni s
left join public.abbonamenti a on a.source_iscrizione_id = s.source_iscrizione_id and a.cancellato_il is null
left join public.persone p on p.id = a.persona_id
where s.cancellato_il is null;
