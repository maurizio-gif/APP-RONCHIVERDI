-- Luogo di nascita in anagrafica.
--
-- Il tesseramento CSI lo richiede (campo `luogo`, §6.1 della guida), e in
-- Info4U c'è: Utenti.Luogo_Nascita (compilato per circa il 70% degli utenti),
-- con Provincia_Nascita ('EE' per i nati all'estero) e Stato_Nascita. Il sync
-- (ops/sync-info4u) non lo leggeva.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi PRIMA di
-- lanciare la nuova versione di sync-abbonamenti.ps1 e di bonifica-fusioni.ps1:
-- i due script scrivono queste colonne con PostgREST, e se non esistono
-- ancora Supabase rifiuta l'intera riga della persona. Aggiunge solo colonne
-- vuote, si può rieseguire senza danni.
--
-- Si conservano i tre valori com'è li dà Info4U; il «luogo» da mandare a CSI
-- (comune per gli italiani, stato per gli stranieri) lo compone la edge
-- function tesseramento-csi, perché Stato_Nascita è compilato a mano e a
-- volte sporco (una città al posto dello stato).

alter table public.persone
	add column if not exists luogo_nascita text,
	add column if not exists provincia_nascita text,
	add column if not exists stato_nascita text;

comment on column public.persone.luogo_nascita is
	'Comune di nascita come in Info4U (Utenti.Luogo_Nascita). Per i nati all''estero può essere una città straniera.';
comment on column public.persone.provincia_nascita is
	'Sigla della provincia di nascita; «EE» per i nati all''estero (Utenti.Provincia_Nascita).';
comment on column public.persone.stato_nascita is
	'Stato di nascita come in Info4U (Utenti.Stato_Nascita), compilato a mano: può contenere una città.';

-- Verifica: devono comparire le tre colonne.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'persone'
	and column_name in ('luogo_nascita', 'provincia_nascita', 'stato_nascita')
order by column_name;
