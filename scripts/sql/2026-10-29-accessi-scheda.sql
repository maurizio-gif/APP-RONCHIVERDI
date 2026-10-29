-- Gli accessi al club nella scheda contatto: ultimi 5 ingressi, giorni di
-- presenza negli ultimi 30 giorni / 3 / 6 / 12 mesi e confronto con la
-- mediana dei soci.
--
-- `accessi` ha una riga per ogni passaggio da un varco (tornello, tripode,
-- porta palestra...): una visita ne produce molte, e 3,4 milioni di righe
-- non si contano a ogni apertura di scheda (19 secondi per 12 mesi). Qui si
-- tiene un riepilogo «una riga per socio e giorno», aggiornato da un trigger
-- a ogni insert dalla sync, e una cache giornaliera delle mediane.
--
-- Conta come ingresso un passaggio con esito 3 (abbonamento), 100 (gold
-- card) o 25 (apertura forzata). Gli altri esiti sono uscite (1) o ingressi
-- negati (negativi): non sono visite. Il giorno è quello di Roma.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi (si può
-- rieseguire senza danni).

create table if not exists public.accessi_giorni (
	source_utente_id integer not null,
	giorno date not null,
	primo_ingresso timestamptz not null,
	primary key (source_utente_id, giorno)
);
create index if not exists accessi_giorni_giorno_idx on public.accessi_giorni (giorno);
alter table public.accessi_giorni enable row level security;

create or replace function public.accessi_giorni_aggiorna()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into public.accessi_giorni (source_utente_id, giorno, primo_ingresso)
	select n.source_utente_id, (n.data_accesso at time zone 'Europe/Rome')::date, min(n.data_accesso)
	from new_rows n
	where n.tipo_accesso in (3, 100, 25) and n.source_utente_id is not null
	group by 1, 2
	on conflict (source_utente_id, giorno)
	do update set primo_ingresso = least(accessi_giorni.primo_ingresso, excluded.primo_ingresso);
	return null;
end;
$$;

drop trigger if exists accessi_giorni_dopo_insert on public.accessi;
create trigger accessi_giorni_dopo_insert
	after insert on public.accessi
	referencing new table as new_rows
	for each statement execute function public.accessi_giorni_aggiorna();

-- Riempimento iniziale con gli accessi già presenti.
insert into public.accessi_giorni (source_utente_id, giorno, primo_ingresso)
select source_utente_id, (data_accesso at time zone 'Europe/Rome')::date, min(data_accesso)
from public.accessi
where tipo_accesso in (3, 100, 25) and source_utente_id is not null
group by 1, 2
on conflict (source_utente_id, giorno) do nothing;

-- Mediana dei giorni di presenza per finestra, fra i soci che sono venuti
-- almeno una volta nella finestra. Ricalcolata al massimo ogni 12 ore.
create table if not exists public.accessi_mediane (
	finestra text primary key,
	mediana numeric not null,
	soci integer not null,
	calcolata_il timestamptz not null default now()
);
alter table public.accessi_mediane enable row level security;

create or replace function public.accessi_ricalcola_mediane()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	f record;
	oggi date := (now() at time zone 'Europe/Rome')::date;
begin
	for f in
		select * from (values ('30g', oggi - 30), ('3m', oggi - 92), ('6m', oggi - 183), ('12m', oggi - 365)) v(chiave, dal)
	loop
		insert into public.accessi_mediane (finestra, mediana, soci, calcolata_il)
		select f.chiave, coalesce(percentile_cont(0.5) within group (order by g), 0), count(*), now()
		from (
			select count(*) g from public.accessi_giorni where giorno > f.dal group by source_utente_id
		) t
		on conflict (finestra)
		do update set mediana = excluded.mediana, soci = excluded.soci, calcolata_il = excluded.calcolata_il;
	end loop;
end;
$$;

-- Tutto quello che serve alla card «Frequenza» in una chiamata.
create or replace function public.scheda_accessi(p_persona_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	utente integer;
	oggi date := (now() at time zone 'Europe/Rome')::date;
begin
	select source_utente_id into utente from public.persone where id = p_persona_id;
	if utente is null then
		return jsonb_build_object('ultimi', '[]'::jsonb, 'finestre', '[]'::jsonb);
	end if;

	if not exists (select 1 from public.accessi_mediane where calcolata_il > now() - interval '12 hours')
		or (select count(*) from public.accessi_mediane) < 4 then
		perform public.accessi_ricalcola_mediane();
	end if;

	return jsonb_build_object(
		'ultimi', coalesce((
			select jsonb_agg(jsonb_build_object('giorno', giorno, 'ingresso', primo_ingresso) order by giorno desc)
			from (select giorno, primo_ingresso from public.accessi_giorni
				where source_utente_id = utente order by giorno desc limit 5) u
		), '[]'::jsonb),
		'finestre', (
			select jsonb_agg(jsonb_build_object(
				'chiave', m.finestra,
				'giorni', (select count(*) from public.accessi_giorni
					where source_utente_id = utente
					and giorno > oggi - (case m.finestra when '30g' then 30 when '3m' then 92 when '6m' then 183 else 365 end)),
				'mediana', m.mediana,
				'soci', m.soci
			) order by case m.finestra when '30g' then 1 when '3m' then 2 when '6m' then 3 else 4 end)
			from public.accessi_mediane m
		)
	);
end;
$$;

revoke all on function public.scheda_accessi(uuid), public.accessi_ricalcola_mediane(), public.accessi_giorni_aggiorna() from public, anon, authenticated;
grant execute on function public.scheda_accessi(uuid) to service_role;
