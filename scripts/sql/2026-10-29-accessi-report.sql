-- Report degli accessi per ingresso (varco) e per nominativo: quanti passaggi
-- e quante teste (persone diverse) per giorno, per varco e per persona, su
-- una scelta qualsiasi di varchi.
--
-- `accessi_ore` sa quanti passaggi ci sono per varco ma non chi è passato;
-- `accessi_giorni` sa chi è entrato ma non da quale varco. Per contare le
-- teste su un sottoinsieme di varchi serve il legame persona + giorno +
-- varco: `accessi_persone_varchi`, una riga per persona, giorno e varco,
-- tenuta aggiornata da un trigger a ogni insert della sync (come le altre due).
--
-- Conta come passaggio l'esito 3 (abbonamento), 100 (gold card) o 25
-- (apertura forzata). Info4U non dice se un passaggio è un'entrata o
-- un'uscita: i numeri sono passaggi. I passaggi senza persona associata
-- entrano nei passaggi ma non nelle teste. Giorno e ora sono quelli di Roma.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi, dopo
-- 2026-10-29-accessi-sezione.sql (si può rieseguire senza danni).

create table if not exists public.accessi_persone_varchi (
	giorno date not null,
	source_utente_id integer not null,
	source_terminale_id integer not null,
	indirizzo integer not null,
	source_concentratore_id integer not null,
	n integer not null,
	primary key (giorno, source_utente_id, source_terminale_id, indirizzo, source_concentratore_id)
);
create index if not exists accessi_persone_varchi_utente_idx on public.accessi_persone_varchi (source_utente_id, giorno);
alter table public.accessi_persone_varchi enable row level security;

create or replace function public.accessi_persone_varchi_aggiorna()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into public.accessi_persone_varchi (giorno, source_utente_id, source_terminale_id, indirizzo, source_concentratore_id, n)
	select
		(r.data_accesso at time zone 'Europe/Rome')::date, r.source_utente_id,
		r.source_terminale_id, r.indirizzo, r.source_concentratore_id, count(*)
	from new_rows r
	where r.tipo_accesso in (3, 100, 25) and r.source_utente_id is not null and r.data_accesso is not null
		and r.source_terminale_id is not null and r.indirizzo is not null and r.source_concentratore_id is not null
	group by 1, 2, 3, 4, 5
	on conflict (giorno, source_utente_id, source_terminale_id, indirizzo, source_concentratore_id)
	do update set n = public.accessi_persone_varchi.n + excluded.n;
	return null;
end;
$$;

drop trigger if exists accessi_persone_varchi_dopo_insert on public.accessi;
create trigger accessi_persone_varchi_dopo_insert
	after insert on public.accessi
	referencing new table as new_rows
	for each statement execute function public.accessi_persone_varchi_aggiorna();

-- Rifà il riepilogo da zero: per il primo riempimento e se i numeri
-- dovessero mai non tornare con `accessi`.
create or replace function public.accessi_persone_varchi_ricostruisci()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	truncate public.accessi_persone_varchi;
	insert into public.accessi_persone_varchi (giorno, source_utente_id, source_terminale_id, indirizzo, source_concentratore_id, n)
	select
		(data_accesso at time zone 'Europe/Rome')::date, source_utente_id,
		source_terminale_id, indirizzo, source_concentratore_id, count(*)
	from public.accessi
	where tipo_accesso in (3, 100, 25) and source_utente_id is not null and data_accesso is not null
		and source_terminale_id is not null and indirizzo is not null and source_concentratore_id is not null
	group by 1, 2, 3, 4, 5;
end;
$$;

-- ─────────────────────────────────────────────────────────────── letture
-- Tutte prendono il periodo come giorni di Roma, estremi compresi.
-- p_varchi: i varchi scelti come testo `terminale-indirizzo-concentratore`
-- (null = tutti). p_utenti: i source_utente_id delle persone scelte (null =
-- tutte); con una persona scelta anche i passaggi vengono dal legame
-- persona-varco, perché `accessi_ore` non sa chi è passato.

-- I totali: passaggi, teste (persone diverse nel periodo), visite (persona ×
-- giorno) e giorni in cui c'è stato almeno un passaggio.
create or replace function public.accessi_report_totali(p_dal date, p_al date, p_varchi text[], p_utenti integer[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
	passaggi bigint;
	giorni_aperti bigint;
	v record;
begin
	if p_utenti is null then
		select coalesce(sum(o.n), 0), count(distinct o.giorno) into passaggi, giorni_aperti
		from public.accessi_ore o
		where o.giorno between p_dal and p_al and o.tipo_accesso in (3, 100, 25)
			and (p_varchi is null or (o.source_terminale_id || '-' || o.indirizzo || '-' || o.source_concentratore_id) = any (p_varchi));
	else
		select coalesce(sum(a.n), 0), count(distinct a.giorno) into passaggi, giorni_aperti
		from public.accessi_persone_varchi a
		where a.giorno between p_dal and p_al and a.source_utente_id = any (p_utenti)
			and (p_varchi is null or (a.source_terminale_id || '-' || a.indirizzo || '-' || a.source_concentratore_id) = any (p_varchi));
	end if;

	select count(distinct t.source_utente_id) teste, count(*) visite into v
	from (
		select distinct a.source_utente_id, a.giorno
		from public.accessi_persone_varchi a
		where a.giorno between p_dal and p_al
			and (p_utenti is null or a.source_utente_id = any (p_utenti))
			and (p_varchi is null or (a.source_terminale_id || '-' || a.indirizzo || '-' || a.source_concentratore_id) = any (p_varchi))
	) t;

	return jsonb_build_object('passaggi', passaggi, 'giorni_aperti', giorni_aperti, 'teste', v.teste, 'visite', v.visite);
end;
$$;

-- Per giorno: passaggi e teste (persone diverse nel giorno).
create or replace function public.accessi_report_giorni(p_dal date, p_al date, p_varchi text[], p_utenti integer[])
returns table (giorno date, passaggi bigint, teste bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
	if p_utenti is null then
		return query
		select p.giorno, p.passaggi, coalesce(t.teste, 0)::bigint
		from (
			select o.giorno, sum(o.n)::bigint passaggi
			from public.accessi_ore o
			where o.giorno between p_dal and p_al and o.tipo_accesso in (3, 100, 25)
				and (p_varchi is null or (o.source_terminale_id || '-' || o.indirizzo || '-' || o.source_concentratore_id) = any (p_varchi))
			group by o.giorno
		) p
		left join (
			select a.giorno, count(distinct a.source_utente_id) teste
			from public.accessi_persone_varchi a
			where a.giorno between p_dal and p_al
				and (p_varchi is null or (a.source_terminale_id || '-' || a.indirizzo || '-' || a.source_concentratore_id) = any (p_varchi))
			group by a.giorno
		) t on t.giorno = p.giorno
		order by p.giorno;
	else
		return query
		select a.giorno, sum(a.n)::bigint, count(distinct a.source_utente_id)
		from public.accessi_persone_varchi a
		where a.giorno between p_dal and p_al and a.source_utente_id = any (p_utenti)
			and (p_varchi is null or (a.source_terminale_id || '-' || a.indirizzo || '-' || a.source_concentratore_id) = any (p_varchi))
		group by a.giorno
		order by a.giorno;
	end if;
end;
$$;

-- Per varco: passaggi e teste. Solo i varchi con almeno un passaggio.
create or replace function public.accessi_report_varchi(p_dal date, p_al date, p_varchi text[], p_utenti integer[])
returns table (source_terminale_id integer, indirizzo integer, source_concentratore_id integer, passaggi bigint, teste bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
	if p_utenti is null then
		return query
		select p.source_terminale_id, p.indirizzo, p.source_concentratore_id, p.passaggi, coalesce(t.teste, 0)::bigint
		from (
			select o.source_terminale_id, o.indirizzo, o.source_concentratore_id, sum(o.n)::bigint passaggi
			from public.accessi_ore o
			where o.giorno between p_dal and p_al and o.tipo_accesso in (3, 100, 25)
				and (p_varchi is null or (o.source_terminale_id || '-' || o.indirizzo || '-' || o.source_concentratore_id) = any (p_varchi))
			group by 1, 2, 3
		) p
		left join (
			select a.source_terminale_id, a.indirizzo, a.source_concentratore_id, count(distinct a.source_utente_id) teste
			from public.accessi_persone_varchi a
			where a.giorno between p_dal and p_al
				and (p_varchi is null or (a.source_terminale_id || '-' || a.indirizzo || '-' || a.source_concentratore_id) = any (p_varchi))
			group by 1, 2, 3
		) t on t.source_terminale_id = p.source_terminale_id and t.indirizzo = p.indirizzo
			and t.source_concentratore_id = p.source_concentratore_id
		order by p.passaggi desc;
	else
		return query
		select a.source_terminale_id, a.indirizzo, a.source_concentratore_id, sum(a.n)::bigint, count(distinct a.source_utente_id)
		from public.accessi_persone_varchi a
		where a.giorno between p_dal and p_al and a.source_utente_id = any (p_utenti)
			and (p_varchi is null or (a.source_terminale_id || '-' || a.indirizzo || '-' || a.source_concentratore_id) = any (p_varchi))
		group by 1, 2, 3
		order by 4 desc;
	end if;
end;
$$;

-- Per nominativo: passaggi, giorni di presenza e varchi diversi usati.
-- Dalla persona con più passaggi; p_limite taglia la coda.
create or replace function public.accessi_report_persone(p_dal date, p_al date, p_varchi text[], p_utenti integer[], p_limite integer)
returns table (source_utente_id integer, passaggi bigint, giorni bigint, varchi bigint)
language sql
stable
security definer
set search_path = public
as $$
	select a.source_utente_id, sum(a.n)::bigint, count(distinct a.giorno),
		count(distinct (a.source_terminale_id, a.indirizzo, a.source_concentratore_id))
	from public.accessi_persone_varchi a
	where a.giorno between p_dal and p_al
		and (p_utenti is null or a.source_utente_id = any (p_utenti))
		and (p_varchi is null or (a.source_terminale_id || '-' || a.indirizzo || '-' || a.source_concentratore_id) = any (p_varchi))
	group by a.source_utente_id
	order by 2 desc, 1
	limit p_limite;
$$;

-- Il dettaglio di poche persone: per ciascuna, giorno e varco con i passaggi.
-- Serve una scelta esplicita di persone (non si elenca tutto il club).
create or replace function public.accessi_report_dettaglio(p_dal date, p_al date, p_varchi text[], p_utenti integer[])
returns table (
	source_utente_id integer, giorno date,
	source_terminale_id integer, indirizzo integer, source_concentratore_id integer, passaggi bigint
)
language sql
stable
security definer
set search_path = public
as $$
	select a.source_utente_id, a.giorno, a.source_terminale_id, a.indirizzo, a.source_concentratore_id, a.n::bigint
	from public.accessi_persone_varchi a
	where p_utenti is not null and a.source_utente_id = any (p_utenti)
		and a.giorno between p_dal and p_al
		and (p_varchi is null or (a.source_terminale_id || '-' || a.indirizzo || '-' || a.source_concentratore_id) = any (p_varchi))
	order by a.source_utente_id, a.giorno, 3, 4, 5;
$$;

-- Solo la service role (il server del CRM) le può chiamare.
revoke all on function
	public.accessi_persone_varchi_aggiorna(), public.accessi_persone_varchi_ricostruisci(),
	public.accessi_report_totali(date, date, text[], integer[]), public.accessi_report_giorni(date, date, text[], integer[]),
	public.accessi_report_varchi(date, date, text[], integer[]), public.accessi_report_persone(date, date, text[], integer[], integer),
	public.accessi_report_dettaglio(date, date, text[], integer[])
	from public, anon, authenticated;
grant execute on function
	public.accessi_persone_varchi_ricostruisci(),
	public.accessi_report_totali(date, date, text[], integer[]), public.accessi_report_giorni(date, date, text[], integer[]),
	public.accessi_report_varchi(date, date, text[], integer[]), public.accessi_report_persone(date, date, text[], integer[], integer),
	public.accessi_report_dettaglio(date, date, text[], integer[])
	to service_role;

-- ───────────────────────────────────────────── primo riempimento
-- Solo se la tabella è vuota; con 3,4 milioni di accessi dura qualche decina
-- di secondi. Per rifarlo da zero: select public.accessi_persone_varchi_ricostruisci();
do $$
begin
	if not exists (select 1 from public.accessi_persone_varchi limit 1) then
		perform public.accessi_persone_varchi_ricostruisci();
	end if;
end;
$$;
