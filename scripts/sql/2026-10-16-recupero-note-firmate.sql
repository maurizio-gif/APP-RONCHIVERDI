-- Recupero mancati rinnovi: ogni nota riportata nella trattativa dice chi
-- l'ha scritta e quando.
--
-- La nota del lead (crea_trattative_recupero, 2026-10-15-recupero-mancati-rinnovi.sql)
-- riassume quello che il team Rinnovi Core ha scritto sull'abbonamento
-- scaduto. Fino a qui riportava i testi senza firma; adesso ogni voce ha
-- autore e data e ora:
--
--   · motivo e appunto: la scheda di lavorazione non tiene una firma per
--     campo, solo l'ultima modifica (aggiornato_da / aggiornato_il) — si
--     scrive così, «ultima modifica della scheda», per non attribuire a
--     qualcuno una scelta che potrebbe non aver fatto;
--   · nota sul mancato rinnovo: l'ultima del suo storico
--     (abbonamenti_scadenze_note, tipo non_rinnovo), con il suo autore;
--   · note di gestione: le ultime tre, ciascuna con autore e momento;
--   · in testa, chi aveva il rinnovo in carico (lavorazione.assegnato_a).
--   Le scritture dei processi automatici (importazioni, sincronizzazione)
--   si dichiarano come tali, non come una persona.
--
-- In fondo la firma della nota stessa: scritta in automatico dal CRM, con
-- data e ora. Le 62 trattative di recupero già create vengono riscritte con
-- lo stesso blocco (con i dati di oggi) e la firma alla data in cui sono nate.

-- Nome e cognome dello staff per email; l'email se non è dello staff.
create or replace function public.nome_operatore(p_email text)
returns text
language sql
stable
set search_path = ''
as $$
	select case
		when nullif(btrim(p_email), '') is null then 'autore non registrato'
		-- Le scritture dei processi automatici portano un'etichetta, non
		-- un'email: si dice cosa sono.
		when p_email !~ '@' then case
			when p_email ilike 'import%' then 'importazione dal report rinnovi'
			when p_email ilike 'sync%' then 'sincronizzazione dal gestionale'
			else 'processo automatico (' || p_email || ')' end
		else coalesce(
			(select nullif(btrim(concat_ws(' ', s.nome, s.cognome)), '') from public.staff_users s where lower(s.email) = lower(btrim(p_email))),
			p_email)
	end
$$;

-- «16/10/2026 alle 06:50», ora di Roma.
create or replace function public.quando_italiano(p_momento timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
	select case when p_momento is null then 'data non registrata'
		else to_char(p_momento at time zone 'Europe/Rome', 'DD/MM/YYYY "alle" HH24:MI') end
$$;

-- Il blocco «Rinnovi Core» della nota, con le firme.
create or replace function public.blocco_rinnovi_core(p_abbonamento_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
	l record;
	v_righe text[] := '{}';
	v_scheda text;
	v_nota record;
	v_gestione text;
begin
	select * into l from public.abbonamenti_scadenze_lavorazione where abbonamento_id = p_abbonamento_id;
	v_scheda := '(ultima modifica della scheda: ' || public.nome_operatore(l.aggiornato_da) || ', ' || public.quando_italiano(l.aggiornato_il) || ')';

	if coalesce(l.motivo_non_rinnovo, '') <> '' then
		v_righe := v_righe || ('· motivo «' || l.motivo_non_rinnovo || '» ' || v_scheda);
	end if;

	if coalesce(l.note_non_rinnovo, '') <> '' then
		select n.autore, n.creato_il into v_nota
		from public.abbonamenti_scadenze_note n
		where n.abbonamento_id = p_abbonamento_id and n.tipo = 'non_rinnovo'
		order by n.creato_il desc limit 1;
		v_righe := v_righe || ('· nota «' || left(l.note_non_rinnovo, 300) || '» — '
			|| case when v_nota.creato_il is not null
				then public.nome_operatore(v_nota.autore) || ', ' || public.quando_italiano(v_nota.creato_il)
				else public.nome_operatore(l.aggiornato_da) || ', ' || public.quando_italiano(l.aggiornato_il) end);
	end if;

	if coalesce(l.nota, '') <> '' then
		v_righe := v_righe || ('· appunto «' || left(l.nota, 300) || '» ' || v_scheda);
	end if;

	select string_agg('· «' || left(n.testo, 300) || '» — ' || public.nome_operatore(n.autore) || ', ' || public.quando_italiano(n.creato_il),
		E'\n' order by n.creato_il desc)
	into v_gestione
	from (
		select n.testo, n.autore, n.creato_il from public.abbonamenti_scadenze_note n
		where n.abbonamento_id = p_abbonamento_id and coalesce(n.tipo, 'gestione') = 'gestione'
		order by n.creato_il desc limit 3
	) n;

	return concat_ws(E'\n',
		-- Chi aveva il rinnovo in carico in Rinnovi Core.
		'Rinnovo gestito da: ' || case when nullif(btrim(l.assegnato_a), '') is null
			then 'nessuno (non era assegnato in Rinnovi Core)'
			else public.nome_operatore(l.assegnato_a) end || '.',
		case when cardinality(v_righe) > 0
			then 'In Rinnovi Core:' || E'\n' || array_to_string(v_righe, E'\n')
			else 'In Rinnovi Core non è stato registrato un motivo.' end,
		case when v_gestione is not null then 'Note di gestione (le ultime):' || E'\n' || v_gestione end
	);
end
$$;

create or replace function public.firma_nota_recupero(p_momento timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
	select '— Nota scritta in automatico dal CRM (recupero mancati rinnovi) il ' || public.quando_italiano(p_momento) || '.'
$$;

-- La funzione che crea le trattative, con il blocco firmato e la firma.
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
		if exists (select 1 from opportunita o where o.persona_id = r.persona_id and o.stato in ('nuovo', 'in_gestione')) then
			continue;
		end if;

		v_anni_testo := case
			when r.anni <= 0 then 'al primo abbonamento core'
			when r.anni = 1 then 'socio core da 1 anno'
			else 'socio core da ' || r.anni || ' anni'
		end || case when r.primo_inizio is not null then ' (primo abbonamento core: ' || data_italiana(r.primo_inizio) || ')' else '' end;

		v_nota := concat_ws(E'\n',
			'Mancato rinnovo: l''abbonamento core «' || r.abbonamento || '» (' || r.durata || ' mesi'
				|| case when r.totale is not null then ', ' || replace(to_char(r.totale, 'FM999990.00'), '.', ',') || ' €' else '' end
				|| ') è scaduto il ' || data_italiana(r.data_fine)
				|| ' e non è stato rinnovato nei 30 giorni seguiti dal team Rinnovi Core.',
			initcap(left(v_anni_testo, 1)) || substr(v_anni_testo, 2) || '.',
			blocco_rinnovi_core(r.id),
			'Passato al settore New il ' || data_italiana((now() at time zone 'Europe/Rome')::date)
				|| ': richiamare per capire perché non ha rinnovato e se, e a che condizioni, tornerebbe.',
			case when (now() at time zone 'Europe/Rome')::date <= date '2026-10-31' then
				'Da proporre: è in corso la campagna per recuperare chi, come questa persona, ci ha lasciato. '
				|| 'Chi rientra non paga la quota di attivazione contrattuale. La campagna termina il 31 ottobre 2026.'
			end,
			firma_nota_recupero(now())
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

-- Le trattative già create: al posto delle righe «In Rinnovi Core…» e
-- «Ultime note di gestione…» il blocco firmato, dopo le prime due righe
-- (scadenza e anzianità); in fondo la firma, alla data di nascita del lead.
-- Si riscrive solo se la firma non c'è già: rilanciabile.
do $$
declare
	o record;
	v_righe text[];
	v_tenute text[];
begin
	for o in
		select id, note, creato_il, recupero_abbonamento_id
		from public.opportunita
		where origine = 'recupero-rinnovo'
			and recupero_abbonamento_id is not null
			and note is not null
			and note not like '%Nota scritta in automatico dal CRM%'
	loop
		v_righe := string_to_array(o.note, E'\n');
		select array_agg(r order by i) into v_tenute
		from unnest(v_righe) with ordinality as t(r, i)
		where r not like 'In Rinnovi Core%' and r not like 'Ultime note di gestione:%';

		update public.opportunita
		set note = array_to_string(
			v_tenute[1:2]
				|| public.blocco_rinnovi_core(o.recupero_abbonamento_id)
				|| coalesce(v_tenute[3:], '{}')
				|| public.firma_nota_recupero(o.creato_il),
			E'\n')
		where id = o.id;
	end loop;
end $$;

-- Prima della riscrittura le 62 note sono state copiate in
-- public.backup_note_recupero_20261016 (id, note): per tornare indietro,
--   update opportunita o set note = b.note from backup_note_recupero_20261016 b where b.id = o.id;
