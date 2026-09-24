-- Vista di supporto per ops/sync-info4u/bonifica-fusioni.ps1: le persone
-- fuse dalla vecchia deduplicazione per email/cellulare (prima di
-- 2026-09-23-dedup-nome-cognome.sql), una riga per persona con l'elenco dei
-- source_utente_id coinvolti.
--
-- Perché una vista e non lasciare che lo script legga tutta `abbonamenti`
-- (160mila+ righe) e la raggruppi da solo: significava centinaia di
-- richieste HTTP per un risultato di ~1.422 righe, ed è proprio lì che è
-- emerso un problema di come Windows PowerShell 5.1 disserializza il JSON
-- di una riga con due colonne scalari (persona_id, source_utente_id) — le
-- pagine tornavano da una riga sola. Qui il raggruppamento lo fa il
-- database, e lo script legge direttamente ~1.422 righe con l'elenco dei
-- source_utente_id già in un unico campo array.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-23-dedup-nome-cognome.sql.

create or replace view public.persone_fuse_utenti as
select persona_id, array_agg(distinct source_utente_id order by source_utente_id) as source_utente_ids
from public.abbonamenti
where persona_id is not null and source_utente_id is not null
group by persona_id
having count(distinct source_utente_id) > 1;

comment on view public.persone_fuse_utenti is
	'Persone con più di un source_utente_id agganciato (fuse dalla vecchia deduplicazione per email/cellulare, vedi 2026-09-23-dedup-nome-cognome.sql): una riga per persona fusa, con l''elenco dei source_utente_id coinvolti. Usata da ops/sync-info4u/bonifica-fusioni.ps1 per evitare di paginare tutta la tabella abbonamenti (160mila+ righe) per trovarle.';

alter view public.persone_fuse_utenti set (security_invoker = on);
revoke all on public.persone_fuse_utenti from anon, authenticated;
grant select on public.persone_fuse_utenti to service_role;
