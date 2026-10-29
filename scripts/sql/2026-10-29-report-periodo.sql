-- Report per periodo (da data A a data B), in PDF: le letture che mancavano.
-- Le altre fonti esistono già e il report le riusa tali e quali, così i numeri
-- coincidono con le pagine da cui arrivano:
--   lead            statistiche_richieste(p_da, p_a)         (Dashboard direzionale)
--   soci attivi     abbonamenti_attivi_al(p_data)            (Dashboard direzionale)
--   accessi         accessi_riepilogo, accessi_per_varco...  (sezione Accessi)
-- Qui ci sono i tre che lavoravano per mese o per giorno e che un periodo
-- libero deve poter sommare: vendite (nuove iscrizioni e rinnovi), scadenze e
-- incassato. Ognuna risponde con un solo jsonb: il report non è limitato alle
-- 1000 righe che PostgREST dà per ogni richiesta.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi; si può
-- rieseguire senza danni.

-- Le vendite di abbonamenti del periodo, per gruppo prodotto e per mese,
-- divise fra nuove iscrizioni (rinnovo = false) e rinnovi. Stessa vista della
-- pagina Abbonamenti (abbonamenti_giornalieri_tipo).
create or replace function public.report_vendite(p_dal date, p_al date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
	select jsonb_build_object(
		'per_gruppo', coalesce((
			select jsonb_agg(to_jsonb(x)) from (
				select gruppo_id, rinnovo, sum(numero_vendite)::bigint as numero, coalesce(sum(fatturato), 0) as fatturato
				from public.abbonamenti_giornalieri_tipo
				where giorno between p_dal and p_al
				group by 1, 2
			) x
		), '[]'::jsonb),
		'per_mese', coalesce((
			select jsonb_agg(to_jsonb(x) order by x.mese) from (
				select date_trunc('month', giorno)::date as mese, rinnovo,
					sum(numero_vendite)::bigint as numero, coalesce(sum(fatturato), 0) as fatturato
				from public.abbonamenti_giornalieri_tipo
				where giorno between p_dal and p_al
				group by 1, 2
			) x
		), '[]'::jsonb)
	);
$$;

-- Gli abbonamenti scaduti nel periodo (data_fine), rinnovati o no. Stessa
-- regola della vista mensile abbonamenti_scadenze_mensili: restano fuori gli
-- esclusi in automatico (escluso_automatico), che non sono mancati rinnovi.
create or replace function public.report_scadenze(p_dal date, p_al date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
	select jsonb_build_object(
		'per_gruppo', coalesce((
			select jsonb_agg(to_jsonb(x)) from (
				select gruppo_id, rinnovato, count(*)::bigint as numero, coalesce(sum(totale), 0) as valore
				from public.abbonamenti_scadenze
				where not escluso_automatico and data_fine between p_dal and p_al
				group by 1, 2
			) x
		), '[]'::jsonb),
		'per_mese', coalesce((
			select jsonb_agg(to_jsonb(x) order by x.mese) from (
				select date_trunc('month', data_fine)::date as mese, rinnovato,
					count(*)::bigint as numero, coalesce(sum(totale), 0) as valore
				from public.abbonamenti_scadenze
				where not escluso_automatico and data_fine between p_dal and p_al
				group by 1, 2
			) x
		), '[]'::jsonb)
	);
$$;

-- L'incassato (movimenti di cassa di Info4U) del periodo: totale per tipo di
-- servizio, per metodo di pagamento e per mese. Stessa vista della pagina
-- Incassato (incassato_giornaliero); il netto è entrate meno uscite.
create or replace function public.report_incassi(p_dal date, p_al date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
	select jsonb_build_object(
		'per_tipo', coalesce((
			select jsonb_agg(to_jsonb(x) order by x.netto desc) from (
				select tipo_servizio, sum(movimenti)::bigint as movimenti, sum(entrate) as entrate, sum(uscite) as uscite, sum(netto) as netto
				from public.incassato_giornaliero
				where giorno between p_dal and p_al
				group by 1
			) x
		), '[]'::jsonb),
		'per_metodo', coalesce((
			select jsonb_agg(to_jsonb(x) order by x.netto desc) from (
				select metodo_pagamento, sum(movimenti)::bigint as movimenti, sum(entrate) as entrate, sum(uscite) as uscite, sum(netto) as netto
				from public.incassato_giornaliero
				where giorno between p_dal and p_al
				group by 1
			) x
		), '[]'::jsonb),
		'per_mese', coalesce((
			select jsonb_agg(to_jsonb(x) order by x.mese) from (
				select date_trunc('month', giorno)::date as mese, sum(entrate) as entrate, sum(uscite) as uscite, sum(netto) as netto
				from public.incassato_giornaliero
				where giorno between p_dal and p_al
				group by 1
			) x
		), '[]'::jsonb)
	);
$$;

-- Solo la service role (il server del CRM) le può chiamare.
revoke all on function public.report_vendite(date, date), public.report_scadenze(date, date), public.report_incassi(date, date)
	from public, anon, authenticated;
grant execute on function public.report_vendite(date, date), public.report_scadenze(date, date), public.report_incassi(date, date)
	to service_role;
