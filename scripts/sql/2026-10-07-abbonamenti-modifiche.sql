-- Le modifiche di scadenza degli abbonamenti, dal REGISTRO DELLE AZIONI di
-- Info4U (dbo.AppLog): chi (operatore), quando (data e ora vere), su quale
-- abbonamento e di quanto. È il dato che mancava alla pagina Sospensioni
-- (scadenze spostate): né AbbonamentiSospensioni né Sospensioni lo hanno.
--
-- AppLog scrive una riga per ogni modifica, con testo del tipo:
--   ABBONAMENTI MODIFICA: cambiata data inizio in 21/09/2026 e data fine
--   abbonamento in 06/06/2027 (precedente data inizio: 21/09/2026 - data
--   fine: 20/05/2027) all'abbonamento <nome> (IDIscrizione ...)
-- Il sync ne ricava le date e l'IDIscrizione. Una PROROGA (sospensione) è una
-- modifica in cui la fine si sposta più dell'inizio: se slittano insieme
-- dello stesso numero di giorni è una correzione della data di inizio, non
-- una sospensione. `proroga_giorni` è la differenza fra i due spostamenti.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi, DOPO
-- 2026-10-07-scadenze-spostate.sql e PRIMA di lanciare la nuova versione di
-- ops/sync-info4u/sync-abbonamenti.ps1. Ridefinisce la vista scadenze_spostate
-- (stesse colonne di prima, più quattro in fondo): non rieseguire dopo di
-- questo file il vecchio 2026-10-07-scadenze-spostate.sql.
--
-- Non si copia il nome del socio (colonna Utente di AppLog): solo il suo ID.

create table if not exists public.abbonamenti_modifiche (
	id uuid primary key default gen_random_uuid(),

	-- IdLog di AppLog: chiave di upsert e watermark.
	source_log_id integer not null unique,
	data_operazione timestamptz not null,

	operatore_id integer,
	operatore_nome text,

	source_utente_id integer,
	persona_id uuid references public.persone(id),
	source_iscrizione_id integer,

	inizio_precedente date,
	fine_precedente date,
	inizio_nuovo date,
	fine_nuova date,

	-- Di quanti giorni la fine si è spostata oltre l'inizio: > 0 è una
	-- proroga (sospensione), 0 una correzione di date, < 0 un anticipo.
	proroga_giorni integer generated always as (
		(fine_nuova - fine_precedente) - coalesce(inizio_nuovo - inizio_precedente, 0)
	) stored,

	-- Il testo del registro (primi 600 caratteri: il nome del prodotto e
	-- l'ID), per riconoscere i formati che il sync non sa leggere.
	descrizione text,
	-- Falso se il testo non ha le date: la riga resta, ma non conta.
	interpretata boolean not null default false,

	sincronizzato_il timestamptz not null default now()
);

create index if not exists abbonamenti_modifiche_iscrizione_idx on public.abbonamenti_modifiche (source_iscrizione_id);
create index if not exists abbonamenti_modifiche_data_idx on public.abbonamenti_modifiche (data_operazione desc);
create index if not exists abbonamenti_modifiche_operatore_idx on public.abbonamenti_modifiche (operatore_nome);

alter table public.abbonamenti_modifiche enable row level security;

-- persona_id dal source_utente_id, come per le transazioni.
create or replace function public.abbonamenti_modifiche_imposta_persona()
returns trigger
language plpgsql
as $$
begin
	if new.persona_id is null and new.source_utente_id is not null then
		select p.id into new.persona_id from public.persone p where p.source_utente_id = new.source_utente_id;
	end if;
	return new;
end;
$$;

drop trigger if exists abbonamenti_modifiche_imposta_persona on public.abbonamenti_modifiche;
create trigger abbonamenti_modifiche_imposta_persona
	before insert or update of source_utente_id on public.abbonamenti_modifiche
	for each row execute function public.abbonamenti_modifiche_imposta_persona();

-- scadenze_spostate: stesse colonne di prima, più la proroga più recente
-- (quando, di quanti giorni, chi) ricavata dal registro.
create or replace view public.scadenze_spostate
with (security_invoker = true) as
select
	a.id,
	a.source_iscrizione_id,
	a.persona_id,
	p.nome as persona_nome,
	p.cognome as persona_cognome,
	a.abbonamento,
	a.variante,
	a.data_vendita,
	a.data_inizio,
	(a.data_inizio + a.durata * interval '1 month' - interval '1 day')::date as scadenza_prevista,
	a.data_fine,
	a.data_fine - (a.data_inizio + a.durata * interval '1 month' - interval '1 day')::date as giorni_spostati,
	(a.data_fine >= (now() at time zone 'Europe/Rome')::date) as attiva,
	a.data_disdetta,
	(select max(v.rilevata_il) from public.abbonamenti_scadenze_variazioni v where v.abbonamento_id = a.id) as ultima_variazione_il,
	a.durata,
	pr.data_operazione as proroga_il,
	pr.proroga_giorni,
	pr.operatore_nome as proroga_operatore,
	pr.operatore_id as proroga_operatore_id
from public.abbonamenti a
left join public.persone p on p.id = a.persona_id
left join lateral (
	select m.data_operazione, m.proroga_giorni, m.operatore_nome, m.operatore_id
	from public.abbonamenti_modifiche m
	where m.source_iscrizione_id = a.source_iscrizione_id
	  and m.interpretata
	  and m.proroga_giorni > 0
	order by m.data_operazione desc
	limit 1
) pr on true
where a.cancellato_il is null
  and a.periodo = 'M'
  and a.durata > 0
  and a.data_inizio >= date '2023-01-01'
  and a.data_fine is not null
  and a.data_fine - (a.data_inizio + a.durata * interval '1 month' - interval '1 day')::date > 3;

-- Le proroghe recenti, una riga per modifica (non per abbonamento): per sapere
-- quante ne ha fatte ciascun operatore e quando.
create or replace view public.proroghe_abbonamenti
with (security_invoker = true) as
select
	m.source_log_id,
	m.data_operazione,
	m.operatore_id,
	m.operatore_nome,
	m.source_iscrizione_id,
	m.persona_id,
	p.nome as persona_nome,
	p.cognome as persona_cognome,
	a.abbonamento,
	m.fine_precedente,
	m.fine_nuova,
	m.proroga_giorni
from public.abbonamenti_modifiche m
left join public.persone p on p.id = m.persona_id
left join public.abbonamenti a on a.source_iscrizione_id = m.source_iscrizione_id
where m.interpretata and m.proroga_giorni > 0;
