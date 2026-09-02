-- Statistiche delle visite al sito per la sezione "Visite al sito".
--
-- Da eseguire nel SQL Editor di Supabase dopo le migration del sito
-- (sessioni, sessioni_pagine) e 2026-09-02-staff-e-audit.sql.
--
-- Tutto in una funzione che ritorna un solo jsonb: l'alternativa era portare
-- le righe nell'app e raggrupparle in memoria, che funziona con quattro
-- sessioni e smette di funzionare con quarantamila. Il client Supabase non sa
-- fare GROUP BY, quindi l'aggregazione sta qui.

create or replace function public.statistiche_visite(p_da timestamptz, p_a timestamptz)
returns jsonb
language sql
security definer
set search_path = public
as $$
	with s as (
		select * from sessioni where created_at >= p_da and created_at < p_a
	),
	pag as (
		select p.pagina, p.session_id
		from sessioni_pagine p
		join s on s.session_id = p.session_id
	)
	select jsonb_build_object(
		'sessioni', (select count(*) from s),
		'convertite', (select count(*) from s where convertita),
		-- Visitatori distinti: contabile solo per chi ha dato il consenso,
		-- perché senza consenso il visitor_id non viene nemmeno generato.
		'visitatori', (select count(distinct visitor_id) from s where visitor_id is not null),
		'con_consenso', (select count(*) from s where consent_analytics),
		'pagine_medie', (select coalesce(round(avg(pagine_viste), 1), 0) from s),

		'campagne', coalesce((
			select jsonb_agg(to_jsonb(c) order by c.sessioni desc, c.campagna)
			from (
				select
					-- Una sessione senza utm_source non è "nessuna sorgente":
					-- è arrivata direttamente o da un link. Distinguerle è
					-- l'unico modo di leggere il traffico non pubblicitario.
					coalesce(utm_source, case when referrer is null then '(diretto)' else '(referral)' end) as sorgente,
					coalesce(utm_medium, '—') as mezzo,
					coalesce(utm_campaign, '—') as campagna,
					count(*) as sessioni,
					count(*) filter (where convertita) as lead
				from s
				group by 1, 2, 3
			) c
		), '[]'::jsonb),

		'pagine', coalesce((
			select jsonb_agg(to_jsonb(x) order by x.viste desc, x.pagina)
			from (
				select pagina, count(*) as viste, count(distinct session_id) as sessioni
				from pag group by pagina order by count(*) desc limit 15
			) x
		), '[]'::jsonb),

		'dispositivi', coalesce((
			select jsonb_agg(to_jsonb(d) order by d.sessioni desc)
			from (
				select coalesce(dispositivo, '—') as dispositivo, count(*) as sessioni
				from s group by 1
			) d
		), '[]'::jsonb),

		'citta', coalesce((
			select jsonb_agg(to_jsonb(t) order by t.sessioni desc)
			from (
				select coalesce(citta, '—') as citta, coalesce(paese, '—') as paese, count(*) as sessioni
				from s group by 1, 2 order by count(*) desc limit 10
			) t
		), '[]'::jsonb)
	);
$$;

revoke all on function public.statistiche_visite(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.statistiche_visite(timestamptz, timestamptz) to service_role;
