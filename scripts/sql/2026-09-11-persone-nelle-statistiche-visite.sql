-- Le persone, non solo le sessioni, in cima a «Visite al sito».
--
-- Da eseguire nel SQL Editor di Supabase. Sostituisce la funzione di
-- 2026-09-02-statistiche-visite.sql aggiungendo un solo campo, `persone`:
-- il resto è identico, riscritto per intero perché `create or replace` di una
-- funzione vuole il corpo completo.
--
-- Finché non gira, il pannello non mostra il riquadro delle persone e resta
-- com'era: il campo semplicemente non arriva, e la pagina non lo inventa.
--
-- ── Come si contano le teste, e perché è una stima ────────────────────────
--
-- Una persona si riconosce dal visitor_id, che vive nel browser e dura nel
-- tempo. Ma nasce solo con il consenso a statistiche o marketing: chi rifiuta
-- il banner non ne ha uno, e le sue visite sono indistinguibili l'una
-- dall'altra.
--
-- Quindi: le sessioni che hanno un visitor_id si raggruppano (tre visite
-- della stessa persona contano una testa), e ognuna di quelle senza conta
-- come una persona a sé. È la stima migliore possibile, e va letta sapendo
-- da che parte sbaglia: **per eccesso**. Se nessuno accetta i cookie, il
-- numero delle persone coincide con quello delle sessioni; più cresce il
-- consenso, più il conteggio si avvicina alle teste vere.

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
		-- Le teste. count(distinct) ignora i null per definizione, quindi il
		-- secondo addendo è esattamente «una persona per ogni visita che non
		-- sappiamo attribuire».
		'persone', (
			select count(distinct visitor_id) + count(*) filter (where visitor_id is null)
			from s
		),
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
