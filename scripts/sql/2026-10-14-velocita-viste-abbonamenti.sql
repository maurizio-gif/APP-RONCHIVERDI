-- Velocità: le viste degli abbonamenti filtrabili per periodo con un indice,
-- e la sincronizzazione Info4U che non riscrive più righe identiche.
--
-- Misurato il 14 ottobre 2026, a database scarico (EXPLAIN ANALYZE): il
-- venduto mensile nuovo/rinnovo degli ultimi 24 mesi 1,3 s, le scadenze
-- mensili 0,6 s, i prodotti 0,7 s — e in produzione, nel pomeriggio, con la
-- sincronizzazione che gira, fino a 7-8 s (pg_stat_statements). La pagina
-- Abbonamenti ne lancia una decina insieme su un'istanza a due core.
--
-- ── 1. Il filtro per giorno e per mese arriva fino alla tabella ──────────
--
-- Le viste raggruppano per `data_vendita::date` e `date_trunc('month',
-- data_vendita)`. Postgres porta il filtro della pagina (giorno >= …, mese
-- in (…)) dentro la vista, ma lì non può usare nessun indice: il cast di un
-- timestamptz a data dipende dal fuso della sessione, quindi non è
-- indicizzabile, e ogni lettura passava tutta la tabella (164.000 vendite dal
-- 1974) — con, per il nuovo/rinnovo, la ricerca di un abbonamento precedente
-- **per ogni vendita della storia**, anche se la pagina ne voleva due anni.
--
-- Qui le stesse espressioni sono scritte con il fuso esplicito, `AT TIME ZONE
-- 'UTC'`, che è immutabile e quindi indicizzabile. Il valore è identico a
-- prima: il database e PostgREST lavorano in UTC (show timezone), che è il
-- fuso con cui `data_vendita::date` veniva già calcolato. Nessun numero nei
-- report cambia; cambia solo quante righe si leggono per ottenerlo.
--
-- Lo stesso per le scadenze, che raggruppano per mese di `data_fine` (una
-- data): `data_fine::timestamptz` dipende dal fuso, `data_fine::timestamp`
-- no, e il primo del mese che ne esce è lo stesso.
--
-- Le colonne delle viste restano quelle, nello stesso ordine e dello stesso
-- tipo: nessuna pagina va toccata. abbonamenti_vendite_tipo guadagna in coda
-- la colonna `mese`, che serve ad abbonamenti_mensili_tipo per raggruppare
-- senza ricalcolarlo da `giorno`.

create index if not exists abbonamenti_giorno_vendita_idx
	on public.abbonamenti (((data_vendita at time zone 'UTC')::date))
	where cancellato_il is null;

create index if not exists abbonamenti_mese_vendita_idx
	on public.abbonamenti ((date_trunc('month', data_vendita at time zone 'UTC')::date))
	where cancellato_il is null;

create index if not exists abbonamenti_mese_fine_idx
	on public.abbonamenti ((date_trunc('month', data_fine::timestamp)::date))
	where cancellato_il is null and data_fine is not null;

create or replace view public.abbonamenti_giornalieri as
select
	(a.data_vendita at time zone 'UTC')::date as giorno,
	m.gruppo_id,
	count(*) as numero_vendite,
	sum(a.totale) as fatturato
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
where a.data_vendita is not null and a.cancellato_il is null
group by ((a.data_vendita at time zone 'UTC')::date), m.gruppo_id;

create or replace view public.abbonamenti_mensili as
select
	date_trunc('month', a.data_vendita at time zone 'UTC')::date as mese,
	m.gruppo_id,
	count(*) as numero_vendite,
	sum(a.totale) as fatturato
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
where a.data_vendita is not null and a.cancellato_il is null
group by (date_trunc('month', a.data_vendita at time zone 'UTC')::date), m.gruppo_id;

create or replace view public.abbonamenti_giornalieri_canale as
select
	(a.data_vendita at time zone 'UTC')::date as giorno,
	pc.persona_id is not null as ha_richiesta,
	pc.prima_origine,
	count(*) as numero_vendite,
	sum(a.totale) as fatturato
from public.abbonamenti a
left join public.persone_primo_canale pc on pc.persona_id = a.persona_id
where a.data_vendita is not null and a.cancellato_il is null
group by ((a.data_vendita at time zone 'UTC')::date), (pc.persona_id is not null), pc.prima_origine;

create or replace view public.abbonamenti_mensili_canale as
select
	date_trunc('month', a.data_vendita at time zone 'UTC')::date as mese,
	pc.persona_id is not null as ha_richiesta,
	pc.prima_origine,
	count(*) as numero_vendite,
	sum(a.totale) as fatturato
from public.abbonamenti a
left join public.persone_primo_canale pc on pc.persona_id = a.persona_id
where a.data_vendita is not null and a.cancellato_il is null
group by (date_trunc('month', a.data_vendita at time zone 'UTC')::date), (pc.persona_id is not null), pc.prima_origine;

create or replace view public.abbonamenti_vendite_tipo as
select
	a.id,
	(a.data_vendita at time zone 'UTC')::date as giorno,
	m.gruppo_id,
	a.totale,
	(exists (
		select 1
		from public.abbonamenti r
		left join public.abbonamenti_mappatura mr on mr.prodotto = r.abbonamento
		where r.persona_id = a.persona_id
			and r.cancellato_il is null
			and r.id <> a.id
			and r.data_fine >= (a.data_inizio - 30)
			and r.data_fine <= a.data_inizio
			and not mr.gruppo_id is distinct from m.gruppo_id
			and coalesce(mr.no_abbonamento, false) = false
	)) as rinnovo,
	date_trunc('month', a.data_vendita at time zone 'UTC')::date as mese
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
where a.cancellato_il is null
	and a.data_vendita is not null
	and a.persona_id is not null
	and coalesce(m.no_abbonamento, false) = false;

create or replace view public.abbonamenti_mensili_tipo as
select
	mese,
	gruppo_id,
	rinnovo,
	count(*) as numero_vendite,
	sum(totale) as fatturato
from public.abbonamenti_vendite_tipo
group by mese, gruppo_id, rinnovo;

create or replace view public.abbonamenti_scadenze_mensili as
select
	date_trunc('month', data_fine::timestamp)::date as mese,
	gruppo_id,
	rinnovato,
	count(*) as numero,
	sum(coalesce(totale, 0::numeric)) as valore
from public.abbonamenti_scadenze
group by (date_trunc('month', data_fine::timestamp)::date), gruppo_id, rinnovato;

create or replace view public.abbonamenti_pass_mensili as
select
	date_trunc('month', data_fine::timestamp)::date as mese,
	count(distinct persona_id) as pass_scaduti,
	count(distinct persona_id) filter (where convertito) as convertiti,
	count(*) as guest_pass
from public.abbonamenti_pass_conversioni
group by (date_trunc('month', data_fine::timestamp)::date);

-- ── 2. I prodotti: un ordinamento per prodotto invece di due ─────────────
--
-- Il listino e la categoria «più recenti» erano due array_agg ordinati per
-- data su tutte le vendite di ogni prodotto, solo per prenderne il primo
-- elemento. DISTINCT ON fa la stessa scelta (la vendita più recente, con le
-- vendite senza data in testa come faceva `order by … desc`) appoggiandosi a
-- un indice, e il resto è un'aggregazione semplice.

create index if not exists abbonamenti_prodotto_vendita_idx
	on public.abbonamenti (abbonamento, data_vendita desc)
	where abbonamento is not null;

create or replace view public.abbonamenti_prodotti as
with conti as (
	select
		abbonamento,
		count(*) as numero_vendite,
		max(data_vendita) as ultima_vendita,
		array_remove(array_agg(distinct variante order by variante), null::text) as varianti,
		coalesce(sum(totale) filter (where cancellato_il is null), 0::numeric) as fatturato,
		round(avg(totale) filter (where cancellato_il is null and totale > 0::numeric), 2) as prezzo_medio
	from public.abbonamenti
	where abbonamento is not null
	group by abbonamento
),
recente as (
	select distinct on (abbonamento) abbonamento, importo_listino, categoria
	from public.abbonamenti
	where abbonamento is not null
	order by abbonamento, data_vendita desc
)
select
	c.abbonamento as prodotto,
	c.numero_vendite,
	c.ultima_vendita,
	c.varianti,
	-- Il tipo della colonna resta numeric (array_agg lo perdeva): CREATE OR
	-- REPLACE VIEW non accetta che cambi, nemmeno in numeric(12,2).
	r.importo_listino::numeric as importo_listino_recente,
	r.categoria,
	c.fatturato,
	c.prezzo_medio
from conti c
join recente r on r.abbonamento = c.abbonamento;

-- ── 3. L'anagrafica con i conteggi delle richieste ───────────────────────
--
-- Prima: tutte le persone (23.000, quasi tutte da Info4U senza nessuna
-- richiesta) unite alle richieste e raggruppate per persona. Ora si
-- raggruppano le richieste (qualche centinaio) e il risultato si aggancia
-- alle persone: stessi numeri, zero dove non ce n'è nessuna — come il
-- count() di prima su una riga senza corrispondenza. security_invoker resta
-- com'era: CREATE OR REPLACE VIEW sostituisce le opzioni della vista, e senza
-- riscriverla qui la si perderebbe.

create or replace view public.persone_con_richieste with (security_invoker = on) as
select
	p.id,
	p.creato_il,
	p.aggiornato_il,
	p.nome,
	p.cognome,
	p.email,
	p.cellulare,
	p.note,
	coalesce(f.richieste, 0::bigint) as richieste,
	coalesce(f.richieste_da_lavorare, 0::bigint) as richieste_da_lavorare,
	f.prima_richiesta,
	f.ultima_richiesta
from public.persone p
left join (
	select
		persona_id,
		count(*) as richieste,
		count(*) filter (where not gestito) as richieste_da_lavorare,
		min(created_at) as prima_richiesta,
		max(created_at) as ultima_richiesta
	from public.form_contatti
	where persona_id is not null
	group by persona_id
) f on f.persona_id = p.id;

-- ── 4. La sincronizzazione non riscrive righe identiche ──────────────────
--
-- sync-abbonamenti.ps1 rimanda ogni pochi minuti le vendite ancora aperte e
-- le loro persone con un upsert (merge-duplicates) o una PATCH: a ogni giro
-- Postgres scriveva una nuova versione di ogni riga anche quando nessun
-- campo era cambiato — 7,3 milioni di update su abbonamenti e 4,9 milioni su
-- persone in due mesi, per tabelle da 164.000 e 23.000 righe. Ogni versione
-- è scrittura su disco, WAL e lavoro per l'autovacuum, nelle stesse ore in
-- cui la segreteria usa il pannello.
--
-- suppress_redundant_updates_trigger() è la funzione di Postgres fatta per
-- questo: se la riga nuova è identica alla vecchia, l'update non avviene.
-- Una riga davvero cambiata si aggiorna come prima, con i suoi trigger
-- (abbonamenti_registra_variazione_scadenza scatta solo se data_fine
-- cambia, quindi su una riga identica non avrebbe fatto niente comunque).
-- Il nome comincia per zz_ perché i trigger BEFORE scattano in ordine
-- alfabetico, e questo deve vedere la riga come la lasciano gli altri.

drop trigger if exists zz_salta_update_identici on public.abbonamenti;
create trigger zz_salta_update_identici
	before update on public.abbonamenti
	for each row execute function suppress_redundant_updates_trigger();

drop trigger if exists zz_salta_update_identici on public.persone;
create trigger zz_salta_update_identici
	before update on public.persone
	for each row execute function suppress_redundant_updates_trigger();

analyze public.abbonamenti;
