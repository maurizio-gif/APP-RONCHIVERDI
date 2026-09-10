-- Via la firma morta di trova_o_crea_opportunita.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-10-walk-in-conosce-annullato.sql.
--
-- Non serve coordinarla con un deploy: la funzione che si toglie non la
-- chiama nessuno, né il database né il pannello.
--
-- ─────────────────────────────────────────────────────────────── il perché
--
-- In `public` convivevano due funzioni con questo nome:
--
--   (uuid)                    quella di 2026-09-02-opportunita.sql
--   (uuid, text, boolean)     quella nata col registro ospiti, che è quella
--                             che chiama il trigger collega_persona_a_contatto
--
-- La prima non la chiama più nessuno da quando il trigger è passato alla
-- seconda. Ma non era solo peso morto: **era una trappola**, e ci è già
-- caduta una migration. Chi legge `scripts/sql/` trova solo la firma a un
-- argomento, la corregge, e la correzione non ha effetto perché il percorso
-- vero passa dall'altra. È successo il 10 settembre con lo stato
-- 'annullato': la trattativa annullata continuava a essere riusata dai lead
-- dal sito, e il difetto si è visto solo interrogando il database.
--
-- C'è anche un secondo modo in cui fa danno. La firma a tre argomenti ha
-- valori di default per il 2° e il 3° parametro, quindi è candidata anche
-- per una chiamata con **un solo** argomento: finché esistono entrambe,
-- `trova_o_crea_opportunita(qualche_uuid)` è ambigua e PostgreSQL la
-- rifiuta con «function is not unique». Dentro il trigger quell'errore
-- finirebbe nel suo `exception when others`, che lo trasforma in un warning:
-- il lead entrerebbe senza trattativa e nessuno se ne accorgerebbe.
--
-- Togliendola resta una sola candidata, e una chiamata a un argomento torna
-- a funzionare — risolve sulla firma a tre con i suoi default.
--
-- Prima di eseguire è stato escluso che la usi qualcuno: nessuna funzione
-- del database la nomina (tranne collega_persona_a_contatto, che chiama
-- l'altra), il pannello non la invoca mai per RPC, il sito nemmeno. Le
-- query in coda a questo file rifanno il controllo.

-- Il controllo, di nuovo e sul posto. Se qualcosa non torna solleva
-- un'eccezione e non si droppa niente: meglio una migration che si rifiuta
-- di partire che una funzione tolta a qualcuno che la usava.
--
-- Cerca `nome(` e non il nome da solo: dentro trattativa_per_evento la
-- funzione è soltanto *citata* in un commento — «(vedi
-- trova_o_crea_opportunita)» — e una citazione non è una chiamata. Con il
-- confronto per sola presenza del nome questo controllo dava un falso
-- positivo e bloccava tutto.
do $$
declare
	v_altri text;
	v_chiamata text;
begin
	-- 1. Nessuno la chiama, tranne il trigger.
	select string_agg(p.oid::regprocedure::text, ', ')
	into v_altri
	from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public'
		and p.proname not in ('trova_o_crea_opportunita', 'collega_persona_a_contatto')
		and p.prosrc ~ 'trova_o_crea_opportunita\s*\(';

	if v_altri is not null then
		raise exception
			'Non tolgo niente: trova_o_crea_opportunita è chiamata anche da %. Controlla con quanti argomenti prima di proseguire.',
			v_altri;
	end if;

	-- 2. E il trigger la chiama con più di un argomento, cioè sulla firma
	--    che resta. Se chiamasse con un argomento solo, toglierla qui
	--    lascerebbe il trigger a chiamare una funzione che non esiste più.
	select (regexp_match(p.prosrc, 'trova_o_crea_opportunita\s*\(([^;]*)\)'))[1]
	into v_chiamata
	from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public' and p.proname = 'collega_persona_a_contatto';

	if v_chiamata is null or v_chiamata not like '%,%' then
		raise exception
			'Non tolgo niente: collega_persona_a_contatto non chiama la firma a più argomenti (trovato: %).',
			coalesce(v_chiamata, 'nessuna chiamata');
	end if;
end;
$$;

drop function if exists public.trova_o_crea_opportunita(uuid);

-- ──────────────────────────────────────────────────────── da verificare dopo

-- 1. Ne resta una sola, ed è quella giusta.
select p.oid::regprocedure::text as firma,
	(prosrc ilike '%annullato%') as conosce_annullato
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'trova_o_crea_opportunita';

-- 2. Il trigger è intatto e continua a chiamarla a tre argomenti.
select (regexp_match(prosrc, 'trova_o_crea_opportunita\s*\([^;]*\)'))[1] as come_la_chiama
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'collega_persona_a_contatto';

-- 3. La prova sul campo, la stessa di sempre: se il trigger funziona è 0.
select count(*) as richieste_club_family_senza_trattativa
from public.form_contatti
where attivita in ('club-adulti', 'family')
	and persona_id is not null and opportunita_id is null;
