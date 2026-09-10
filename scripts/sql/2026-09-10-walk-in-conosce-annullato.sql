-- La funzione che il trigger usa davvero impara a conoscere 'annullato'.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-10-trattativa-annullata.sql.
--
-- ─────────────────────────────────────────────────────────────── il perché
--
-- In `public` esistono DUE funzioni con questo nome:
--
--   trova_o_crea_opportunita(uuid)                   ← quella di
--       2026-09-02-opportunita.sql. Nessuno la chiama: è codice morto.
--   trova_o_crea_opportunita(uuid, text, boolean)    ← QUESTA
--       la versione nata col registro ospiti: `p_origine` scrive da dove
--       viene la trattativa, `p_senza_assegnazione` dice che quelle aperte
--       al banco nascono libere invece di ereditare l'ultimo commerciale.
--       È quella che chiama il trigger collega_persona_a_contatto, quindi è
--       quella che decide cosa succede a ogni lead dal sito e dal banco.
--
-- 2026-09-10-trattativa-annullata.sql ha aggiornato la prima, cioè quella
-- sbagliata: il repo conosceva solo lei, perché la migration che ha creato
-- la seconda (walk_in_guest_register, applicata al database il 9 settembre)
-- non è mai stata versionata qui dentro. Il risultato era che una trattativa
-- annullata continuava a essere riusata dal percorso vero: la persona
-- riscriveva dal sito, il trigger le riagganciava la riga annullata invece
-- di aprirne una nuova, e quel lead finiva su una trattativa che sta fuori
-- dai conti del Riepilogo.
--
-- Questo file fa due cose insieme: corregge la funzione, e finalmente la
-- **scrive nel repo**, che è il motivo per cui l'errore era possibile.
--
-- Le modifiche sono due sole, entrambe le stesse fatte alla sorella a un
-- argomento. Tutto il resto è la funzione come stava in produzione, comprese
-- le sue attribuzioni: NON è security definer e non fissa search_path,
-- diversamente dalla sorella — si eredita l'ambiente da
-- collega_persona_a_contatto, che invece lo fissa. Non è il posto per
-- cambiarlo: qui si corregge un difetto, non si riscrive la funzione.

create or replace function public.trova_o_crea_opportunita(
	p_persona_id uuid,
	p_origine text default null::text,
	p_senza_assegnazione boolean default false
)
returns uuid
language plpgsql
as $function$
declare
	v_id uuid;
	v_ultimo_assegnatario text;
begin
	if p_persona_id is null then return null; end if;

	-- Un'opportunità aperta resta di chi la sta già seguendo: la nuova
	-- richiesta gli si aggancia, non gliela porta via.
	--
	-- MODIFICA 1 — 'annullato' entra fra le chiuse. Senza, una trattativa
	-- annullata resterebbe «quella aperta» e la richiesta successiva ci si
	-- aggancerebbe: annullare non avrebbe annullato niente.
	select id into v_id
	from opportunita
	where persona_id = p_persona_id and stato not in ('vinto', 'perso', 'annullato')
	order by creato_il desc
	limit 1;

	if v_id is not null then return v_id; end if;

	-- Le opportunità nuove dal banco nascono da assegnare. Dal sito
	-- continuano a ereditare l'ultimo commerciale che ha seguito la persona:
	-- chi la conosce già è quello giusto per richiamarla.
	--
	-- MODIFICA 2 — l'annullata non detta l'assegnatario. Su una riga nata
	-- per sbaglio non la seguiva nessuno, e prenderne il nulla vorrebbe dire
	-- perdere il commerciale vero che c'era prima dell'errore.
	if not p_senza_assegnazione then
		select assegnato_a into v_ultimo_assegnatario
		from opportunita
		where persona_id = p_persona_id and stato <> 'annullato'
		order by creato_il desc
		limit 1;
	end if;

	insert into opportunita (persona_id, stato, assegnato_a, assegnato_il, origine)
	values (
		p_persona_id,
		'nuovo',
		v_ultimo_assegnatario,
		case when v_ultimo_assegnatario is not null then now() else null end,
		p_origine
	)
	returning id into v_id;

	return v_id;
end;
$function$;

comment on function public.trova_o_crea_opportunita(uuid, text, boolean) is
	'La trattativa aperta di una persona, o una nuova, per le richieste dal sito e dal banco. È QUESTA la firma che chiama il trigger collega_persona_a_contatto — la variante a un solo argomento è codice morto. p_origine scrive da dove nasce la trattativa (es. ''walk-in''); p_senza_assegnazione la fa nascere libera invece di ereditare l''ultimo commerciale. Le trattative annullate contano come chiuse: non si riusano e non dettano l''assegnatario.';

-- ──────────────────────────────────────────────────────── da verificare dopo

-- 1. Le due firme e chi conosce 'annullato'. Devono risultare entrambe
--    aggiornate: la (uuid) l'ha fatta la migration precedente, la
--    (uuid,text,boolean) questa.
select p.oid::regprocedure::text as firma,
	(prosrc ilike '%annullato%') as conosce_annullato
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'trova_o_crea_opportunita'
order by 1;

-- 2. Come la chiama il trigger: deve restare la chiamata a tre argomenti,
--    identica a prima. Se qui cambiasse qualcosa avrei toccato più del
--    dovuto.
select (regexp_match(prosrc, 'trova_o_crea_opportunita\s*\([^;]*\)'))[1] as come_la_chiama
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'collega_persona_a_contatto';

-- 3. La prova sul campo, la stessa di prima: se il trigger funziona è 0.
select count(*) as richieste_club_family_senza_trattativa
from public.form_contatti
where attivita in ('club-adulti', 'family')
	and persona_id is not null and opportunita_id is null;

-- ─────────────────────────────────────────────── quello che resta da fare
--
-- La firma a un argomento è codice morto e va tolta: finché esiste, chiunque
-- scriva `trova_o_crea_opportunita(qualcosa)` con un argomento solo ottiene
-- un errore di ambiguità — le due firme sono entrambe candidate, perché la
-- seconda ha valori di default per il 2° e il 3° parametro. È la trappola in
-- cui è caduta la migration precedente.
--
-- Non si toglie qui perché prima va escluso che la chiami qualcosa fuori da
-- questi due repository (una Edge Function, un automatismo n8n, una query
-- salvata). Dentro il database la cerca questa:
--
--   select p.oid::regprocedure::text
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname <> 'trova_o_crea_opportunita'
--     and p.prosrc ilike '%trova_o_crea_opportunita%';
--
-- Verificato che nessuno la usi, la si toglie con:
--
--   drop function public.trova_o_crea_opportunita(uuid);
