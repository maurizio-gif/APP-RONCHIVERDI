-- Le trattative degli eventi scritti prima della regola.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-10-evento-apre-trattativa.sql — da cui
-- dipende: usa la funzione trattativa_per_evento definita là.
--
-- ─────────────────────────────────────────────────────────────── il perché
--
-- Da 2026-09-10-evento-apre-trattativa.sql, scrivere un evento in agenda per
-- una persona apre la sua trattativa: è il gesto stesso a dire che quella
-- persona è lavoro in corso. Gli eventi scritti *prima* di quella migration
-- non sono passati da lì, e le loro persone sono rimaste fuori da ogni
-- pipeline.
--
-- Il buco non si vede finché non serve chiuderla. Una persona senza
-- trattativa non ha niente da mettere «vinta»: il pannello che si apre dalla
-- sua riga non mostra il blocco trattativa — non perché sia nascosto, ma
-- perché la trattativa non esiste — e l'iscrizione che ha firmato non compare
-- in nessun conto. È il caso di Alice Binotto, appuntamento «iscrizione»
-- dell'11 settembre, tenuto e chiuso da Carola Porcella.
--
-- Rimedio generico e non una riga scritta a mano: la persona è una sola oggi,
-- ma è una sola perché il controllo è stato fatto oggi. Chiamare la funzione
-- che usa il pannello significa creare la trattativa com'è nata per essere
-- creata — in gestione, assegnata a chi teneva l'evento, con il lock che
-- impedisce i doppioni — invece di inventarsi un INSERT che gli somiglia.
--
-- Si può rieseguire: la funzione risponde 'invariata' a chi una trattativa
-- aperta ce l'ha già, e non toglie niente a nessuno.

-- ────────────────────────────────────────────────── prima: chi ne ha bisogno
--
-- Da leggere prima di eseguire il blocco qui sotto: è l'elenco delle persone
-- che verranno toccate, con l'evento che apre loro la trattativa.
select
	p.id as persona_id,
	p.nome,
	p.cognome,
	t.titolo,
	t.data,
	t.stato,
	t.assegnato_a
from public.task t
	join public.persone p on p.id = t.entita_id
where t.entita = 'persona'
	and not exists (select 1 from public.opportunita o where o.persona_id = p.id)
order by t.data;

-- ──────────────────────────────────────────────────────────── il rimedio

do $$
declare
	r record;
	esito record;
begin
	for r in
		-- Una riga per persona, non per evento: l'evento più vecchio decide chi
		-- è l'assegnatario, perché è quello che ha cominciato il lavoro.
		-- `distinct on` vuole l'ordinamento che comincia dalla stessa colonna.
		select distinct on (t.entita_id) t.entita_id as persona_id, t.assegnato_a
		from public.task t
		where t.entita = 'persona'
			and t.entita_id is not null
			and not exists (
				select 1 from public.opportunita o where o.persona_id = t.entita_id
			)
		order by t.entita_id, t.data, t.created_at
	loop
		select * into esito
		from public.trattativa_per_evento(r.persona_id, r.assegnato_a);

		raise notice 'persona % → trattativa % (%)',
			r.persona_id, esito.opportunita_id, esito.azione;
	end loop;
end $$;

-- ──────────────────────────────────────────────────────── da rileggere dopo
--
-- Zero righe: non è rimasta nessuna persona con un evento in agenda e nessuna
-- trattativa.
select count(*) as senza_trattativa
from public.task t
where t.entita = 'persona'
	and t.entita_id is not null
	and not exists (select 1 from public.opportunita o where o.persona_id = t.entita_id);
