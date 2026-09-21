-- Coda delle vendite fatte da un front-end ESTERNO a Info4U (un negozio
-- online costruito da noi o da terzi, non il gestionale) che devono finire
-- come abbonamenti veri in Info4U/dbgym — il percorso inverso di
-- sync-abbonamenti.ps1, che invece legge Info4U e scrive qui.
--
-- Il flusso è: il front-end chiama POST /api/vendite-esterne (vedi
-- app/api/vendite-esterne/route.ts) a pagamento avvenuto → la riga finisce
-- qui con stato 'in_attesa' → sullo stesso server dove gira
-- sync-abbonamenti.ps1, un secondo script (scrivi-vendite.ps1, vedi
-- ops/sync-info4u/README.md) la legge, scrive la vendita in
-- dbo.AbbonamentiIscrizione su dbgym e segna qui l'esito. Da lì in avanti la
-- vendita rientra in Supabase per la strada normale: la rilegge
-- sync-abbonamenti.ps1 come farebbe con una vendita fatta al banco, e popola
-- `persone`/`abbonamenti` — questa tabella non li tocca direttamente, è solo
-- la coda di ciò che deve ancora essere scritto in Info4U.
--
-- Nessuna riga qui viene mai scritta dal browser: RLS è attiva e senza
-- policy, quindi solo la service role key (server-side, sia dalla route API
-- sia dallo script PowerShell) può leggerla o scriverla.

create table if not exists public.vendite_esterne (
	id uuid primary key default gen_random_uuid(),

	-- Da dove arriva questa vendita e la chiave con cui QUEL sistema la
	-- riconosce (numero d'ordine, id della transazione...): la coppia è
	-- l'idempotenza lato nostro — se il front-end reinvia la stessa vendita
	-- (retry di rete, doppio click) l'insert va in conflitto invece di
	-- creare un secondo abbonamento.
	origine text not null,
	riferimento_esterno text not null,

	-- ANAGRAFICA di chi acquista, cosí come l'ha compilata sul front-end
	-- esterno — stessi nomi/tipi delle colonne equivalenti su `persone`
	-- (vedi 2026-09-17-sync-info4u-abbonamenti.sql), per poterli confrontare
	-- senza conversioni. Non è una FK a `persone`: quella riga potrebbe non
	-- esistere ancora né in Info4U né qui finché lo script di scrittura non
	-- ha trovato o creato la persona giusta in Info4U.
	nome text not null,
	cognome text not null,
	email text,
	cellulare text,
	codice_fiscale text,
	data_nascita date,

	-- La persona Info4U/CRM risolta da scrivi-vendite.ps1 al momento della
	-- scrittura: valorizzati solo a scrittura avvenuta, per collegare questa
	-- riga alla `persone` che poi la sincronizzazione normale userà.
	persona_id uuid references public.persone(id),
	source_utente_id integer,

	-- PRODOTTO: l'IDDurata di Info4U che si sta vendendo. Non testo libero —
	-- il front-end deve conoscere l'id vero del prodotto Info4U (oggi non
	-- c'è ancora un catalogo sincronizzato in lettura che glielo offra: va
	-- mappato a mano finché non lo costruiamo, vedi il README di
	-- ops/sync-info4u). `abbonamento`/`variante` sono solo descrittivi, per
	-- leggere la coda senza dover risalire a Info4U.
	source_durata_id integer not null,
	abbonamento text,
	variante text,

	-- ECONOMICO E VALIDITÀ
	totale numeric(12, 2) not null,
	-- Quando il pagamento è avvenuto sul front-end esterno — diventerà
	-- DataOperazione in dbo.AbbonamentiIscrizione. Non è `creato_il` (quando
	-- questa riga è arrivata qui): un retry di rete può accodarla qualche
	-- istante dopo il pagamento vero.
	data_vendita timestamptz not null default now(),
	data_inizio date,
	data_fine date,
	metodo_pagamento text,
	riferimento_pagamento text,

	note text,

	-- STATO della scrittura verso Info4U.
	--   in_attesa   — appena arrivata, scrivi-vendite.ps1 non l'ha ancora presa.
	--   scritto     — creata in dbo.AbbonamentiIscrizione, source_iscrizione_id valorizzato.
	--   errore      — scrivi-vendite.ps1 non è riuscito a scriverla (persona non
	--                 trovata in Info4U, o un errore SQL): resta qui per la verifica
	--                 manuale, e NON viene ritentata da sola — va rimessa a mano a
	--                 'in_attesa' dopo aver risolto il problema.
	stato text not null default 'in_attesa' check (stato in ('in_attesa', 'scritto', 'errore')),

	-- L'IDIscrizione assegnato da Info4U a scrittura avvenuta: da qui in poi
	-- è la stessa chiave con cui sync-abbonamenti.ps1 la ritroverà come
	-- source_iscrizione_id in `abbonamenti`.
	source_iscrizione_id integer,
	errore text,

	creato_il timestamptz not null default now(),
	processato_il timestamptz,

	unique (origine, riferimento_esterno)
);

create index if not exists vendite_esterne_stato_idx
	on public.vendite_esterne (stato)
	where stato = 'in_attesa';

alter table public.vendite_esterne enable row level security;

comment on table public.vendite_esterne is
	'Coda delle vendite fatte da un front-end esterno a Info4U, in attesa che scrivi-vendite.ps1 le scriva in dbo.AbbonamentiIscrizione su dbgym. Nessuna policy RLS: solo la service role key vi accede.';
