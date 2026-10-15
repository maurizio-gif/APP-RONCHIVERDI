-- «La richiesta è per un'altra persona»: sposta una trattativa sulla persona
-- giusta.
--
-- Il caso vero (ottobre 2026): Giorgio Perucca si registra al Guest Register
-- per la moglie, Lesya Borshchenko, che poi si iscrive. La trattativa nasce
-- sulla scheda di Giorgio, la vendita arriva su quella di Lesya, e il trigger
-- chiudi_trattativa_da_abbonamento — che cerca la trattativa aperta della
-- **stessa persona** della vendita — non la trova: va chiusa a mano.
--
-- Correggere i dati della scheda non basta: Lesya ha già la sua scheda (è
-- socia Info4U), e la scheda di Giorgio è un socio vero, che la sincronizzazione
-- riscriverebbe comunque. Si sposta invece la trattativa, con quello che le
-- appartiene:
--
--  - la trattativa (opportunita.persona_id);
--  - le sue richieste dal sito (form_contatti con opportunita_id): sono la
--    richiesta per lei, non per lui;
--  - gli eventi d'agenda scritti sulla persona **da quando è nata la
--    trattativa**: le telefonate fatte per quel lead. Quelli di prima sono
--    della persona di prima, e restano lì.
--
-- Se la trattativa è aperta e la persona giusta ha già comprato dopo che è
-- nata, si chiude subito come vinta con la stessa regola del trigger (il
-- prodotto come nota, il totale come valore, 'sync-info4u' come autore): è
-- esattamente la chiusura che sarebbe avvenuta da sola, se la richiesta fosse
-- stata intestata bene fin dall'inizio. Le vendite successive la trovano da
-- sole, perché ora è sulla scheda giusta.
--
-- Una persona ha al più una trattativa aperta (trova_o_crea_opportunita e
-- trattativa_per_evento la riusano sempre): se quella giusta ne ha già una
-- aperta, spostarne un'altra aperta su di lei ne farebbe due. Si rifiuta, e il
-- pannello lo dice.
--
-- La chiama spostaTrattativaSuPersona (app/dashboard/richieste/trattativa-actions.ts),
-- che controlla prima i diritti di chi la chiede.

create or replace function public.sposta_trattativa_su_persona(
	p_opportunita uuid,
	p_persona uuid,
	p_chi text
)
returns table (azione text, motivo_vinto text, valore_euro numeric)
language plpgsql
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
	v_trattativa opportunita%rowtype;
	v_da uuid;
	v_vendita record;
	v_nota text;
	v_valore numeric;
	v_azione text := 'spostata';
begin
	select * into v_trattativa from opportunita where id = p_opportunita for update;
	if not found then
		raise exception 'trattativa_non_trovata';
	end if;
	if not exists (select 1 from persone where id = p_persona) then
		raise exception 'persona_non_trovata';
	end if;
	v_da := v_trattativa.persona_id;
	if v_da = p_persona then
		raise exception 'stessa_persona';
	end if;

	if v_trattativa.stato in ('nuovo', 'in_gestione') and exists (
		select 1 from opportunita o
		where o.persona_id = p_persona and o.stato in ('nuovo', 'in_gestione') and o.id <> p_opportunita
	) then
		raise exception 'ha_gia_trattativa_aperta';
	end if;

	update opportunita set persona_id = p_persona where id = p_opportunita;

	update form_contatti set persona_id = p_persona where opportunita_id = p_opportunita;

	update task
	set entita_id = p_persona::text
	where entita = 'persona'
		and entita_id = v_da::text
		and created_at >= v_trattativa.creato_il;

	-- La vendita che l'avrebbe chiusa da sola: la prima della persona giusta
	-- dopo la nascita della trattativa, con un nome prodotto (senza, come nel
	-- trigger, non si chiude).
	if v_trattativa.stato in ('nuovo', 'in_gestione') then
		select a.abbonamento, a.variante, a.totale, a.data_vendita into v_vendita
		from abbonamenti a
		where a.persona_id = p_persona
			and a.cancellato_il is null
			-- Per giorno, a Roma: al banco la vendita può essere registrata
			-- qualche minuto prima della scheda ospite dello stesso giorno.
			and (a.data_vendita at time zone 'Europe/Rome')::date
				>= (v_trattativa.creato_il at time zone 'Europe/Rome')::date
			and coalesce(btrim(a.abbonamento), '') <> ''
		-- Il primo giorno utile, e in quel giorno la vendita più alta: lo stesso
		-- giorno ci possono essere un abbonamento e un omaggio da 0 €, e la
		-- trattativa la chiude l'abbonamento.
		order by (a.data_vendita at time zone 'Europe/Rome')::date asc, a.totale desc nulls last
		limit 1;

		if found then
			v_valore := v_vendita.totale;
			v_nota := btrim(
				v_vendita.abbonamento
				|| case when coalesce(btrim(v_vendita.variante), '') <> '' then ' - ' || btrim(v_vendita.variante) else '' end
			);
			update opportunita
			set stato = 'vinto',
				stato_da = 'sync-info4u',
				stato_il = now(),
				chiuso_il = v_vendita.data_vendita,
				motivo_vinto = v_nota,
				valore_euro = v_valore,
				motivo_perso = null,
				motivo_annullato = null,
				triple_pack = false
			where id = p_opportunita;
			v_azione := 'spostata_e_vinta';
		end if;
	end if;

	insert into audit_log (email, azione, entita, entita_id, dettagli)
	values (
		p_chi,
		'trattativa_spostata',
		'opportunita',
		p_opportunita::text,
		jsonb_build_object(
			'da_persona', v_da,
			'a_persona', p_persona,
			'vinta', v_azione = 'spostata_e_vinta',
			'motivo_vinto', v_nota,
			'valore', v_valore
		)
	);

	azione := v_azione;
	motivo_vinto := v_nota;
	valore_euro := v_valore;
	return next;
end;
$$;

revoke all on function public.sposta_trattativa_su_persona(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.sposta_trattativa_su_persona(uuid, uuid, text) to service_role;
