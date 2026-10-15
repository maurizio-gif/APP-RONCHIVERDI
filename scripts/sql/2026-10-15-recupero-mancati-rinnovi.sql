-- Recupero dei mancati rinnovi core: a 31 giorni dalla scadenza, chi non ha
-- rinnovato diventa un lead per il settore New.
--
-- Perché a 31 giorni (decisione del 15 ottobre 2026, sui dati 2021-2025 degli
-- abbonamenti core annuali): il 67-70% rinnova entro 30 giorni — è il mese del
-- team Rinnovi Core — e chi supera i 30 giorni torna da solo soprattutto
-- subito dopo, poi sempre meno. Fra chi non ha rinnovato a 30 giorni, i soci da
-- 5 anni o più tornano nel 54% dei casi (20% già fra il 31° e il 90° giorno),
-- quelli al primo anno nel 23%. Aspettare due mesi vorrebbe dire perdere la
-- finestra migliore.
--
-- Chi entra:
--   - l'ultimo abbonamento core della persona, di almeno 3 mesi (mensili e
--     giornalieri esclusi: si rinnovano di mese in mese, un mese saltato non è
--     un abbandono), scaduto nel periodo indicato;
--   - nessun abbonamento core successivo, o che parta a ridosso della
--     scadenza (anche un rinnovo anticipato conta come rinnovo);
--   - non per un motivo che il recupero non può cambiare: trasferimento di
--     lavoro, di studio, di casa, e le rate insolute;
--   - mai una persona deceduta. Il motivo spesso non è nel campo «motivo» ma
--     scritto nelle note («[motivo originale: DECEDUTO]», «MOTIVI PERSONALI |
--     DECEDUTO»): si cerca anche nel testo di motivo, note e appunti. Al primo
--     lancio erano due su 57, e richiamarli sarebbe stato gravissimo;
--   - non escluso dai report in Rinnovi Core;
--   - con un'email o un cellulare: un lead da richiamare senza un recapito non
--     serve a nessuno;
--   - senza una trattativa già aperta (una persona ne ha al più una).
--
-- Cosa nasce: una trattativa libera ('nuovo', nessun assegnatario: la prende
-- chi è disponibile), canale 'recupero-rinnovo', richiesta 'mancato_rinnovo',
-- e nella nota tutto quello che serve prima di chiamare — l'abbonamento
-- scaduto, da quanti anni era socio, il motivo e le note scritte in Rinnovi
-- Core. recupero_abbonamento_id la lega all'abbonamento scaduto (una sola
-- trattativa di recupero per abbonamento: rilanciarla non crea doppioni);
-- recupero_anni dice da quanti anni era socio, ed è la priorità.
--
-- Se poi la persona ricompra, la trattativa si chiude da sola come vinta
-- (chiudi_trattativa_da_abbonamento): è così che si misura il recupero.
--
-- La chiama ogni giorno /api/cron/recupero-rinnovi (vercel.json) sugli ultimi
-- giorni arrivati a 31; la prima volta è stata lanciata a mano sulle scadenze
-- dal 15 agosto al 14 settembre 2026.

alter table public.opportunita
	add column if not exists recupero_abbonamento_id uuid references public.abbonamenti(id) on delete set null;
alter table public.opportunita
	add column if not exists recupero_anni integer;

create unique index if not exists opportunita_recupero_abbonamento_key
	on public.opportunita (recupero_abbonamento_id) where recupero_abbonamento_id is not null;

comment on column public.opportunita.recupero_abbonamento_id is
	'Trattativa di recupero di un mancato rinnovo: l''abbonamento core scaduto e non rinnovato da cui nasce. Vedi scripts/sql/2026-10-15-recupero-mancati-rinnovi.sql.';
comment on column public.opportunita.recupero_anni is
	'Trattativa di recupero: da quanti anni era socio core (abbonamenti annuali, compreso quello scaduto). È la priorità.';

-- Il secondo attributo del lead (vedi 2026-10-15-trattativa-richiesta.sql):
-- un mancato rinnovo da recuperare.
alter table public.opportunita drop constraint if exists opportunita_richiesta_check;
alter table public.opportunita
	add constraint opportunita_richiesta_check
	check (richiesta is null or richiesta in ('tour', 'richiamami', 'in_sede', 'telefonata', 'email', 'messaggio', 'mancato_rinnovo'));

-- «12 settembre 2026», come lo direbbe una persona: to_char userebbe i mesi
-- in inglese.
create or replace function public.data_italiana(p_giorno date)
returns text
language sql
immutable
as $$
	select extract(day from p_giorno)::int || ' ' ||
		(array['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'])[extract(month from p_giorno)::int]
		|| ' ' || extract(year from p_giorno)::int;
$$;

create or replace function public.crea_trattative_recupero(p_dal date, p_al date)
returns table (opportunita_id uuid, persona_id uuid, abbonamento text, data_fine date, anni integer)
language plpgsql
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
	r record;
	v_id uuid;
	v_nota text;
	v_anni_testo text;
	v_note_gestione text;
begin
	for r in
		with core as (select id from abbonamenti_gruppi where nome = 'CORE'),
		abb as (
			select a.id, a.persona_id, a.abbonamento, a.data_inizio, a.data_fine, a.periodo, a.durata, a.totale
			from abbonamenti a
			join abbonamenti_mappatura m on m.prodotto = a.abbonamento
			where m.gruppo_id = (select id from core)
				and a.cancellato_il is null
				and coalesce(m.no_abbonamento, false) = false
				and a.persona_id is not null
		)
		select
			x.*,
			l.motivo_non_rinnovo, l.note_non_rinnovo, l.nota, l.stato_manuale,
			(select count(*) from abb p where p.persona_id = x.persona_id and p.periodo = 'M' and p.durata = 12 and p.data_fine <= x.data_fine)::int as anni,
			(select min(p.data_inizio) from abb p where p.persona_id = x.persona_id) as primo_inizio
		from abb x
		left join abbonamenti_scadenze_lavorazione l on l.abbonamento_id = x.id
		where x.periodo = 'M' and x.durata >= 3
			and x.data_fine between p_dal and p_al
			and not exists (
				select 1 from abb n
				where n.persona_id = x.persona_id and n.id <> x.id
					and (n.data_fine > x.data_fine or n.data_inizio >= x.data_fine - 60)
			)
			and upper(coalesce(l.motivo_non_rinnovo, '')) not in
				('TRASFERIMENTO LAVORO', 'TRASFERIMENTO STUDIO', 'TRASFERIMENTO ABITAZIONE', 'RATE INSOLUTE')
			and not coalesce(l.escluso_da_report, false)
			and concat_ws(' ', l.motivo_non_rinnovo, l.note_non_rinnovo, l.nota,
				(select string_agg(n.testo, ' ') from abbonamenti_scadenze_note n where n.abbonamento_id = x.id))
				!~* '(decedut|decess|\mmort[oa]\M|\mlutto\M)'
			and exists (select 1 from persone p where p.id = x.persona_id and (p.email is not null or p.cellulare is not null))
			and not exists (select 1 from opportunita o where o.persona_id = x.persona_id and o.stato in ('nuovo', 'in_gestione'))
			and not exists (select 1 from opportunita o where o.recupero_abbonamento_id = x.id)
		order by x.data_fine
	loop
		-- Una persona con due abbonamenti scaduti nello stesso periodo ne ha
		-- uno solo che conta: dopo il primo ha già una trattativa aperta.
		if exists (select 1 from opportunita o where o.persona_id = r.persona_id and o.stato in ('nuovo', 'in_gestione')) then
			continue;
		end if;

		v_anni_testo := case
			when r.anni <= 0 then 'al primo abbonamento core'
			when r.anni = 1 then 'socio core da 1 anno'
			else 'socio core da ' || r.anni || ' anni'
		end || case when r.primo_inizio is not null then ' (primo abbonamento core: ' || data_italiana(r.primo_inizio) || ')' else '' end;

		select string_agg(left(n.testo, 300), ' / ' order by n.creato_il desc)
		into v_note_gestione
		from (
			select n.testo, n.creato_il from abbonamenti_scadenze_note n
			where n.abbonamento_id = r.id order by n.creato_il desc limit 3
		) n;

		v_nota := concat_ws(E'\n',
			'Mancato rinnovo: l''abbonamento core «' || r.abbonamento || '» (' || r.durata || ' mesi'
				|| case when r.totale is not null then ', ' || replace(to_char(r.totale, 'FM999990.00'), '.', ',') || ' €' else '' end
				|| ') è scaduto il ' || data_italiana(r.data_fine)
				|| ' e non è stato rinnovato nei 30 giorni seguiti dal team Rinnovi Core.',
			initcap(left(v_anni_testo, 1)) || substr(v_anni_testo, 2) || '.',
			case when coalesce(r.motivo_non_rinnovo, '') <> '' or coalesce(r.note_non_rinnovo, '') <> '' or coalesce(r.nota, '') <> ''
				then 'In Rinnovi Core: '
					|| concat_ws(' · ',
						case when coalesce(r.motivo_non_rinnovo, '') <> '' then 'motivo «' || r.motivo_non_rinnovo || '»' end,
						case when coalesce(r.note_non_rinnovo, '') <> '' then 'nota «' || left(r.note_non_rinnovo, 300) || '»' end,
						case when coalesce(r.nota, '') <> '' then 'appunto «' || left(r.nota, 300) || '»' end)
					|| '.'
				else 'In Rinnovi Core non è stato registrato un motivo.'
			end,
			case when v_note_gestione is not null then 'Ultime note di gestione: ' || v_note_gestione || '.' end,
			'Passato al settore New il ' || data_italiana((now() at time zone 'Europe/Rome')::date)
				|| ': richiamare per capire perché non ha rinnovato e se, e a che condizioni, tornerebbe.'
		);

		insert into opportunita (persona_id, stato, stato_da, stato_il, origine, richiesta, note, recupero_abbonamento_id, recupero_anni)
		values (r.persona_id, 'nuovo', 'recupero-rinnovi', now(), 'recupero-rinnovo', 'mancato_rinnovo', v_nota, r.id, greatest(r.anni, 0))
		returning id into v_id;

		insert into audit_log (email, azione, entita, entita_id, dettagli)
		values ('recupero-rinnovi', 'trattativa_recupero_creata', 'opportunita', v_id::text,
			jsonb_build_object('abbonamento', r.abbonamento, 'data_fine', r.data_fine, 'anni', r.anni, 'motivo', r.motivo_non_rinnovo));

		opportunita_id := v_id;
		persona_id := r.persona_id;
		abbonamento := r.abbonamento;
		data_fine := r.data_fine;
		anni := greatest(r.anni, 0);
		return next;
	end loop;
end;
$$;

revoke all on function public.crea_trattative_recupero(date, date) from public, anon, authenticated;
grant execute on function public.crea_trattative_recupero(date, date) to service_role;

-- Il ritorno spontaneo degli anni passati, per misurare il recupero (Core
-- Manager): fra chi non aveva rinnovato a 30 giorni un abbonamento core
-- annuale scaduto fra il 2021 e un anno fa, quanti sono tornati entro 90
-- giorni dalla scadenza, per anni di anzianità. Il recupero funziona se le
-- trattative di recupero rientrano più di così.
create or replace function public.ritorno_spontaneo_mancati_rinnovi()
returns table (fascia text, non_rinnovati bigint, tornati_entro_90 bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
	with core as (select id from abbonamenti_gruppi where nome = 'CORE'),
	abb as (
		select a.persona_id, a.data_inizio, a.data_fine, (a.periodo = 'M' and a.durata = 12) as annuale
		from abbonamenti a
		join abbonamenti_mappatura m on m.prodotto = a.abbonamento
		where m.gruppo_id = (select id from core) and a.cancellato_il is null
			and coalesce(m.no_abbonamento, false) = false and a.persona_id is not null
	),
	w as (
		select *,
			lead(data_inizio) over (partition by persona_id order by data_inizio, data_fine) as prossimo,
			count(*) filter (where annuale) over (partition by persona_id order by data_inizio, data_fine
				rows between unbounded preceding and current row) as anni
		from abb
	),
	x as (
		select anni, prossimo - data_fine as giorni from w
		where annuale and data_fine between date '2021-01-01' and current_date - 365
	)
	select
		case when anni <= 1 then '1° anno' when anni = 2 then '2° anno' when anni <= 4 then '3-4 anni' else '5+ anni' end,
		count(*),
		count(*) filter (where giorni between 31 and 90)
	from x
	where giorni is null or giorni > 30
	group by 1
	order by 1;
$$;

revoke all on function public.ritorno_spontaneo_mancati_rinnovi() from public, anon, authenticated;
grant execute on function public.ritorno_spontaneo_mancati_rinnovi() to service_role;

-- ─────────────────────────────────────────────────────── ogni mattina

-- 04:50 UTC (le 5:50 o le 6:50 a Roma): dopo la sync notturna di Info4U, dopo
-- la chiusura delle trattative inattive (03:00 UTC) e dopo i lead dei mensili
-- (04:40 UTC), prima che apra la segreteria. Guarda le scadenze arrivate a 31
-- giorni con una settimana di margine (dal 37° al 31° giorno): se un giorno il
-- job salta, il giorno dopo recupera — e un abbonamento non genera mai due
-- lead (indice unico su recupero_abbonamento_id).
select cron.unschedule(jobid) from cron.job where jobname = 'crea-trattative-recupero';
select cron.schedule(
	'crea-trattative-recupero',
	'50 4 * * *',
	$$select public.crea_trattative_recupero(
		(now() at time zone 'Europe/Rome')::date - 37,
		(now() at time zone 'Europe/Rome')::date - 31
	)$$
);
