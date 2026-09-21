-- Dashboard direzionale sintetica: campagne (categorizzazione a mano delle
-- utm_campaign grezze, stesso pattern di abbonamenti_gruppi/mappatura) e
-- primo canale di acquisizione per persona, per correlare le vendite di
-- abbonamenti con da dove è arrivato per la prima volta chi le ha fatte.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-18-abbonamenti-gruppi.sql.

-- ─────────────────────────────────────────────────────────────── campagne
--
-- form_contatti.utm_campaign arriva grezzo dal sito (spesso libero, non
-- sempre pulito) — esattamente come abbonamenti.abbonamento arriva grezzo da
-- Info4U. Stessa soluzione: una tabella di campagne "vere" decise a mano dalla
-- direzione, e una mappatura che lega ogni utm_campaign osservata alla sua
-- campagna, editabile da /dashboard/direzione/campagne. Una utm_campaign mai
-- vista prima compare "non categorizzata" nei report finché qualcuno non le
-- assegna una campagna.

create table if not exists public.campagne (
	id uuid primary key default gen_random_uuid(),
	nome text not null unique,
	ordine integer not null default 0,
	creato_il timestamptz not null default now()
);

create table if not exists public.campagne_mappatura (
	id uuid primary key default gen_random_uuid(),
	utm_campaign text not null unique,
	campagna_id uuid references public.campagne(id) on delete set null,
	aggiornato_il timestamptz not null default now()
);

create index if not exists campagne_mappatura_campagna_id_idx on public.campagne_mappatura (campagna_id);

-- Le utm_campaign osservate in form_contatti, con quante richieste hanno
-- portato: la pagina di gestione la usa per elencare cosa c'è da
-- categorizzare, come abbonamenti_prodotti fa per i prodotti Info4U.
create or replace view public.campagne_utm_viste as
select
	f.utm_campaign,
	count(*) as numero_richieste,
	max(f.created_at) as ultima_richiesta
from public.form_contatti f
where f.utm_campaign is not null
group by f.utm_campaign;

-- ────────────────────────────────────────────────────── primo canale
--
-- Il "first touch" oggi esiste solo a livello di singola richiesta
-- (form_contatti.first_utm_source/first_utm_campaign, scritti dal sito al
-- primo arrivo). Per correlare una VENDITA con il primo canale della persona
-- serve invece la prima richiesta mai fatta da quella persona in tutta la sua
-- storia nel CRM — che può essere mesi o anni prima della vendita.

-- Indice di supporto per il distinct on qui sotto: senza, ogni lettura
-- ordinerebbe le richieste di ogni persona da zero.
create index if not exists form_contatti_persona_created_idx on public.form_contatti (persona_id, created_at);

-- Una riga per persona: l'origine della sua primissima richiesta. `origine`
-- resta grezzo (null, 'walk-in', 'lead-modal', '*-inline', ...) — la stessa
-- separazione fra "il database dà il dato grezzo" e "l'app lo classifica" di
-- lib/provenienza.ts.
create or replace view public.persone_primo_canale as
select distinct on (f.persona_id)
	f.persona_id,
	f.origine as prima_origine
from public.form_contatti f
where f.persona_id is not null
order by f.persona_id, f.created_at asc;

-- Le vendite, per giorno e canale di primo contatto della persona. Non basta
-- `prima_origine` da sola per distinguere i due casi che altrimenti
-- collasserebbero entrambi su NULL:
--   - la persona ha una prima richiesta con origine NULL (form storico, prima
--     che il sito marcasse l'origine) → è "sito" a tutti gli effetti;
--   - la persona non ha MAI avuto una richiesta nel CRM (rinnovo, acquisto
--     spontaneo in reception) → non è attribuibile a nessun canale.
-- `ha_richiesta` (vero solo nel primo caso) è quello che l'app usa per
-- separarli — vedi lib/direzione.ts, canaleVendita().
create or replace view public.abbonamenti_giornalieri_canale as
select
	a.data_vendita::date as giorno,
	(pc.persona_id is not null) as ha_richiesta,
	pc.prima_origine,
	count(*) as numero_vendite,
	sum(a.totale) as fatturato
from public.abbonamenti a
left join public.persone_primo_canale pc on pc.persona_id = a.persona_id
where a.data_vendita is not null
group by 1, 2, 3;

create or replace view public.abbonamenti_mensili_canale as
select
	date_trunc('month', a.data_vendita)::date as mese,
	(pc.persona_id is not null) as ha_richiesta,
	pc.prima_origine,
	count(*) as numero_vendite,
	sum(a.totale) as fatturato
from public.abbonamenti a
left join public.persone_primo_canale pc on pc.persona_id = a.persona_id
where a.data_vendita is not null
group by 1, 2, 3;
