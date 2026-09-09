-- Il contatto creato a mano dalla segreteria.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-08-eventi-collegati.sql.
--
-- Non cambia niente di strutturale, ed è di proposito: l'anagrafica ha già
-- tutto quello che serve. Chi crea un contatto dall'agenda passa da
-- `trova_o_crea_persona` — la stessa funzione che usa il trigger delle
-- richieste dal sito — con `p_fonte = 'inserimento_manuale'`, e la
-- deduplicazione continua a farla il database: stessa email o stesso numero,
-- stessa riga, anche scritti in modo diverso.
--
-- Questo file serve a due cose:
--
--   1. scrivere nello schema il terzo valore di `persone.fonte`, che finora
--      il commento della colonna non conosceva: chi legge la tabella dal SQL
--      Editor deve trovarci il vocabolario completo, non due valori su tre;
--   2. dare il conto di quante righe sono nate così, per rileggerlo dopo.
--
-- I valori di `fonte`, e cosa vuol dire ciascuno, stanno anche in
-- lib/persone.ts (FONTE_FORM, FONTE_MIGRAZIONE, FONTE_MANUALE).

comment on column public.persone.fonte is
	'Da dove viene la riga: ''form_contatti'' se la persona ha scritto dal sito (la scrive il trigger su form_contatti), ''migrazione'' se è stata importata da un elenco preesistente (nasce storico), ''inserimento_manuale'' se l''ha creata la segreteria dal form dell''agenda, per fissare qualcosa a chi non ha mai compilato un form. La fonte si scrive alla creazione e non si sovrascrive: trova_o_crea_persona la completa solo se manca.';

-- Quante righe per fonte, per sapere da dove viene l'anagrafica. Le vecchie
-- righe possono avere fonte nulla: sono di prima che la colonna esistesse, e
-- restano tali — riscriverle adesso vorrebbe dire inventarsi da dove
-- venivano.
select coalesce(fonte, '(non indicata)') as fonte, count(*) as quante
from public.persone
group by 1
order by 2 desc;
