-- Due correzioni sugli eventi di agenda, che vanno insieme:
--
--   1. niente impegno automatico quando la richiesta porta già un
--      appuntamento con sé;
--   2. il collegamento di un evento può essere anche una persona, non solo
--      una richiesta dal sito.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-03-impegno-richiesta-ripetuta.sql.


-- ---------------------------------------------------------------------------
-- 1. L'impegno automatico solo dove non c'è già un evento
-- ---------------------------------------------------------------------------
-- impegno_per_richiesta_ripetuta nasce per un problema vero: una persona già
-- seguita riscrive, trova_o_crea_opportunita riusa la trattativa aperta senza
-- cambiare niente, e chi la segue non se ne accorge. L'impegno in agenda va
-- addosso alla persona giusta.
--
-- Ma se quella richiesta è un appuntamento o una telefonata prenotata dal
-- sito, in agenda ci finisce da sola (vedi voceDaContatto in lib/agenda.ts):
-- l'impegno diventava un secondo promemoria, datato oggi, per una cosa che
-- era già in calendario al suo giorno. Due righe per un solo fatto, e quella
-- di troppo è pure quella sbagliata — dice «da fare oggi» di un incontro
-- fissato la settimana prossima.
--
-- Resta dov'è utile: sulle richieste senza appuntamento (i «messaggio»), che
-- altrimenti non lascerebbero nessuna traccia nell'agenda di nessuno.
create or replace function public.impegno_per_richiesta_ripetuta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	v_assegnato text;
	v_nome text;
begin
	-- Mai bloccare l'inserimento della richiesta: un lead perso è un danno
	-- vero, un promemoria mancante si recupera dall'elenco.
	begin
		if new.opportunita_id is null then
			return new;
		end if;

		-- La richiesta porta già un evento con sé: l'appuntamento prenotato
		-- dal sito è una voce d'agenda per conto suo, al suo giorno e alla sua
		-- ora. Un impegno in più sarebbe un doppione datato oggi.
		if new.azione in ('appuntamento', 'telefonata') and new.data_scelta is not null then
			return new;
		end if;

		-- Solo su una trattativa che qualcuno sta già lavorando. Se è appena
		-- nata (stato 'nuovo') la richiesta è comunque in cima al «da
		-- lavorare» del canale, e un impegno in più sarebbe rumore.
		select assegnato_a into v_assegnato
		from opportunita
		where id = new.opportunita_id and stato = 'in_gestione';

		if v_assegnato is null then
			return new;
		end if;

		-- Una volta sola per richiesta: se questa riga ha già un impegno
		-- collegato non se ne aggiunge un altro. Usa task_entita_idx.
		if exists (
			select 1 from task
			where entita = 'form_contatti' and entita_id = new.id::text
		) then
			return new;
		end if;

		v_nome := nullif(btrim(coalesce(new.nome, '') || ' ' || coalesce(new.cognome, '')), '');

		insert into task (titolo, tipo, note, data, ora, assegnato_a, stato, entita, entita_id)
		values (
			'Ha riscritto: ' || coalesce(v_nome, 'richiesta dal sito'),
			-- 'task' e non un appuntamento: è una cosa da fare, non un impegno
			-- preso con qualcuno a un'ora precisa. Con ora nulla non occupa
			-- nessuno slot di quelli che il sito offre (vedi slotOccupati).
			'task',
			-- Il perché, sotto gli occhi di chi lo trova in agenda.
			concat_ws(' — ', new.attivita_label, new.messaggio),
			-- Oggi a Roma, non la data del server: l'impegno è per la giornata
			-- di chi lavora, e su Vercel l'orologio è UTC.
			(now() at time zone 'Europe/Rome')::date,
			null,
			v_assegnato,
			'aperto',
			'form_contatti',
			new.id::text
		);
	exception when others then
		raise warning 'Impegno per richiesta ripetuta non creato: %', sqlerrm;
	end;

	return new;
end;
$$;

comment on function public.impegno_per_richiesta_ripetuta() is
	'Crea in agenda un impegno per l''assegnatario quando arriva una richiesta SENZA appuntamento su una trattativa già in gestione: il riuso della trattativa non lascia altrimenti nessun segno. Le richieste che prenotano un appuntamento sono già una voce d''agenda per conto loro e non ne generano uno.';


-- ---------------------------------------------------------------------------
-- 2. Il collegamento di un evento
-- ---------------------------------------------------------------------------
-- Un evento è sempre agganciato a qualcosa: un evento senza contatto è una
-- riga che nessuno ritrova — non compare nella scheda di nessuno, e in agenda
-- è un titolo senza il perché.
--
-- I valori ammessi sono due (vedi lib/eventi.ts):
--   form_contatti → la richiesta dal sito da cui l'evento nasce
--   persona       → il contatto in anagrafica, per gli eventi creati a mano
--
-- Perché `persona` e non `opportunita`: la trattativa è della persona e si
-- chiude e riapre nel tempo; agganciare gli eventi all'opportunità aperta
-- oggi li lascerebbe orfani alla prossima. La persona resta.
--
-- Il vincolo è NOT VALID di proposito: le righe già in tabella non vengono
-- rilette. Oggi sono tutte 'form_contatti' e passerebbero, ma un vincolo che
-- riscrive il passato è un vincolo che al prossimo deploy blocca una
-- migration per una riga di sei mesi fa.
alter table public.task
	drop constraint if exists task_entita_check;

alter table public.task
	add constraint task_entita_check
	check (entita is null or entita in ('form_contatti', 'persona', 'task'))
	not valid;

comment on column public.task.entita is
	'A cosa è agganciato l''evento: form_contatti (la richiesta da cui nasce) oppure persona (il contatto in anagrafica). Nessuna chiave esterna: cancellare un lead non deve portare via lo storico dell''agenda. Nullo solo per le voci create prima che il collegamento fosse obbligatorio.';
