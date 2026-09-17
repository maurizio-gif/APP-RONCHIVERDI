-- Due colonne per il report giornaliero del Core Manager.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi, prima del
-- deploy: il pannello di chiusura di una trattativa vinta scrive
-- `triple_pack`, e il report legge `obiettivi_giornalieri`.

-- ────────────────────────────────────────────────────────── triple pack
--
-- Quale abbonamento è stato venduto sta già in `motivo_vinto` (testo
-- libero), ma "è un triple pack?" è la domanda che il report deve contare
-- per giorno — e un conteggio non si fa affidabile su un testo scritto a
-- mano in venti modi diversi ("triple pack", "3x", "pacchetto triplo"...).
-- Una colonna sua, booleana: si spunta chiudendo la vinta, si conta senza
-- ambiguità.
alter table public.opportunita
	add column if not exists triple_pack boolean not null default false;

-- ──────────────────────────────────────────────────── obiettivi giornalieri
--
-- Il numero che la responsabile scriveva a mano ogni giorno sul foglio, per
-- ciascuna consulente: quanto doveva fare quel giorno. Non si deriva da
-- nessun dato — è un obiettivo, non una misura — quindi vive nella sua
-- tabella, una riga per persona e giorno.
create table if not exists public.obiettivi_giornalieri (
	id uuid primary key default gen_random_uuid(),

	-- L'email dello staff, come ovunque nel pannello (vedi opportunita.assegnato_a):
	-- nessun vincolo di chiave esterna, per non rompere lo storico se una
	-- persona lascia il club e la sua riga in staff_users viene tolta.
	commerciale text not null,
	giorno date not null,

	goal integer not null,

	aggiornato_da text,
	aggiornato_il timestamptz not null default now(),

	unique (commerciale, giorno)
);
