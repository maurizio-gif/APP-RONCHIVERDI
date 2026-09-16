-- trattativa_per_evento non scriveva mai `origine` sulla trattativa che apre:
-- restava null, indistinguibile a colpo d'occhio da una trattativa nata dal
-- sito (che ha origine null di suo, vedi ORIGINI_SITO in lib/provenienza.ts)
-- se non facendo l'anti-join con form_contatti. provenienzaTrattativa in
-- lib/provenienza.ts continua a etichettarle "Agenda" allo stesso modo
-- (deriva dall'assenza di una richiesta collegata, non da questo valore): qui
-- si aggiunge solo la tracciabilità sulla riga stessa, per poterle trovare e
-- contare con una query diretta su opportunita invece di un anti-join su
-- form_contatti ogni volta.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq).

create or replace function public.trattativa_per_evento(
	p_persona_id uuid,
	p_operatore text
)
returns table (opportunita_id uuid, azione text)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_id uuid;
	v_stato text;
	v_assegnato text;
	v_azione text;
begin
	if p_persona_id is null then return; end if;

	perform pg_advisory_xact_lock(hashtextextended(p_persona_id::text, 0));

	select o.id, o.stato, o.assegnato_a
	into v_id, v_stato, v_assegnato
	from opportunita o
	where o.persona_id = p_persona_id
		and o.stato not in ('vinto', 'perso', 'annullato')
	order by o.creato_il desc
	limit 1;

	if v_id is null then
		insert into opportunita (
			persona_id, stato, stato_da, stato_il, assegnato_a, assegnato_il, assegnato_da, origine
		)
		values (
			p_persona_id,
			case when p_operatore is null then 'nuovo' else 'in_gestione' end,
			p_operatore,
			now(),
			p_operatore,
			case when p_operatore is null then null else now() end,
			p_operatore,
			'agenda'
		)
		returning id into v_id;

		return query select v_id, 'creata'::text;
		return;
	end if;

	if v_assegnato is null and p_operatore is not null then
		update opportunita
		set assegnato_a = p_operatore,
			assegnato_il = now(),
			assegnato_da = p_operatore,
			stato = 'in_gestione',
			stato_da = p_operatore,
			stato_il = now()
		where id = v_id;
		v_azione := 'presa_in_carico';

	elsif v_stato = 'nuovo' then
		update opportunita
		set stato = 'in_gestione', stato_da = p_operatore, stato_il = now()
		where id = v_id;
		v_azione := 'avviata';

	else
		v_azione := 'invariata';
	end if;

	return query select v_id, v_azione;
end;
$$;

comment on function public.trattativa_per_evento(uuid, text) is
	'La trattativa aperta di una persona quando le si scrive un evento in agenda, creandola se non c''è. Diversa da trova_o_crea_opportunita: quella serve alle richieste dal sito e nasce ''nuovo'' senza titolare, questa nasce ''in_gestione'' assegnata a chi ha scritto l''evento, perché l''agenda la tiene il settore core e un evento è una trattativa in corso. Non toglie mai una trattativa a chi la segue. La trattativa che crea porta origine = ''agenda'', per poterla riconoscere con una query diretta su opportunita. Ritorna l''id e cos''è successo: creata | presa_in_carico | avviata | invariata.';

revoke all on function public.trattativa_per_evento(uuid, text) from public, anon, authenticated;
grant execute on function public.trattativa_per_evento(uuid, text) to service_role;

-- Le trattative nate in agenda **prima** di questa migration: nessuna riga
-- form_contatti a cui agganciarle è l'unico modo di riconoscerle a
-- posteriori, esattamente come nella query di controllo già usata per
-- l'audit. Il filtro su origine is null evita di toccare le trattative del
-- sito, che restano null di loro (vedi ORIGINI_SITO).
update opportunita o
set origine = 'agenda'
where o.origine is null
	and not exists (
		select 1 from form_contatti f where f.opportunita_id = o.id
	);
