-- Sessioni e "persone" (accessi singoli) per mese: la tabella sessioni ha
-- già decine di migliaia di righe (una selezione grezza sfonda subito il
-- limite di 1000 righe di PostgREST, vedi il commento su
-- abbonamenti_scadenze_mensili), quindi l'aggregazione va fatta qui, non
-- lato client. Stessa identica definizione di "persone" della RPC
-- statistiche_visite: chi ha dato il consenso conta una volta sola
-- (distinct visitor_id), le sessioni senza consenso contano una testa
-- ciascuna — una stima per eccesso, non un numero esatto.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq).

create or replace view public.sessioni_mensili as
select
	date_trunc('month', created_at)::date as mese,
	count(*) as sessioni,
	count(distinct visitor_id) + count(*) filter (where visitor_id is null) as persone
from public.sessioni
group by 1;

comment on view public.sessioni_mensili is
	'Sessioni e "persone" (accessi singoli, stima per eccesso) per mese — usata dal grafico Andamento visite sito nella Dashboard direzionale.';
