-- Corregge retroattivamente `data_vendita` in `abbonamenti`: lo script di
-- sync (ops/sync-info4u/sync-abbonamenti.ps1, funzione Get-IstantePulito)
-- scriveva l'orario di vendita locale del server Windows in una stringa ISO
-- SENZA offset di fuso (un DateTime .NET con Kind "Unspecified" formattato
-- con "o" non porta nessun offset con sé, a differenza di quanto diceva il
-- commento originale). Postgres legge una stringa così, senza offset, come
-- se fosse già UTC — ogni vendita finiva quindi spostata avanti dell'offset
-- di Roma rispetto a UTC: 2 ore nei mesi di ora legale (CEST), 1 ora in ora
-- solare (CET). Lo script è stato corretto (marca l'orario come Kind Local
-- prima di formattarlo, così l'offset giusto ci finisce dentro davvero), ma
-- quel fix vale solo per le vendite sincronizzate da ora in poi: questo
-- script sistema quelle già arrivate.
--
-- La correzione non è un -2h fisso proprio per questo: usa la doppia
-- conversione di fuso di Postgres per farsi ridare l'ora "di parete"
-- originale (quella scritta dal server Windows, la vera ora locale della
-- vendita) e reinterpretarla nel fuso di Roma — così ogni riga prende
-- l'offset giusto per la SUA data, CEST o CET, invece di sbagliare di un'ora
-- tutto lo storico invernale con un -2h uguale per tutti.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), una tantum. Aggiorna anche
-- ops/sync-info4u/sync-abbonamenti.ps1 sul server (C:\Scripts\sync-info4u):
-- senza, il prossimo sync torna a scrivere orari sbagliati e si ripresenta
-- lo stesso problema sulle vendite nuove.

begin;

update public.abbonamenti
set data_vendita = (data_vendita at time zone 'UTC') at time zone 'Europe/Rome'
where data_vendita is not null;

-- Le trattative già chiuse come vinte dal trigger di sync (vedi
-- 2026-09-18-abbonamento-venduto-chiude-la-trattativa.sql) hanno preso lo
-- stesso `data_vendita` sbagliato in `chiuso_il`: stessa correzione, solo
-- sulle righe che l'automatismo ha scritto (`stato_da = 'sync-info4u'`) — mai
-- su una chiusura fatta a mano da un operatore, che non ha questo bug.
update public.opportunita
set chiuso_il = (chiuso_il at time zone 'UTC') at time zone 'Europe/Rome'
where stato_da = 'sync-info4u' and chiuso_il is not null;

commit;

-- ──────────────────────────────────────────────────────── da verificare dopo

-- L'ultima vendita in tabella dovrebbe ora leggersi vicina all'ora reale di
-- adesso (in UTC: ora italiana meno 2h in CEST, meno 1h in CET) — non più
-- spostata in avanti.
select max(data_vendita) as ultima_vendita_nel_db, now() as adesso_utc
from public.abbonamenti;
