-- Punto 2 della pagina Abbonamenti ("Abbonamenti in scadenza"): i pulsanti
-- mese per mese mostravano solo il numero di abbonamenti, non il loro valore
-- economico. abbonamenti_scadenze_mensili (vedi
-- 2026-09-21-abbonamenti-scadenze.sql) aggrega già per mese/gruppo/rinnovato
-- — basta sommare anche `totale` nello stesso group by, nessuna vista nuova.
--
-- coalesce(totale, 0): una manciata di righe storiche ha totale null (mai
-- registrato in Info4U), sum() le ignorerebbe comunque ma senza coalesce il
-- risultato resterebbe corretto solo per caso — meglio esplicito.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-24-abbonamenti-scadenze-no-abbonamento-fix.sql.

create or replace view public.abbonamenti_scadenze_mensili as
select
	date_trunc('month', data_fine)::date as mese,
	gruppo_id,
	rinnovato,
	count(*) as numero,
	sum(coalesce(totale, 0)) as valore
from public.abbonamenti_scadenze
group by 1, 2, 3;

comment on view public.abbonamenti_scadenze_mensili is
	'Conteggio e valore economico delle scadenze per mese, gruppo e stato di rinnovo — per i riquadri riassuntivi di /dashboard/abbonamenti (sezione 2: totale in scadenza, già rinnovato, da rinnovare); per l''elenco riga per riga usa abbonamenti_scadenze (paginata, non in un colpo solo: PostgREST tronca a 1000 righe).';
