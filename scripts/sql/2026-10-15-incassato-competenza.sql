-- Incassato per competenza e risconti passivi (pagina /dashboard/incassato,
-- vista «Competenza»).
--
-- Il report dell'incassato è per cassa: un annuale pagato a gennaio pesa tutto
-- su gennaio. Qui lo stesso incasso si ridistribuisce sui mesi in cui
-- l'abbonamento è goduto, in proporzione ai giorni:
--
--  - ogni movimento collegato a una vendita presente (pagamento, rate, saldi,
--    acconti, storni: tutti) si spalma dalla DATA DI INIZIO alla DATA DI FINE
--    dell'abbonamento, come sono in Info4U. È la regola giusta anche per le
--    Young School, pagate a settembre per tutta la stagione: la durata
--    venduta («8 mesi») non dice fin dove arriva la stagione, la data di fine
--    sì (maggio o giugno);
--  - senza data di fine, il giorno dell'incasso;
--  - tutto il resto — movimenti senza vendita (cauzioni, tesseramenti,
--    prenotazioni, borsellino), eliminazioni, vendite cancellate in Info4U — è
--    di competenza del giorno in cui è entrato.
--
-- Una rata pagata a giugno su un annuale iniziato a gennaio si spalma anch'essa
-- da gennaio a dicembre: la competenza di un mese passato può quindi crescere
-- quando arrivano rate e saldi che gli appartengono. Sommando tutti i mesi, il
-- totale per competenza è identico al totale per cassa.
--
-- RISCONTI PASSIVI: la parte degli incassi già ricevuti che appartiene a giorni
-- successivi a oggi. Nella seconda vista, divisa per gruppo prodotto e per mese
-- in cui diventerà ricavo.
--
-- Il calcolo su tutta la storia (oltre 120.000 movimenti) richiede qualche
-- secondo: le due viste sono materializzate e si ricalcolano ogni ora con
-- pg_cron (in fondo), come i movimenti arrivano con la sync di Info4U.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-10-07-incassato-report.sql.

-- ─────────────────────────────── ogni movimento, con il suo periodo di competenza

create or replace view public.incassi_periodo_competenza
with (security_invoker = true) as
select
	t.id,
	t.importo,
	g.giorno as giorno_incasso,
	p.inizio,
	greatest(p.inizio, coalesce(p.fine_abbonamento, g.giorno)) as fine,
	coalesce(gr.nome, case when a.id is null then 'Altri incassi' else 'Non categorizzato' end) as gruppo
from public.transazioni t
left join public.abbonamenti a
	on a.source_iscrizione_id = t.source_iscrizione_id
	and a.cancellato_il is null
	-- Il movimento con cui Info4U elimina una vendita non è un incasso
	-- dell'abbonamento: resta nel giorno in cui è avvenuto (vedi
	-- transazioni_dettaglio.collegamento).
	and t.causale not ilike 'ABBONAMENTI: Elimina%'
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
left join public.abbonamenti_gruppi gr on gr.id = m.gruppo_id
cross join lateral (select (t.data_operazione at time zone 'Europe/Rome')::date as giorno) g
cross join lateral (
	select
		coalesce(a.data_inizio, g.giorno) as inizio,
		case when a.id is null or a.data_inizio is null then null else a.data_fine end as fine_abbonamento
) p
where t.cancellato_il is null
	and t.data_operazione <= now();

comment on view public.incassi_periodo_competenza is
	'Un movimento di cassa per riga con il periodo su cui è di competenza: dalla data di inizio alla data di fine dell''abbonamento, oppure il solo giorno dell''incasso per i movimenti senza vendita. Base delle viste incassi_competenza_mensile e risconti_passivi.';

revoke all on public.incassi_periodo_competenza from anon, authenticated;

-- ─────────────────────────────────────────── competenza e cassa, mese per mese

drop materialized view if exists public.incassi_competenza_mensile;
create materialized view public.incassi_competenza_mensile as
with base as materialized (
	select * from public.incassi_periodo_competenza
),
competenza as (
	select
		mm.mese,
		b.gruppo,
		sum(
			b.importo
			* (least(b.fine, (mm.mese + interval '1 month - 1 day')::date) - greatest(b.inizio, mm.mese) + 1)::numeric
			/ (b.fine - b.inizio + 1)
		) as competenza
	from base b
	cross join lateral (
		select generate_series(date_trunc('month', b.inizio), date_trunc('month', b.fine), interval '1 month')::date as mese
	) mm
	group by mm.mese, b.gruppo
),
cassa as (
	select date_trunc('month', b.giorno_incasso)::date as mese, b.gruppo, sum(b.importo) as cassa
	from base b
	group by 1, 2
)
select
	coalesce(c.mese, k.mese) as mese,
	coalesce(c.gruppo, k.gruppo) as gruppo,
	round(coalesce(k.cassa, 0), 2) as cassa,
	round(coalesce(c.competenza, 0), 2) as competenza
from competenza c
full join cassa k on k.mese = c.mese and k.gruppo = c.gruppo;

create unique index incassi_competenza_mensile_key on public.incassi_competenza_mensile (mese, gruppo);

comment on materialized view public.incassi_competenza_mensile is
	'Per mese e gruppo prodotto: incassato per cassa (giorno del movimento) e per competenza (ridistribuito sui giorni dell''abbonamento, da data inizio a data fine). Ricalcolata ogni ora da pg_cron.';

revoke all on public.incassi_competenza_mensile from anon, authenticated;

-- ─────────────────────────────────────────────────── risconti passivi a oggi

drop materialized view if exists public.risconti_passivi;
create materialized view public.risconti_passivi as
with oggi as (
	select (now() at time zone 'Europe/Rome')::date as giorno
),
aperti as (
	-- Incassati entro oggi, con giorni di competenza dopo oggi.
	select b.importo, b.inizio, b.fine, b.gruppo, greatest(b.inizio, o.giorno + 1) as da
	from public.incassi_periodo_competenza b
	cross join oggi o
	where b.giorno_incasso <= o.giorno
		and b.fine > o.giorno
)
select
	(select giorno from oggi) as calcolato_al,
	a.gruppo,
	mm.mese as mese_rilascio,
	round(sum(
		a.importo
		* (least(a.fine, (mm.mese + interval '1 month - 1 day')::date) - greatest(a.da, mm.mese) + 1)::numeric
		/ (a.fine - a.inizio + 1)
	), 2) as importo
from aperti a
cross join lateral (
	select generate_series(date_trunc('month', a.da), date_trunc('month', a.fine), interval '1 month')::date as mese
) mm
group by a.gruppo, mm.mese;

create unique index risconti_passivi_key on public.risconti_passivi (gruppo, mese_rilascio);

comment on materialized view public.risconti_passivi is
	'Risconti passivi alla data calcolato_al: la parte degli incassi già ricevuti che è di competenza dei giorni successivi, per gruppo prodotto e mese in cui diventerà ricavo. Ricalcolata ogni ora da pg_cron.';

revoke all on public.risconti_passivi from anon, authenticated;

-- ────────────────────────────────────────────────────── ricalcolo ogni ora

create or replace function public.aggiorna_incassi_competenza()
returns void
language sql
security definer
set search_path = public
as $$
	refresh materialized view concurrently public.incassi_competenza_mensile;
	refresh materialized view concurrently public.risconti_passivi;
$$;

revoke all on function public.aggiorna_incassi_competenza() from public, anon, authenticated;
grant execute on function public.aggiorna_incassi_competenza() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'aggiorna-incassi-competenza';
select cron.schedule(
	'aggiorna-incassi-competenza',
	'7 * * * *',
	$$select public.aggiorna_incassi_competenza()$$
);
