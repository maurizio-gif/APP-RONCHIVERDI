-- Estende l'esclusione delle vendite cancellate in origine (vedi
-- 2026-09-21-abbonamenti-cancellati.sql, che l'aveva applicata solo a
-- abbonamenti_attivi_al) a tutte le altre viste di reportistica che
-- leggono `abbonamenti`: una vendita che un operatore ha cancellato in
-- Info4U dopo il sync non deve contare né come vendita né come fatturato,
-- oltre che non come abbonato attivo.
--
-- Solo `create or replace view`, stessa definizione di prima più
-- `and a.cancellato_il is null` — da eseguire dopo
-- 2026-09-21-abbonamenti-cancellati.sql.

-- ─────────────────────────────────────────── 2026-09-18-abbonamenti-gruppi.sql

create or replace view public.abbonamenti_prodotti as
select
	a.abbonamento as prodotto,
	count(*) as numero_vendite,
	max(a.data_vendita) as ultima_vendita
from public.abbonamenti a
where a.abbonamento is not null
	and a.cancellato_il is null
group by a.abbonamento;

create or replace view public.abbonamenti_giornalieri as
select
	a.data_vendita::date as giorno,
	m.gruppo_id,
	count(*) as numero_vendite,
	sum(a.totale) as fatturato
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
where a.data_vendita is not null
	and a.cancellato_il is null
group by a.data_vendita::date, m.gruppo_id;

create or replace view public.abbonamenti_mensili as
select
	date_trunc('month', a.data_vendita)::date as mese,
	m.gruppo_id,
	count(*) as numero_vendite,
	sum(a.totale) as fatturato
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
where a.data_vendita is not null
	and a.cancellato_il is null
group by date_trunc('month', a.data_vendita)::date, m.gruppo_id;

-- ────────────────────────────────────────── 2026-09-19-abbonamenti-lavorati.sql

create or replace view public.abbonamenti_mensili_lavorati as
select
	date_trunc('month', a.data_vendita)::date as mese,
	m.gruppo_id,
	exists (
		select 1 from public.task t
		where t.stato is distinct from 'annullato'
			and t.data >= (a.data_vendita::date - 30)
			and t.data <= a.data_vendita::date
			and (
				(t.entita = 'persona' and t.entita_id = a.persona_id::text)
				or (t.entita = 'form_contatti' and t.entita_id in (
					select fc.id::text from public.form_contatti fc where fc.persona_id = a.persona_id
				))
			)
	) as lavorata,
	count(*) as numero_vendite,
	sum(a.totale) as fatturato
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
where a.data_vendita is not null
	and a.data_vendita >= (now() - interval '13 months')
	and a.cancellato_il is null
group by 1, 2, 3;

-- ─────────────────────────────────────────── 2026-09-21-dashboard-direzionale.sql

create or replace view public.abbonamenti_giornalieri_canale as
select
	a.data_vendita::date as giorno,
	(pc.persona_id is not null) as ha_richiesta,
	pc.prima_origine,
	count(*) as numero_vendite,
	sum(a.totale) as fatturato
from public.abbonamenti a
left join public.persone_primo_canale pc on pc.persona_id = a.persona_id
where a.data_vendita is not null
	and a.cancellato_il is null
group by 1, 2, 3;

create or replace view public.abbonamenti_mensili_canale as
select
	date_trunc('month', a.data_vendita)::date as mese,
	(pc.persona_id is not null) as ha_richiesta,
	pc.prima_origine,
	count(*) as numero_vendite,
	sum(a.totale) as fatturato
from public.abbonamenti a
left join public.persone_primo_canale pc on pc.persona_id = a.persona_id
where a.data_vendita is not null
	and a.cancellato_il is null
group by 1, 2, 3;
