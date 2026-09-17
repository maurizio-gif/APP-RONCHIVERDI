-- Il Guest Register nel canale di traffico.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-16-trattative-senza-richiesta-nelle-statistiche.sql.
--
-- ─────────────────────────────────────────────────────────────── il perché
--
-- Chi si registra al banco (Guest Register, `form_contatti.origine =
-- 'walk-in'`) tecnicamente scrive nella stessa tabella di chi compila il
-- form del sito — è la segreteria a inserirlo, ma la riga è identica per
-- forma. Quella riga non porta con sé nessuna campagna: niente
-- utm_source/utm_medium, niente referrer, niente click id, perché non è
-- arrivata da un click ma da una persona fisicamente in sede.
--
-- 'coppie_utm' — le coppie sorgente/mezzo grezze che l'app piega sui canali
-- di traffico (vedi perCanaleTraffico in lib/analytics.ts) — le contava
-- comunque, e senza campagna finivano tutte in "Traffico diretto": un club
-- con molti walk-in vedeva il suo traffico diretto gonfiato da persone che
-- non erano mai passate dal sito per convertire, erano già state al banco.
--
-- Questa migration aggiunge `origine` alla proiezione grezza: l'app, non il
-- database, decide come chiamare il canale (qui diventa "Guest Register",
-- prima di guardare UTM o referrer) — la stessa separazione fra "il
-- database calcola i totali" e "l'app li spiega" che regge il resto di
-- questa funzione.
--
-- Nessun'altra colonna del risultato cambia: è la stessa funzione di prima,
-- riscritta per intero perché così la scrive sempre questo file.

CREATE OR REPLACE FUNCTION public.statistiche_richieste(p_da timestamp with time zone, p_a timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
	with r as (
		-- assegnato_a rinominato: form_contatti ha una sua colonna
		-- assegnato_a (il trigger assegna_eventi_della_trattativa la copia
		-- lì), che altrimenti confligge con o.assegnato_a qui sotto — bare
		-- "assegnato_a" diventerebbe ambiguo nell'unione con
		-- senza_richiesta più in basso.
		select f.*, o.stato as stato_trattativa, o.assegnato_a as assegnato_a_trattativa
		from form_contatti f
		left join opportunita o on o.id = f.opportunita_id
		where f.created_at >= p_da and f.created_at < p_a
	),
	-- Le trattative senza nessuna richiesta dietro: nate in agenda o al
	-- banco. Stesse due date con cui 'trattative_aperte' (creato_il) e
	-- 'trattative_vinte'/'perse' (chiuso_il) qui sotto le mettono nel
	-- periodo, unite perché una trattativa aperta e chiusa in momenti
	-- diversi deve comunque comparire nei grafici del periodo giusto.
	senza_richiesta as (
		select o.stato as stato_trattativa, o.assegnato_a
		from opportunita o
		where not exists (select 1 from form_contatti f where f.opportunita_id = o.id)
			and (
				(o.creato_il >= p_da and o.creato_il < p_a)
				or (o.chiuso_il >= p_da and o.chiuso_il < p_a)
			)
	)
	select jsonb_build_object(
		'richieste', (select count(*) from r),
		'lavorate', (select count(*) from r where gestito),
		'con_appuntamento', (select count(*) from r where data_scelta is not null),
		'persone_nuove', (select count(*) from persone where creato_il >= p_da and creato_il < p_a),
		'trattative_aperte', (
			select count(*) from opportunita
			where creato_il >= p_da and creato_il < p_a and stato not in ('vinto', 'perso')
		),
		'trattative_vinte', (
			select count(*) from opportunita where chiuso_il >= p_da and chiuso_il < p_a and stato = 'vinto'
		),
		'trattative_perse', (
			select count(*) from opportunita where chiuso_il >= p_da and chiuso_il < p_a and stato = 'perso'
		),
		'con_sessione', (select count(*) from r where session_id is not null),
		'con_consenso_analytics', (select count(*) from r where consent_analytics),

		-- Andamento per giorno diviso per pubblico, come la serie di TCA
		-- (adulti/junior/altro): la somma nuda nasconde che una campagna
		-- young e una adulti crescono in momenti diversi dell'anno.
		'giorni', coalesce((
			select jsonb_agg(to_jsonb(g) order by g.giorno)
			from (
				select
					(created_at at time zone 'Europe/Rome')::date::text as giorno,
					count(*) as richieste,
					count(*) filter (where audience = 'adulti') as adulti,
					count(*) filter (where audience in ('young', 'famiglia')) as young,
					count(*) filter (where audience is null or audience not in ('adulti', 'young', 'famiglia')) as altro
				from r group by 1
			) g
		), '[]'::jsonb),

		-- Coppie sorgente/mezzo grezze, con l'origine: l'app le classifica in
		-- canali di traffico con la stessa logica di TCA, e mette il Guest
		-- Register a parte prima di guardare UTM/referrer (vedi
		-- perCanaleTraffico in lib/analytics.ts).
		'coppie_utm', coalesce((
			select jsonb_agg(to_jsonb(x))
			from (
				select utm_source, utm_medium, referrer, gclid, fbclid, origine, count(*) as richieste
				from r group by 1, 2, 3, 4, 5, 6
			) x
		), '[]'::jsonb),

		'combinazioni', coalesce((
			select jsonb_agg(to_jsonb(c))
			from (
				select attivita, settore, origine, count(*) as richieste,
					count(*) filter (where gestito) as lavorate
				from r group by 1, 2, 3
			) c
		), '[]'::jsonb),

		'attivita', coalesce((select jsonb_agg(to_jsonb(a) order by a.richieste desc, a.voce) from (
			select coalesce(attivita_label, '(non indicata)') as voce, count(*) as richieste from r group by 1
		) a), '[]'::jsonb),

		'audience', coalesce((select jsonb_agg(to_jsonb(a) order by a.richieste desc) from (
			select coalesce(audience, '(non indicato)') as voce, count(*) as richieste from r group by 1
		) a), '[]'::jsonb),

		'sorgenti', coalesce((select jsonb_agg(to_jsonb(x) order by x.richieste desc, x.voce) from (
			select coalesce(utm_source, '(diretto)') as voce, count(*) as richieste from r group by 1
		) x), '[]'::jsonb),

		'mezzi', coalesce((select jsonb_agg(to_jsonb(x) order by x.richieste desc, x.voce) from (
			select coalesce(utm_medium, '(non indicato)') as voce, count(*) as richieste from r group by 1
		) x), '[]'::jsonb),

		'campagne', coalesce((select jsonb_agg(to_jsonb(x) order by x.richieste desc, x.voce) from (
			select coalesce(utm_campaign, '(nessuna)') as voce, count(*) as richieste from r group by 1
		) x), '[]'::jsonb),

		'termini', coalesce((select jsonb_agg(to_jsonb(x) order by x.richieste desc, x.voce) from (
			select coalesce(utm_term, '(nessun termine)') as voce, count(*) as richieste from r group by 1
		) x), '[]'::jsonb),

		'contenuti', coalesce((select jsonb_agg(to_jsonb(x) order by x.richieste desc, x.voce) from (
			select coalesce(utm_content, '(nessuno)') as voce, count(*) as richieste from r group by 1
		) x), '[]'::jsonb),

		-- First touch: la campagna che ha portato la persona sul sito la prima
		-- volta, che può essere diversa da quella che l'ha fatta convertire.
		'first_sorgenti', coalesce((select jsonb_agg(to_jsonb(x) order by x.richieste desc, x.voce) from (
			select coalesce(first_utm_source, '(non registrata)') as voce, count(*) as richieste from r group by 1
		) x), '[]'::jsonb),

		'first_campagne', coalesce((select jsonb_agg(to_jsonb(x) order by x.richieste desc, x.voce) from (
			select coalesce(first_utm_campaign, '(nessuna)') as voce, count(*) as richieste from r group by 1
		) x), '[]'::jsonb),

		-- Quale click id pubblicitario portava la richiesta: dice quale
		-- piattaforma ha fatto l'ultimo clic, anche senza UTM.
		'click_id', coalesce((select jsonb_agg(to_jsonb(x) order by x.richieste desc) from (
			select
				case
					when gclid is not null then 'Google Ads (gclid)'
					when gbraid is not null or wbraid is not null then 'Google Ads (gbraid/wbraid)'
					when fbclid is not null then 'Meta (fbclid)'
					when ttclid is not null then 'TikTok (ttclid)'
					when msclkid is not null then 'Microsoft (msclkid)'
					when li_fat_id is not null then 'LinkedIn (li_fat_id)'
					else '(nessun click id)'
				end as voce,
				count(*) as richieste
			from r group by 1
		) x), '[]'::jsonb),

		'cta', coalesce((select jsonb_agg(to_jsonb(x) order by x.richieste desc, x.voce) from (
			select coalesce(cta, '(non indicata)') as voce, count(*) as richieste from r group by 1
		) x), '[]'::jsonb),

		'pagine', coalesce((select jsonb_agg(to_jsonb(x) order by x.richieste desc, x.voce) from (
			select coalesce(pagina, '(non indicata)') as voce, count(*) as richieste
			from r group by 1 order by count(*) desc limit 15
		) x), '[]'::jsonb),

		'landing', coalesce((select jsonb_agg(to_jsonb(x) order by x.richieste desc, x.voce) from (
			select coalesce(landing_page, '(non registrata)') as voce, count(*) as richieste
			from r group by 1 order by count(*) desc limit 15
		) x), '[]'::jsonb),

		'referrer', coalesce((select jsonb_agg(to_jsonb(x) order by x.richieste desc, x.voce) from (
			select coalesce(referrer, '(nessuno)') as voce, count(*) as richieste
			from r group by 1 order by count(*) desc limit 15
		) x), '[]'::jsonb),

		-- Include anche le trattative senza richiesta (agenda, walk-in): sono
		-- assenti da `r`, ma già contate nei totali vinte/perse/aperte qui
		-- sopra — un grafico che le escludesse racconterebbe una storia
		-- diversa dal numero accanto.
		'stati_trattativa', coalesce((select jsonb_agg(to_jsonb(x) order by x.richieste desc) from (
			select coalesce(stato_trattativa, '(nessuna trattativa)') as voce, count(*) as richieste
			from (
				select stato_trattativa from r
				union all
				select stato_trattativa from senza_richiesta
			) t
			group by 1
		) x), '[]'::jsonb),

		'assegnatari', coalesce((select jsonb_agg(to_jsonb(x) order by x.richieste desc, x.voce) from (
			select coalesce(assegnato_a, '(nessun assegnatario)') as voce, count(*) as richieste
			from (
				select assegnato_a_trattativa as assegnato_a from r where opportunita_id is not null
				union all
				select assegnato_a from senza_richiesta
			) t
			group by 1
		) x), '[]'::jsonb),

		'lavorate_da', coalesce((select jsonb_agg(to_jsonb(x) order by x.richieste desc, x.voce) from (
			select coalesce(gestito_da, '(non indicato)') as voce, count(*) as richieste
			from r where gestito group by 1
		) x), '[]'::jsonb)
	);
$function$
;
