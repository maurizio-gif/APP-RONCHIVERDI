-- Punto 5 della pagina Abbonamenti ("Andamento venduto"): da un grafico per
-- gruppo prodotto a un grafico nuovo/rinnovo, sugli ultimi 24 mesi invece di
-- 12. Stessa distinzione di abbonamenti_vendite_tipo (vedi
-- 2026-09-22-abbonamenti-vendite-tipo.sql), aggregata per mese invece che
-- per giorno: 24 mesi di righe giornaliere per gruppo sarebbero comunque
-- oltre le 1000 righe che PostgREST tronca a una select (stesso problema
-- già risolto altrove in questo pannello aggregando lato database, vedi
-- abbonamenti_scadenze_mensili).
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-22-abbonamenti-vendite-tipo.sql.

create or replace view public.abbonamenti_mensili_tipo as
select
	date_trunc('month', giorno)::date as mese,
	gruppo_id,
	rinnovo,
	count(*) as numero_vendite,
	sum(totale) as fatturato
from public.abbonamenti_vendite_tipo
group by 1, 2, 3;

comment on view public.abbonamenti_mensili_tipo is
	'Conteggio e fatturato delle vendite per mese, gruppo e nuovo/rinnovo — per il grafico "Andamento venduto" di /dashboard/abbonamenti (ultimi 24 mesi). Eredita la definizione di "rinnovo" da abbonamenti_vendite_tipo.';
