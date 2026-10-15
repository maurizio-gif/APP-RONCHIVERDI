-- I mensili non Flex diventano lead della Dashboard New.
--
-- Un abbonamento Core mensile che non è un Flex («1.5-WELCOME UNDER 35»,
-- «PROMOZIONI», «OVER 18»… con durata 1 mese in Info4U) ha una scadenza vera:
-- non si rinnova da solo, e chi l'ha preso va richiamato per fargli un
-- abbonamento. Non è un rinnovo da segreteria, è una vendita: tocca ai
-- commerciali, dalla Dashboard New.
--
-- Quindi:
--
--  1. 15 giorni prima della scadenza nasce una trattativa «da prendere in
--     carico» (stato nuovo, nessun assegnatario, origine 'scadenza-mensile'),
--     agganciata all'abbonamento con opportunita.abbonamento_id. La crea
--     crea_lead_scadenze_mensili, ogni mattina (pg_cron, in fondo). Niente
--     lead se la persona ha già comprato un altro abbonamento Core dopo il
--     mensile; se ha già una trattativa aperta non se ne apre una seconda (al
--     massimo una aperta per persona, vedi trova_o_crea_opportunita): si
--     aggancia l'abbonamento a quella, che resta di chi la segue.
--
--  2. In Rinnovi Core il mensile resta, e conta nelle statistiche come ogni
--     altra scadenza, ma è «di competenza New»: l'assegnatario è quello della
--     trattativa (il commerciale che l'ha presa in New), e dalla tabella non
--     si cambia. Prima che nasca la trattativa vale l'assegnatario scritto a
--     mano, se c'era: i mesi passati non si riscrivono.
--
--  3. Quando il cliente compra, chiudi_trattativa_da_abbonamento chiude la
--     trattativa come vinta, come per qualunque altro lead.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-10-15-flex-rinnovo-automatico-escluso.sql.

-- ───────────────────────────────────────────── il legame lead ↔ abbonamento

alter table public.opportunita
	add column if not exists abbonamento_id uuid references public.abbonamenti (id) on delete set null;

comment on column public.opportunita.abbonamento_id is
	'L''abbonamento mensile in scadenza da cui è nata (o a cui è stata agganciata) la trattativa: vedi crea_lead_scadenze_mensili. Null per tutte le altre.';

-- Un lead per mensile, non uno al giorno.
create unique index if not exists opportunita_abbonamento_id_key
	on public.opportunita (abbonamento_id) where abbonamento_id is not null;

-- ─────────────────────────────────────────────────── cos'è un mensile New

-- Core, durata venduta 1 mese, e non un Flex (il Flex si rinnova da solo:
-- vedi 2026-10-15-flex-rinnovo-automatico-escluso.sql). La stessa regola
-- serve alla funzione e alla vista: sta in un posto solo.
create or replace function public.e_mensile_new(p_abbonamento text, p_gruppo_id uuid, p_durata integer, p_periodo text)
returns boolean
language sql
stable
-- Senza «set search_path»: con quello Postgres non espande la funzione dentro
-- la vista, e il gruppo CORE si cercherebbe una volta per riga invece che una
-- volta per query. Per questo i nomi sono qualificati.
as $$
	select coalesce(
		p_durata = 1
		and upper(p_periodo) = 'M'
		and p_abbonamento not ilike '%flex%'
		and p_gruppo_id = (select g.id from public.abbonamenti_gruppi g where g.nome = 'CORE'),
		false
	);
$$;

comment on function public.e_mensile_new(text, uuid, integer, text) is
	'Vero per un abbonamento Core da 1 mese che non è un Flex: alla scadenza va richiamato dai commerciali (Dashboard New), non dalla segreteria (Rinnovi Core).';

-- ──────────────────────────────────────────────── la creazione dei lead

create or replace function public.crea_lead_scadenze_mensili(p_giorni integer default 15)
returns table (opportunita_id uuid, persona_id uuid, abbonamento_id uuid, azione text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
	v_oggi date := (now() at time zone 'Europe/Rome')::date;
	r record;
	v_aperta uuid;
	v_aperta_abb uuid;
	v_id uuid;
begin
	for r in
		select a.id, a.persona_id, a.abbonamento, a.data_fine
		from abbonamenti a
		left join abbonamenti_mappatura m on m.prodotto = a.abbonamento
		where a.cancellato_il is null
			and a.persona_id is not null
			and coalesce(m.no_abbonamento, false) = false
			and e_mensile_new(a.abbonamento, m.gruppo_id, a.durata, a.periodo)
			and a.data_fine between v_oggi and v_oggi + greatest(p_giorni, 0)
			-- Una sola volta per mensile.
			and not exists (select 1 from opportunita o where o.abbonamento_id = a.id)
			-- Ha già comprato dopo: non c'è niente da vendere.
			and not exists (
				select 1
				from abbonamenti s
				left join abbonamenti_mappatura ms on ms.prodotto = s.abbonamento
				where s.persona_id = a.persona_id
					and s.id <> a.id
					and s.cancellato_il is null
					and s.data_inizio > a.data_inizio
					and coalesce(ms.no_abbonamento, false) = false
					and not ms.gruppo_id is distinct from m.gruppo_id
			)
		order by a.data_fine
	loop
		-- Al massimo una trattativa aperta per persona.
		select o.id, o.abbonamento_id into v_aperta, v_aperta_abb
		from opportunita o
		where o.persona_id = r.persona_id and o.stato in ('nuovo', 'in_gestione')
		order by o.creato_il desc
		limit 1;

		if v_aperta is not null then
			-- Già agganciata a un altro mensile: resta così, non si sposta.
			if v_aperta_abb is not null then continue; end if;
			update opportunita set abbonamento_id = r.id where id = v_aperta and abbonamento_id is null;
			v_id := v_aperta;
			azione := 'agganciata';
		else
			insert into opportunita (persona_id, stato, origine, abbonamento_id)
			values (r.persona_id, 'nuovo', 'scadenza-mensile', r.id)
			returning id into v_id;
			azione := 'creata';
		end if;

		insert into audit_log (email, azione, entita, entita_id, dettagli)
		values (
			'scadenze-mensili',
			'trattativa_da_scadenza_mensile',
			'opportunita',
			v_id::text,
			jsonb_build_object(
				'abbonamento_id', r.id,
				'abbonamento', r.abbonamento,
				'data_fine', r.data_fine,
				'azione', azione
			)
		);

		opportunita_id := v_id;
		persona_id := r.persona_id;
		abbonamento_id := r.id;
		return next;
	end loop;
end;
$$;

comment on function public.crea_lead_scadenze_mensili(integer) is
	'Apre (o aggancia alla trattativa aperta della persona) un lead da prendere in carico per ogni mensile Core non Flex che scade entro p_giorni giorni, se la persona non ha già comprato dopo. Una volta per abbonamento.';

revoke all on function public.crea_lead_scadenze_mensili(integer) from public, anon, authenticated;
grant execute on function public.crea_lead_scadenze_mensili(integer) to service_role;

-- ──────────────────────────────────────────────── la vista dei rinnovi

-- Come in 2026-10-15-flex-rinnovo-automatico-escluso.sql, più:
--   assegnato_a        — per un mensile New con la sua trattativa, quello
--                        della trattativa;
--   competenza_new     — il mensile non si assegna da Rinnovi Core;
--   lead_id, lead_stato — la trattativa della Dashboard New.
create or replace view public.abbonamenti_scadenze as
select
	a.id,
	a.source_iscrizione_id,
	a.persona_id,
	a.abbonamento,
	m.gruppo_id,
	a.data_inizio,
	a.data_fine,
	a.totale,
	p.nome,
	p.cognome,
	p.email,
	p.cellulare,
	r.id is not null as rinnovato,
	r.id as rinnovo_id,
	r.abbonamento as rinnovo_abbonamento,
	r.data_inizio as rinnovo_data_inizio,
	r.data_fine as rinnovo_data_fine,
	r.totale as rinnovo_totale,
	a.operatore_nome,
	a.venditore_nome,
	l.stato_manuale,
	l.nota,
	l.motivo_non_rinnovo,
	l.note_non_rinnovo,
	case when ld.id is not null then ld.assegnato_a else l.assegnato_a end as assegnato_a,
	coalesce(l.escluso_da_report, false) or coalesce(fx.automatico, false) as escluso_da_report,
	a.durata,
	a.periodo,
	r.durata as rinnovo_durata,
	r.periodo as rinnovo_periodo,
	coalesce(fx.automatico, false) as escluso_automatico,
	e_mensile_new(a.abbonamento, m.gruppo_id, a.durata, a.periodo) as competenza_new,
	ld.id as lead_id,
	ld.stato as lead_stato
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
left join public.persone p on p.id = a.persona_id
left join lateral (
	select r_1.id, r_1.abbonamento, r_1.data_inizio, r_1.data_fine, r_1.totale, r_1.durata, r_1.periodo
	from public.abbonamenti r_1
	left join public.abbonamenti_mappatura mr on mr.prodotto = r_1.abbonamento
	where r_1.persona_id = a.persona_id
		and r_1.cancellato_il is null
		and r_1.id <> a.id
		and r_1.data_inizio >= a.data_fine
		and r_1.data_inizio <= (a.data_fine + 30)
		and not mr.gruppo_id is distinct from m.gruppo_id
		and coalesce(mr.no_abbonamento, false) = false
	order by r_1.data_inizio
	limit 1
) r on true
left join lateral (
	select true as automatico
	from public.abbonamenti s
	left join public.abbonamenti_mappatura ms on ms.prodotto = s.abbonamento
	where a.abbonamento ilike '%flex%'
		and s.persona_id = a.persona_id
		and s.cancellato_il is null
		and s.id <> a.id
		and s.data_inizio > a.data_inizio
		and s.data_inizio <= (a.data_fine + 30)
		and not ms.gruppo_id is distinct from m.gruppo_id
		and coalesce(ms.no_abbonamento, false) = false
	limit 1
) fx on true
left join public.opportunita ld on ld.abbonamento_id = a.id
left join public.abbonamenti_scadenze_lavorazione l on l.abbonamento_id = a.id
where a.cancellato_il is null
	and a.data_fine is not null
	and a.persona_id is not null
	and coalesce(m.no_abbonamento, false) = false;

comment on column public.abbonamenti_scadenze.competenza_new is
	'Mensile Core non Flex: lo richiamano i commerciali dalla Dashboard New (lead_id), non la segreteria. L''assegnatario è quello della trattativa e non si cambia da Rinnovi Core.';

-- ─────────────────────────────────────────────────────── ogni mattina

-- 04:40 UTC, cioè le 5:40 o le 6:40 a Roma: dopo la sync notturna di Info4U e
-- dopo la chiusura delle trattative inattive (03:00 UTC, Vercel Cron), prima
-- che apra la segreteria.
select cron.unschedule(jobid) from cron.job where jobname = 'crea-lead-scadenze-mensili';
select cron.schedule(
	'crea-lead-scadenze-mensili',
	'40 4 * * *',
	$$select public.crea_lead_scadenze_mensili(15)$$
);
