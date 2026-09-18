-- Sincronizzazione da Info4U/TeamSystem (gestionale on-premise, database
-- `dbgym` su SRVTEAMSYSTEM) verso Supabase.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi, prima di
-- lanciare lo script di sincronizzazione (ops/sync-info4u/sync-abbonamenti.ps1).
--
-- Due pezzi:
--   1. Colonne nuove su `persone`, per i dati anagrafici che Info4U porta e
--      che oggi non registriamo (codice fiscale, nascita, indirizzo,
--      telefono secondario) più `source_utente_id`, la chiave con cui lo
--      script riconosce "questa persona l'ho già creata" invece di
--      duplicarla a ogni sincronizzazione.
--   2. La tabella `abbonamenti`: una riga per ogni vendita registrata in
--      Info4U (membership, campi, visite mediche, shop, daily pass, omaggi,
--      carnet — non filtriamo per tipo), con `source_iscrizione_id` come
--      chiave sia di dedup sia di watermark ("da dove riparto la prossima
--      volta").

-- ────────────────────────────────────────────────────────────── persone

alter table public.persone
	-- L'IDUtente di Info4U. Unico e nullable: solo le persone sincronizzate
	-- da lì ce l'hanno, chi arriva dal sito o a mano no.
	add column if not exists source_utente_id integer unique,
	add column if not exists codice_fiscale text,
	add column if not exists data_nascita date,
	add column if not exists sesso text,
	-- `cellulare` (colonna già esistente) prende il campo SMS di Info4U: è
	-- quello che il gestionale stesso tratta come il numero raggiungibile,
	-- lo stesso ruolo che `cellulare` ha già in questo CRM. Telefono_1 e
	-- Telefono_2 sono recapiti aggiuntivi, non il principale.
	add column if not exists telefono_1 text,
	add column if not exists telefono_2 text,
	add column if not exists indirizzo_via text,
	add column if not exists indirizzo_civico text,
	add column if not exists indirizzo_cap text,
	add column if not exists indirizzo_citta text,
	add column if not exists indirizzo_provincia text,
	add column if not exists indirizzo_stato text;

-- ─────────────────────────────────────────────────────────── abbonamenti

create table if not exists public.abbonamenti (
	id uuid primary key default gen_random_uuid(),

	-- La chiave di tutto: l'ID della vendita in Info4U. Univoca e non nulla
	-- — è sia la chiave di upsert (ON CONFLICT) sia il watermark che lo
	-- script legge a ogni giro per sapere da dove riprendere
	-- (MAX(source_iscrizione_id)).
	source_iscrizione_id integer not null unique,

	-- La persona a cui appartiene questa vendita. Nullable: se in futuro
	-- decidessimo di saltare la creazione di qualche anagrafica (biglietti
	-- anonimi, prove), la vendita resta comunque registrata.
	persona_id uuid references public.persone(id),
	-- Ridondante rispetto a persona_id, ma utile per interrogare le vendite
	-- di un IDUtente senza dover passare da un join.
	source_utente_id integer,

	source_durata_id integer,
	source_abbonamento_id integer,

	-- PRODOTTO
	abbonamento text,
	variante text,
	durata integer,
	periodo text,

	-- VALIDITÀ E VENDITA
	data_vendita timestamptz,
	data_inizio date,
	data_fine date,

	-- ECONOMICO: quattro importi diversi perché sono quattro domande
	-- diverse (quanto è stato effettivamente incassato, il listino, il
	-- prezzo di categoria, quello configurato sulla durata) — sommarli in
	-- uno solo perderebbe l'informazione di quale sconto è stato applicato
	-- e rispetto a cosa.
	totale numeric(12, 2),
	importo_listino numeric(12, 2),
	importo_categoria numeric(12, 2),
	importo_configurato numeric(12, 2),

	-- VENDITA / OPERATORE
	operatore_id integer,
	operatore_nome text,
	venditore_id integer,
	club_id integer,

	-- STATO
	bloccato boolean,
	convertito boolean,
	rinnovo_automatico boolean,
	data_disdetta date,
	motivo_disdetta text,

	-- SCONTI E GIORNI AGGIUNTIVI
	sconto_id integer,
	sconto_durata_id integer,
	gg_omaggio integer,
	gg_festivi integer,
	gg_sospensione integer,
	data_inizio_sospensione date,
	data_fine_sospensione date,

	note text,

	-- Quando lo script l'ha scritta qui, non quando è stata venduta
	-- (quello è `data_vendita`): serve a controllare che la sincronizzazione
	-- stia girando, non a leggere lo storico commerciale.
	sincronizzato_il timestamptz not null default now()
);

create index if not exists abbonamenti_persona_id_idx on public.abbonamenti (persona_id);
create index if not exists abbonamenti_source_utente_id_idx on public.abbonamenti (source_utente_id);
