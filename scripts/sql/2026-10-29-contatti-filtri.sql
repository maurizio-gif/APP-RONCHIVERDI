-- Filtri sui contatti: liste personalizzate sull'intera anagrafica.
--
-- La pagina /dashboard/persone/filtri combina condizioni (abbonamento
-- attivo, scaduto da poco, mai venuto da N giorni, lead non contattati...) e
-- mostra chi le soddisfa tutte. Il lavoro sta in una funzione sola,
-- `contatti_filtrati`, che prende i filtri come jsonb: ogni chiave è una
-- condizione e una chiave assente non filtra. Una funzione e non un filtro
-- PostgREST composto dal browser, per lo stesso motivo di cerca_persone: i
-- valori arrivano da un modulo, e qui sono parametri tipizzati, mai pezzi di
-- una query.
--
-- Definizioni, uguali a quelle già usate nel CRM:
--   abbonamento attivo   data_inizio <= oggi e (data_fine nulla o >= oggi), non
--                        cancellato. La disdetta non lo esclude: fino alla
--                        scadenza il socio è abbonato (come «Soci attivi» in
--                        Dashboard direzionale).
--   ultimo accesso       l'ultimo giorno di presenza in accessi_giorni (vedi
--                        2026-10-29-accessi-scheda.sql).
--   lead                 una riga di `opportunita`; «aperto» = nuovo o in
--                        gestione. «Non contattato» = trattativa ancora «nuovo»
--                        (nessuno l'ha presa in carico) oppure una richiesta dal
--                        sito non ancora lavorata (form_contatti.gestito falso).
--   certificato valido   scadenza >= oggi e non «provvisorio» (una visita
--                        prenotata non è un certificato).
--
-- Le chiavi del jsonb sono elencate in testa alla funzione. Il giorno è
-- quello di Roma. Da eseguire nel SQL Editor del progetto Supabase
-- Ronchiverdi; si può rieseguire senza danni.

-- ────────────────────────────────────────────────────────── piccoli aiuti
-- Funzioni SQL semplici: il planner le inlinea nella query principale.

-- Il prodotto sta nel gruppo scelto (o nessun gruppo scelto).
create or replace function public.contatti_gruppo_ok(p_prodotto text, p_gruppo uuid)
returns boolean language sql stable set search_path = public as $$
	select p_gruppo is null
		or exists (select 1 from public.abbonamenti_mappatura m where m.prodotto = p_prodotto and m.gruppo_id = p_gruppo);
$$;

-- Ha almeno un abbonamento (non cancellato) nel gruppo.
create or replace function public.contatti_ha_abbonamenti(p_persona uuid, p_gruppo uuid)
returns boolean language sql stable set search_path = public as $$
	select exists (
		select 1 from public.abbonamenti a
		where a.persona_id = p_persona and a.cancellato_il is null and public.contatti_gruppo_ok(a.abbonamento, p_gruppo)
	);
$$;

create or replace function public.contatti_ab_attivo(p_persona uuid, p_oggi date, p_gruppo uuid)
returns boolean language sql stable set search_path = public as $$
	select exists (
		select 1 from public.abbonamenti a
		where a.persona_id = p_persona and a.cancellato_il is null
			and a.data_inizio is not null and a.data_inizio <= p_oggi
			and (a.data_fine is null or a.data_fine >= p_oggi)
			and public.contatti_gruppo_ok(a.abbonamento, p_gruppo)
	);
$$;

-- Quando finisce l'ultimo degli abbonamenti attivi; nulla se uno è senza
-- scadenza (non scade mai) o se non ce n'è nessuno attivo.
create or replace function public.contatti_fine_attiva(p_persona uuid, p_oggi date, p_gruppo uuid)
returns date language sql stable set search_path = public as $$
	select case when bool_or(a.data_fine is null) then null else max(a.data_fine) end
	from public.abbonamenti a
	where a.persona_id = p_persona and a.cancellato_il is null
		and a.data_inizio is not null and a.data_inizio <= p_oggi
		and (a.data_fine is null or a.data_fine >= p_oggi)
		and public.contatti_gruppo_ok(a.abbonamento, p_gruppo);
$$;

-- L'ultima scadenza fra tutti gli abbonamenti (attivi o no).
create or replace function public.contatti_ultima_fine(p_persona uuid, p_gruppo uuid)
returns date language sql stable set search_path = public as $$
	select max(a.data_fine)
	from public.abbonamenti a
	where a.persona_id = p_persona and a.cancellato_il is null and public.contatti_gruppo_ok(a.abbonamento, p_gruppo);
$$;

create or replace function public.contatti_ultimo_accesso(p_utente integer)
returns date language sql stable set search_path = public as $$
	select max(g.giorno) from public.accessi_giorni g where g.source_utente_id = p_utente;
$$;

-- 'valido', 'scaduto' (ha certificati ma nessuno valido) o 'assente'.
create or replace function public.contatti_certificato(p_utente integer, p_oggi date)
returns text language sql stable set search_path = public as $$
	select case
		when exists (
			select 1 from public.certificati c
			where c.source_utente_id = p_utente and c.data_scadenza >= p_oggi and coalesce(c.descrizione, '') !~* 'provvisorio'
		) then 'valido'
		when exists (
			select 1 from public.certificati c
			where c.source_utente_id = p_utente and c.data_scadenza is not null and coalesce(c.descrizione, '') !~* 'provvisorio'
		) then 'scaduto'
		else 'assente'
	end;
$$;

-- Il prossimo compleanno a partire da oggi (±1 giorno negli anni bisestili).
create or replace function public.contatti_prossimo_compleanno(p_nascita date, p_oggi date)
returns date language sql immutable as $$
	select case
		when (date_trunc('year', p_oggi)::date + (extract(doy from p_nascita)::int - 1)) >= p_oggi
			then (date_trunc('year', p_oggi)::date + (extract(doy from p_nascita)::int - 1))
		else (date_trunc('year', p_oggi + interval '1 year')::date + (extract(doy from p_nascita)::int - 1))
	end;
$$;

-- I caratteri che ilike legge come jolly, da scrivere come lettere.
create or replace function public.contatti_come_testo(p_testo text)
returns text language sql immutable as $$
	select replace(replace(replace(p_testo, '\', '\\'), '%', '\%'), '_', '\_');
$$;

-- ───────────────────────────────────────────────────────────── la funzione
-- Chiavi di p_f (tutte facoltative):
--   q            testo: ogni parola in nome, cognome, email, cellulare o n. utente
--   ab           'attivo' | 'scade' | 'scaduto' | 'ex' | 'mai'
--                  scade:   abbonamento attivo che finisce entro ab_giorni
--                  scaduto: nessun abbonamento attivo, scaduto da meno di ab_giorni
--                  ex:      nessun abbonamento attivo, scaduto da più di ab_giorni
--                  mai:     nessun abbonamento
--   ab_giorni    giorni per scade / scaduto / ex (30)
--   gruppo       uuid di un gruppo prodotti: gli abbonamenti si guardano solo lì
--   ac           'inattivo' (non entra da ac_giorni) | 'recente' | 'mai'
--   ac_giorni    giorni per inattivo / recente (30)
--   ld           'qualsiasi' | 'nessuno' | 'non_contattato' | 'aperto' |
--                'da_prendere' | 'in_gestione' | 'ferma' | 'vinto' | 'perso'
--                  ferma: in gestione e senza novità da ld_giorni
--   ld_giorni    giorni per ferma (14)
--   lead_da      solo lead nati negli ultimi lead_da giorni
--   ass          email di chi segue una trattativa aperta, o '__nessuno__'
--   cm           'valido' | 'scaduto' | 'assente' | 'non_valido' (scaduto o assente)
--   rs           true: ha rate scadute non pagate
--   em, ce       true: ha un'email / un cellulare
--   eta_da, eta_a, sesso ('M' | 'F'), compleanno (entro N giorni)
--   ids          elenco di uuid: solo queste persone
-- p_ordine: cognome | accesso_recente | accesso_vecchio | scadenza_vicina |
--           scadenza_recente | lead_recente
create or replace function public.contatti_filtrati(
	p_f jsonb, p_ordine text default 'cognome', p_limite integer default 50, p_offset integer default 0
)
returns table (
	id uuid, nome text, cognome text, email text, cellulare text, data_nascita date,
	abbonamento text, fine_abbonamento date, ultima_scadenza date, ultimo_accesso date,
	lead_stato text, lead_assegnato text, lead_creato timestamptz, richieste_da_lavorare bigint,
	totale bigint
)
language sql
stable
security definer
set search_path = public
as $$
	with oggi as (select (now() at time zone 'Europe/Rome')::date d),
	f as (
		select
			nullif(btrim(coalesce(p_f->>'q', '')), '') q,
			p_f->>'ab' ab, coalesce((p_f->>'ab_giorni')::int, 30) ab_giorni, nullif(p_f->>'gruppo', '')::uuid gruppo,
			p_f->>'ac' ac, coalesce((p_f->>'ac_giorni')::int, 30) ac_giorni,
			p_f->>'ld' ld, coalesce((p_f->>'ld_giorni')::int, 14) ld_giorni, (p_f->>'lead_da')::int lead_da, nullif(p_f->>'ass', '') ass,
			p_f->>'cm' cm, coalesce((p_f->>'rs')::boolean, false) rs,
			coalesce((p_f->>'em')::boolean, false) em, coalesce((p_f->>'ce')::boolean, false) ce,
			(p_f->>'eta_da')::int eta_da, (p_f->>'eta_a')::int eta_a, nullif(p_f->>'sesso', '') sesso,
			(p_f->>'compleanno')::int compleanno,
			case when jsonb_typeof(p_f->'ids') = 'array'
				then (select array_agg(x::uuid) from jsonb_array_elements_text(p_f->'ids') x) end ids
	),
	m as (
		select p.id, p.nome, p.cognome, p.email, p.cellulare, p.data_nascita, p.source_utente_id,
			count(*) over () as totale, oggi.d, f.gruppo
		from public.persone p
		cross join oggi
		cross join f
		where
			(f.ids is null or p.id = any (f.ids))
			and (f.q is null or not exists (
				select 1 from unnest(regexp_split_to_array(f.q, '\s+')) t(termine)
				where termine <> '' and not (
					coalesce(p.nome, '') ilike '%' || public.contatti_come_testo(termine) || '%'
					or coalesce(p.cognome, '') ilike '%' || public.contatti_come_testo(termine) || '%'
					or coalesce(p.nome, '') || ' ' || coalesce(p.cognome, '') ilike '%' || public.contatti_come_testo(termine) || '%'
					or coalesce(p.cognome, '') || ' ' || coalesce(p.nome, '') ilike '%' || public.contatti_come_testo(termine) || '%'
					or coalesce(p.email, '') ilike '%' || public.contatti_come_testo(termine) || '%'
					or coalesce(p.cellulare, '') ilike '%' || public.contatti_come_testo(termine) || '%'
					or p.source_utente_id::text = termine
				)))
			-- abbonamento
			and (f.ab is null or case f.ab
				when 'attivo' then public.contatti_ab_attivo(p.id, oggi.d, f.gruppo)
				when 'scade' then public.contatti_ab_attivo(p.id, oggi.d, f.gruppo)
					and public.contatti_fine_attiva(p.id, oggi.d, f.gruppo) between oggi.d and oggi.d + f.ab_giorni
				when 'scaduto' then not public.contatti_ab_attivo(p.id, oggi.d, f.gruppo)
					and public.contatti_ultima_fine(p.id, f.gruppo) between oggi.d - f.ab_giorni and oggi.d - 1
				when 'ex' then not public.contatti_ab_attivo(p.id, oggi.d, f.gruppo)
					and public.contatti_ultima_fine(p.id, f.gruppo) < oggi.d - f.ab_giorni
				when 'mai' then not public.contatti_ha_abbonamenti(p.id, f.gruppo)
				else true end)
			-- accessi
			and (f.ac is null or case f.ac
				when 'inattivo' then public.contatti_ultimo_accesso(p.source_utente_id) < oggi.d - f.ac_giorni
				when 'recente' then public.contatti_ultimo_accesso(p.source_utente_id) >= oggi.d - f.ac_giorni
				when 'mai' then public.contatti_ultimo_accesso(p.source_utente_id) is null
				else true end)
			-- lead
			and (f.ld is null and f.lead_da is null or case coalesce(f.ld, 'qualsiasi')
				when 'nessuno' then not exists (select 1 from public.opportunita o where o.persona_id = p.id)
				when 'non_contattato' then
					exists (select 1 from public.opportunita o where o.persona_id = p.id and o.stato = 'nuovo'
						and (f.lead_da is null or o.creato_il >= now() - make_interval(days => f.lead_da)))
					or exists (select 1 from public.form_contatti c where c.persona_id = p.id and not c.gestito
						and (f.lead_da is null or c.created_at >= now() - make_interval(days => f.lead_da)))
				else exists (
					select 1 from public.opportunita o
					where o.persona_id = p.id
						and (f.lead_da is null or o.creato_il >= now() - make_interval(days => f.lead_da))
						and case coalesce(f.ld, 'qualsiasi')
							when 'aperto' then o.stato in ('nuovo', 'in_gestione')
							when 'da_prendere' then o.stato = 'nuovo'
							when 'in_gestione' then o.stato = 'in_gestione'
							when 'ferma' then o.stato = 'in_gestione'
								and coalesce(o.stato_il, o.creato_il) < now() - make_interval(days => f.ld_giorni)
							when 'vinto' then o.stato = 'vinto'
							when 'perso' then o.stato = 'perso'
							else true end)
				end)
			and (f.ass is null or exists (
				select 1 from public.opportunita o
				where o.persona_id = p.id and o.stato in ('nuovo', 'in_gestione')
					and case when f.ass = '__nessuno__' then o.assegnato_a is null else o.assegnato_a = f.ass end))
			-- certificato medico
			and (f.cm is null or case f.cm
				when 'valido' then public.contatti_certificato(p.source_utente_id, oggi.d) = 'valido'
				when 'scaduto' then public.contatti_certificato(p.source_utente_id, oggi.d) = 'scaduto'
				when 'assente' then public.contatti_certificato(p.source_utente_id, oggi.d) = 'assente'
				when 'non_valido' then public.contatti_certificato(p.source_utente_id, oggi.d) <> 'valido'
				else true end)
			-- rate scadute non pagate
			and (not f.rs or exists (
				select 1 from public.abbonamenti a
				join public.abbonamenti_rate r on r.source_iscrizione_id = a.source_iscrizione_id
				where a.persona_id = p.id and a.cancellato_il is null
					and r.cancellato_il is null and r.data_pagato is null and r.data_rata < oggi.d))
			-- recapiti e anagrafica
			and (not f.em or coalesce(p.email, '') <> '')
			and (not f.ce or coalesce(p.cellulare, '') <> '')
			and (f.eta_da is null or date_part('year', age(oggi.d, p.data_nascita)) >= f.eta_da)
			and (f.eta_a is null or date_part('year', age(oggi.d, p.data_nascita)) <= f.eta_a)
			and (f.sesso is null or p.sesso = f.sesso)
			and (f.compleanno is null or (
				p.data_nascita is not null
				and public.contatti_prossimo_compleanno(p.data_nascita, oggi.d) <= oggi.d + f.compleanno))
		order by
			case when p_ordine = 'accesso_recente' then public.contatti_ultimo_accesso(p.source_utente_id) end desc nulls last,
			case when p_ordine = 'accesso_vecchio' then public.contatti_ultimo_accesso(p.source_utente_id) end asc nulls last,
			case when p_ordine = 'scadenza_vicina' then public.contatti_fine_attiva(p.id, oggi.d, f.gruppo) end asc nulls last,
			case when p_ordine = 'scadenza_recente' then public.contatti_ultima_fine(p.id, f.gruppo) end desc nulls last,
			case when p_ordine = 'lead_recente' then (select max(o.creato_il) from public.opportunita o where o.persona_id = p.id) end desc nulls last,
			lower(coalesce(p.cognome, '')), lower(coalesce(p.nome, '')), p.id
		limit greatest(p_limite, 0) offset greatest(p_offset, 0)
	)
	select
		m.id, m.nome, m.cognome, m.email, m.cellulare, m.data_nascita,
		ab.abbonamento,
		public.contatti_fine_attiva(m.id, m.d, m.gruppo),
		public.contatti_ultima_fine(m.id, m.gruppo),
		public.contatti_ultimo_accesso(m.source_utente_id),
		l.stato, l.assegnato_a, l.creato_il,
		(select count(*) from public.form_contatti c where c.persona_id = m.id and not c.gestito),
		m.totale
	from m
	left join lateral (
		select a.abbonamento from public.abbonamenti a
		where a.persona_id = m.id and a.cancellato_il is null
			and a.data_inizio is not null and a.data_inizio <= m.d and (a.data_fine is null or a.data_fine >= m.d)
			and public.contatti_gruppo_ok(a.abbonamento, m.gruppo)
		order by a.data_fine desc nulls first limit 1
	) ab on true
	left join lateral (
		-- Il lead da mostrare: uno aperto se c'è, altrimenti il più recente.
		select o.stato, o.assegnato_a, o.creato_il from public.opportunita o
		where o.persona_id = m.id
		order by (o.stato in ('nuovo', 'in_gestione')) desc, o.creato_il desc limit 1
	) l on true
	order by
		case when p_ordine = 'accesso_recente' then public.contatti_ultimo_accesso(m.source_utente_id) end desc nulls last,
		case when p_ordine = 'accesso_vecchio' then public.contatti_ultimo_accesso(m.source_utente_id) end asc nulls last,
		case when p_ordine = 'scadenza_vicina' then public.contatti_fine_attiva(m.id, m.d, m.gruppo) end asc nulls last,
		case when p_ordine = 'scadenza_recente' then public.contatti_ultima_fine(m.id, m.gruppo) end desc nulls last,
		case when p_ordine = 'lead_recente' then l.creato_il end desc nulls last,
		lower(coalesce(m.cognome, '')), lower(coalesce(m.nome, '')), m.id;
$$;

-- Lo stesso, come un unico jsonb: per l'esportazione e per copiare email e
-- cellulari, dove le 1000 righe che PostgREST dà per richiesta sono poche.
create or replace function public.contatti_filtrati_json(p_f jsonb, p_ordine text default 'cognome', p_limite integer default 5000)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
	select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.contatti_filtrati(p_f, p_ordine, p_limite, 0) r;
$$;

-- Solo la service role (il server del CRM) le può chiamare.
revoke all on function
	public.contatti_filtrati(jsonb, text, integer, integer), public.contatti_filtrati_json(jsonb, text, integer)
	from public, anon, authenticated;
grant execute on function
	public.contatti_filtrati(jsonb, text, integer, integer), public.contatti_filtrati_json(jsonb, text, integer)
	to service_role;
