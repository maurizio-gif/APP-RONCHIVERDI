-- Anche le note sul mancato rinnovo diventano uno storico, con la stessa
-- forma delle note di gestione (2026-10-05-abbonamenti-scadenze-note-storico.sql):
-- una riga per nota inviata, con autore e orario. Stessa tabella, con una
-- colonna `tipo` che dice a quale delle due colonne della tabella Rinnovi
-- Core appartiene: due tabelle gemelle sarebbero lo stesso codice scritto
-- due volte.
--
-- abbonamenti_scadenze_lavorazione.note_non_rinnovo resta, scritta con il
-- testo dell'ultima nota inviata, come `nota` per le note di gestione.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-10-05-abbonamenti-scadenze-durata.sql.

alter table public.abbonamenti_scadenze_note
	add column if not exists tipo text not null default 'gestione';

alter table public.abbonamenti_scadenze_note
	drop constraint if exists abbonamenti_scadenze_note_tipo_check;
alter table public.abbonamenti_scadenze_note
	add constraint abbonamenti_scadenze_note_tipo_check check (tipo in ('gestione', 'non_rinnovo'));

comment on column public.abbonamenti_scadenze_note.tipo is
	'gestione = nota di gestione del rinnovo; non_rinnovo = nota sul mancato rinnovo (colonna "Note non rinnovo").';

-- Le note sul mancato rinnovo già scritte nel campo unico (in buona parte
-- arrivate dal foglio Excel "REPORT RINNOVI") diventano la prima voce dello
-- storico, senza autore — stessa ragione delle note di gestione: chi ha
-- toccato per ultimo la riga non è per forza chi ha scritto la nota. Il not
-- exists rende lo script rieseguibile.
insert into public.abbonamenti_scadenze_note (abbonamento_id, tipo, testo, autore, creato_il)
select l.abbonamento_id, 'non_rinnovo', btrim(l.note_non_rinnovo), null, l.aggiornato_il
from public.abbonamenti_scadenze_lavorazione l
where l.note_non_rinnovo is not null
	and btrim(l.note_non_rinnovo) <> ''
	and not exists (
		select 1 from public.abbonamenti_scadenze_note n
		where n.abbonamento_id = l.abbonamento_id and n.tipo = 'non_rinnovo'
	);
