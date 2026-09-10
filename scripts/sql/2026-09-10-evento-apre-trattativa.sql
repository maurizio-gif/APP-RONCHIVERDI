-- L'evento in agenda apre la trattativa.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-10-trattativa-annullata.sql — da cui
-- dipende: la funzione qui sotto considera chiuse anche le annullate, e senza
-- quella migration lo stato 'annullato' non esiste ancora.
--
-- Va eseguita PRIMA del deploy: il pannello chiama questa funzione per RPC a
-- ogni evento creato dall'agenda, e senza di lei ogni salvataggio lascerebbe
-- l'evento scritto e la trattativa no.
--
-- ─────────────────────────────────────────────────────────────── il perché
--
-- L'agenda la tiene il settore core, cioè gli adulti: se un commerciale mette
-- un evento su una persona, quella persona è una trattativa in corso. Non
-- serve che l'abbia dichiarato spuntando un'attività di interesse — è il
-- gesto stesso a dirlo.
--
-- Prima non era così, e il buco si vedeva proprio dove fa più male: l'agenda
-- accetta contatti che in anagrafica non esistono ancora (li crea al volo,
-- vedi creaVoce), quindi si poteva fissare un appuntamento a una persona che
-- non compariva in nessuna pipeline. È il caso di adesso: le trattative in
-- corso stanno sull'agenda di carta, si riscrivono qui evento per evento, e
-- ogni evento deve portarsi dietro la sua trattativa — altrimenti si
-- ricopierebbe un calendario senza ricostruire il lavoro che rappresenta.
--
-- Diverso da trova_o_crea_opportunita, che serve alle richieste dal sito:
-- quella nasce 'nuovo' e senza titolare, perché una richiesta è lavoro che
-- aspetta qualcuno. Qui il titolare c'è già ed è chi ha scritto l'evento: la
-- trattativa nasce 'in_gestione' e assegnata a lui, o resterebbe in «da
-- prendere in carico» qualcosa che qualcuno sta già seguendo.

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

	-- Due commerciali che scrivono un evento per la stessa persona nello
	-- stesso istante troverebbero entrambi «nessuna trattativa aperta» e ne
	-- creerebbero due. Il lock è sulla persona e dura la transazione: il
	-- secondo aspetta e trova quella del primo. Costa niente e toglie
	-- l'unico modo in cui questa funzione può sdoppiare una pipeline.
	perform pg_advisory_xact_lock(hashtextextended(p_persona_id::text, 0));

	select o.id, o.stato, o.assegnato_a
	into v_id, v_stato, v_assegnato
	from opportunita o
	where o.persona_id = p_persona_id
		and o.stato not in ('vinto', 'perso', 'annullato')
	order by o.creato_il desc
	limit 1;

	-- Nessuna trattativa aperta: la apre l'evento, già in mano a chi l'ha
	-- scritto. Senza operatore resta 'nuovo' e libera — «in gestione a
	-- nessuno» è la contraddizione che il Riepilogo poi mostra come lavoro di
	-- qualcuno che non esiste.
	if v_id is null then
		insert into opportunita (
			persona_id, stato, stato_da, stato_il, assegnato_a, assegnato_il, assegnato_da
		)
		values (
			p_persona_id,
			case when p_operatore is null then 'nuovo' else 'in_gestione' end,
			p_operatore,
			now(),
			p_operatore,
			case when p_operatore is null then null else now() end,
			p_operatore
		)
		returning id into v_id;

		-- `return` e non solo `return query`: in plpgsql RETURN QUERY accoda
		-- righe al risultato e prosegue. Senza questa riga l'esecuzione
		-- cadeva nel blocco qui sotto, riscriveva l'assegnatario appena
		-- messo e accodava una seconda riga — la funzione ne tornava due, e
		-- chi legge «la prima» leggeva il caso sbagliato.
		return query select v_id, 'creata'::text;
		return;
	end if;

	-- Esiste già. Da qui in poi non si toglie niente a nessuno: chi la segue
	-- continua a seguirla, e l'evento di un collega non gliela porta via.
	if v_assegnato is null and p_operatore is not null then
		-- Libera: scrivere un evento su una trattativa che nessuno segue è
		-- prendersela in carico, esattamente come premere il pulsante.
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
		-- Ha un titolare ma è ferma in «da prendere in carico»: succede
		-- quando eredita l'assegnatario di una trattativa chiusa (vedi
		-- trova_o_crea_opportunita). Un evento scritto sopra dice che il
		-- lavoro è cominciato; l'assegnatario però non si tocca.
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
	'La trattativa aperta di una persona quando le si scrive un evento in agenda, creandola se non c''è. Diversa da trova_o_crea_opportunita: quella serve alle richieste dal sito e nasce ''nuovo'' senza titolare, questa nasce ''in_gestione'' assegnata a chi ha scritto l''evento, perché l''agenda la tiene il settore core e un evento è una trattativa in corso. Non toglie mai una trattativa a chi la segue. Ritorna l''id e cos''è successo: creata | presa_in_carico | avviata | invariata.';

revoke all on function public.trattativa_per_evento(uuid, text) from public, anon, authenticated;
grant execute on function public.trattativa_per_evento(uuid, text) to service_role;

-- ──────────────────────────────────────────────────────── da rileggere dopo

-- Le trattative nate da un evento invece che da una richiesta dal sito: non
-- hanno nessuna riga in form_contatti agganciata. Sono quelle ricopiate
-- dall'agenda di carta, e il conto dice a che punto è l'allineamento.
select
	count(*) filter (where f.id is null) as nate_da_un_evento,
	count(*) filter (where f.id is not null) as nate_da_una_richiesta
from public.opportunita o
	left join public.form_contatti f on f.opportunita_id = o.id
where o.stato not in ('vinto', 'perso', 'annullato');
