-- Un impegno in agenda per l'assegnatario, quando una persona che già segue
-- scrive di nuovo.
--
-- Il problema: trova_o_crea_opportunita riusa la trattativa aperta senza
-- cambiare stato né assegnatario, quindi la seconda richiesta non muove
-- niente — nemmeno una riga di storico. Il badge della trattativa resta
-- identico, e chi la segue se ne accorge solo se ripassa dall'elenco delle
-- richieste. In elenco ora c'è la spia «2ª richiesta», ma è una spia passiva:
-- va vista. Un impegno in agenda invece va addosso alla persona giusta.
--
-- Sta nel database e non in /api/lead: le richieste entrano anche dal form
-- inline di Chinesis e domani da altri moduli, e la regola deve valere per
-- tutti senza riscriverla in ogni punto d'ingresso — la stessa ragione per
-- cui qui vive già la deduplicazione delle persone.

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

-- AFTER INSERT e non BEFORE: si scrive su un'altra tabella, e lo si fa solo
-- quando la richiesta è davvero entrata. Gira dopo
-- form_contatti_collega_persona (BEFORE), che è ciò che assegna
-- opportunita_id: senza quello questo trigger non avrebbe niente da leggere.
drop trigger if exists form_contatti_impegno_ripetuta on public.form_contatti;
create trigger form_contatti_impegno_ripetuta
	after insert on public.form_contatti
	for each row
	execute function public.impegno_per_richiesta_ripetuta();

comment on function public.impegno_per_richiesta_ripetuta() is
	'Crea in agenda un impegno per l''assegnatario quando arriva una richiesta su una trattativa già in gestione: il riuso della trattativa non lascia altrimenti nessun segno.';
