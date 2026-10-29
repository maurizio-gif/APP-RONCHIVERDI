-- Sezione Accessi del CRM: ricerche, grafici di tendenza e gruppi di varchi
-- sugli ingressi del club (tabella `accessi`, 3,4 milioni di righe).
--
-- Un varco si riconosce dalla terna (source_terminale_id, indirizzo,
-- source_concentratore_id): `source_terminale_id` è solo il tipo di lettore
-- (13 o 19) e da solo non basta — «Uscita tornello reception» e «Magazzino
-- ristorante» hanno lo stesso indirizzo e lo stesso concentratore.
--
-- Come per la scheda contatto (2026-10-29-accessi-scheda.sql) i grafici non
-- leggono `accessi`: leggono `accessi_ore`, un riepilogo per giorno, ora,
-- varco ed esito tenuto aggiornato da un trigger a ogni insert della sync.
-- Conta come passaggio l'esito 3 (abbonamento), 100 (gold card) o 25
-- (apertura forzata); gli esiti negativi sono ingressi negati. Le uscite dal
-- tornello sono passaggi come gli altri: Info4U non distingue la direzione.
--
-- Giorno e ora sono quelli di Roma. Da eseguire nel SQL Editor del progetto
-- Supabase Ronchiverdi, nell'ordine dei blocchi; si può rieseguire senza danni.

-- ───────────────────────────────────────────────────────── gruppi di varchi
create table if not exists public.accessi_gruppi (
	id uuid primary key default gen_random_uuid(),
	nome text not null unique,
	colore text not null default '#8b6c14',
	ordine integer not null default 0,
	creato_il timestamptz not null default now()
);

-- Un varco sta in un solo gruppo (la chiave primaria è la terna): chi non ha
-- una riga qui è «Senza gruppo».
create table if not exists public.accessi_gruppi_varchi (
	source_terminale_id integer not null,
	indirizzo integer not null,
	source_concentratore_id integer not null,
	gruppo_id uuid not null references public.accessi_gruppi (id) on delete cascade,
	primary key (source_terminale_id, indirizzo, source_concentratore_id)
);
create index if not exists accessi_gruppi_varchi_gruppo_idx on public.accessi_gruppi_varchi (gruppo_id);

alter table public.accessi_gruppi enable row level security;
alter table public.accessi_gruppi_varchi enable row level security;

-- ───────────────────────────────────────────────── riepilogo per ora e varco
create table if not exists public.accessi_ore (
	giorno date not null,
	ora smallint not null,
	source_terminale_id integer not null,
	indirizzo integer not null,
	source_concentratore_id integer not null,
	tipo_accesso integer not null,
	n integer not null,
	primary key (giorno, ora, source_terminale_id, indirizzo, source_concentratore_id, tipo_accesso)
);
alter table public.accessi_ore enable row level security;

create or replace function public.accessi_ore_aggiorna()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into public.accessi_ore (giorno, ora, source_terminale_id, indirizzo, source_concentratore_id, tipo_accesso, n)
	select
		(r.data_accesso at time zone 'Europe/Rome')::date,
		extract(hour from r.data_accesso at time zone 'Europe/Rome')::smallint,
		r.source_terminale_id, r.indirizzo, r.source_concentratore_id, r.tipo_accesso, count(*)
	from new_rows r
	where r.source_terminale_id is not null and r.indirizzo is not null
		and r.source_concentratore_id is not null and r.tipo_accesso is not null and r.data_accesso is not null
	group by 1, 2, 3, 4, 5, 6
	on conflict (giorno, ora, source_terminale_id, indirizzo, source_concentratore_id, tipo_accesso)
	do update set n = public.accessi_ore.n + excluded.n;
	return null;
end;
$$;

drop trigger if exists accessi_ore_dopo_insert on public.accessi;
create trigger accessi_ore_dopo_insert
	after insert on public.accessi
	referencing new table as new_rows
	for each statement execute function public.accessi_ore_aggiorna();

-- Rifà il riepilogo da zero: per il primo riempimento e se i numeri
-- dovessero mai non tornare con `accessi`.
create or replace function public.accessi_ore_ricostruisci()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	truncate public.accessi_ore;
	insert into public.accessi_ore (giorno, ora, source_terminale_id, indirizzo, source_concentratore_id, tipo_accesso, n)
	select
		(data_accesso at time zone 'Europe/Rome')::date,
		extract(hour from data_accesso at time zone 'Europe/Rome')::smallint,
		source_terminale_id, indirizzo, source_concentratore_id, tipo_accesso, count(*)
	from public.accessi
	where source_terminale_id is not null and indirizzo is not null
		and source_concentratore_id is not null and tipo_accesso is not null and data_accesso is not null
	group by 1, 2, 3, 4, 5, 6;
end;
$$;

-- ─────────────────────────────────────────────────────────────── letture
-- Tutte prendono il periodo come giorni di Roma, estremi compresi.

-- I totali del periodo. `persone` e `visite` vengono da accessi_giorni (un
-- ingresso conta una volta al giorno per persona); i passaggi includono anche
-- quelli senza una persona associata.
create or replace function public.accessi_riepilogo(p_dal date, p_al date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
	select jsonb_build_object(
		'passaggi', coalesce(sum(o.n) filter (where o.tipo_accesso in (3, 100, 25)), 0),
		'negati', coalesce(sum(o.n) filter (where o.tipo_accesso < 0), 0),
		'giorni_aperti', count(distinct o.giorno) filter (where o.tipo_accesso in (3, 100, 25)),
		'persone', (select count(distinct g.source_utente_id) from public.accessi_giorni g where g.giorno between p_dal and p_al),
		'visite', (select count(*) from public.accessi_giorni g where g.giorno between p_dal and p_al)
	)
	from public.accessi_ore o
	where o.giorno between p_dal and p_al;
$$;

-- Passaggi per periodo (giorno, settimana o mese) e per gruppo di varchi;
-- gruppo_id nullo = varchi senza gruppo.
create or replace function public.accessi_serie(p_dal date, p_al date, p_passo text)
returns table (periodo date, gruppo_id uuid, passaggi bigint)
language sql
stable
security definer
set search_path = public
as $$
	select date_trunc(p_passo, o.giorno)::date, gv.gruppo_id, sum(o.n)::bigint
	from public.accessi_ore o
	left join public.accessi_gruppi_varchi gv
		on gv.source_terminale_id = o.source_terminale_id and gv.indirizzo = o.indirizzo
		and gv.source_concentratore_id = o.source_concentratore_id
	where o.giorno between p_dal and p_al and o.tipo_accesso in (3, 100, 25)
	group by 1, 2
	order by 1;
$$;

-- Visite (persona × giorno) e persone diverse per periodo.
create or replace function public.accessi_serie_visite(p_dal date, p_al date, p_passo text)
returns table (periodo date, visite bigint, persone bigint)
language sql
stable
security definer
set search_path = public
as $$
	select date_trunc(p_passo, g.giorno)::date, count(*)::bigint, count(distinct g.source_utente_id)::bigint
	from public.accessi_giorni g
	where g.giorno between p_dal and p_al
	group by 1
	order by 1;
$$;

create or replace function public.accessi_per_varco(p_dal date, p_al date)
returns table (
	source_terminale_id integer, indirizzo integer, source_concentratore_id integer,
	descrizione text, gruppo_id uuid, passaggi bigint, negati bigint
)
language sql
stable
security definer
set search_path = public
as $$
	select o.source_terminale_id, o.indirizzo, o.source_concentratore_id, t.descrizione, gv.gruppo_id,
		coalesce(sum(o.n) filter (where o.tipo_accesso in (3, 100, 25)), 0)::bigint,
		coalesce(sum(o.n) filter (where o.tipo_accesso < 0), 0)::bigint
	from public.accessi_ore o
	left join public.terminali_info4u t
		on t.source_terminale_id = o.source_terminale_id and t.indirizzo = o.indirizzo
		and t.source_concentratore_id = o.source_concentratore_id
	left join public.accessi_gruppi_varchi gv
		on gv.source_terminale_id = o.source_terminale_id and gv.indirizzo = o.indirizzo
		and gv.source_concentratore_id = o.source_concentratore_id
	where o.giorno between p_dal and p_al
	group by 1, 2, 3, 4, 5;
$$;

-- Affluenza per giorno della settimana (1 = lunedì) e ora: passaggi totali e
-- quanti giorni di quel tipo ci sono nel periodo, per poter dire «in media».
create or replace function public.accessi_mappa_calore(p_dal date, p_al date, p_gruppo uuid default null)
returns table (giorno_settimana integer, ora integer, passaggi bigint, giorni integer)
language sql
stable
security definer
set search_path = public
as $$
	with giorni as (
		select extract(isodow from d)::int dow, count(*)::int n
		from generate_series(p_dal, p_al, interval '1 day') d
		group by 1
	)
	select extract(isodow from o.giorno)::int, o.ora::int, sum(o.n)::bigint, max(g.n)
	from public.accessi_ore o
	join giorni g on g.dow = extract(isodow from o.giorno)::int
	left join public.accessi_gruppi_varchi gv
		on gv.source_terminale_id = o.source_terminale_id and gv.indirizzo = o.indirizzo
		and gv.source_concentratore_id = o.source_concentratore_id
	where o.giorno between p_dal and p_al and o.tipo_accesso in (3, 100, 25)
		and (p_gruppo is null or gv.gruppo_id = p_gruppo)
	group by 1, 2;
$$;

-- Gli ingressi negati, per motivo («Pagamento scaduto», «Certificato medico
-- non valido»...).
create or replace function public.accessi_negati(p_dal date, p_al date)
returns table (tipo_accesso integer, descrizione text, n bigint)
language sql
stable
security definer
set search_path = public
as $$
	select o.tipo_accesso, e.descrizione, sum(o.n)::bigint
	from public.accessi_ore o
	left join public.esiti_accesso e on e.numero_esito = o.tipo_accesso
	where o.giorno between p_dal and p_al and o.tipo_accesso < 0
	group by 1, 2
	order by 3 desc;
$$;

-- Quante persone vengono con quale frequenza: giorni al mese in media, a
-- fasce, così la risposta non dipende dalla lunghezza del periodo.
create or replace function public.accessi_fedelta(p_dal date, p_al date)
returns table (fascia text, ordine integer, persone bigint)
language sql
stable
security definer
set search_path = public
as $$
	with per_persona as (
		select g.source_utente_id, count(*) * 30.0 / greatest(p_al - p_dal + 1, 1) al_mese
		from public.accessi_giorni g
		where g.giorno between p_dal and p_al
		group by 1
	)
	select
		case when al_mese < 1 then 'meno di 1' when al_mese < 4 then '1–3' when al_mese < 8 then '4–7'
			when al_mese < 12 then '8–11' when al_mese < 16 then '12–15' else '16 e più' end,
		case when al_mese < 1 then 1 when al_mese < 4 then 2 when al_mese < 8 then 3
			when al_mese < 12 then 4 when al_mese < 16 then 5 else 6 end,
		count(*)::bigint
	from per_persona
	group by 1, 2
	order by 2;
$$;

-- I soci con un abbonamento in corso che non entrano da almeno p_giorni
-- giorni (o che non sono mai entrati): i primi da richiamare. Mette in testa
-- chi è entrato più di recente, cioè chi ha smesso da poco.
create or replace function public.accessi_inattivi(p_giorni integer, p_limite integer)
returns table (
	persona_id uuid, nome text, cognome text, abbonamento text, data_fine date,
	ultimo_ingresso date, giorni_assenza integer
)
language sql
stable
security definer
set search_path = public
as $$
	with oggi as (select (now() at time zone 'Europe/Rome')::date d),
	soci as (
		select distinct on (p.id) p.id, p.nome, p.cognome, p.source_utente_id, a.abbonamento, a.data_fine
		from public.abbonamenti a
		join public.persone p on p.id = a.persona_id
		cross join oggi
		where a.cancellato_il is null and a.data_disdetta is null
			and (a.data_inizio is null or a.data_inizio <= oggi.d)
			and (a.data_fine is null or a.data_fine >= oggi.d)
		order by p.id, a.data_fine desc nulls first
	)
	select s.id, s.nome, s.cognome, s.abbonamento, s.data_fine, u.ultimo, (oggi.d - u.ultimo)::integer
	from soci s
	cross join oggi
	left join lateral (
		select max(g.giorno) ultimo from public.accessi_giorni g where g.source_utente_id = s.source_utente_id
	) u on true
	where u.ultimo is not null and u.ultimo < oggi.d - p_giorni
	order by u.ultimo desc
	limit p_limite;
$$;

-- Solo la service role (il server del CRM) le può chiamare.
revoke all on function
	public.accessi_ore_aggiorna(), public.accessi_ore_ricostruisci(),
	public.accessi_riepilogo(date, date), public.accessi_serie(date, date, text),
	public.accessi_serie_visite(date, date, text), public.accessi_per_varco(date, date),
	public.accessi_mappa_calore(date, date, uuid), public.accessi_negati(date, date),
	public.accessi_fedelta(date, date), public.accessi_inattivi(integer, integer)
	from public, anon, authenticated;
grant execute on function
	public.accessi_ore_ricostruisci(),
	public.accessi_riepilogo(date, date), public.accessi_serie(date, date, text),
	public.accessi_serie_visite(date, date, text), public.accessi_per_varco(date, date),
	public.accessi_mappa_calore(date, date, uuid), public.accessi_negati(date, date),
	public.accessi_fedelta(date, date), public.accessi_inattivi(integer, integer)
	to service_role;

-- ───────────────────────────────────────────── primo riempimento (a parte)
-- Da eseguire dopo i blocchi sopra; dura qualche decina di secondi.
-- select public.accessi_ore_ricostruisci();
