-- Un lead del sito (fonte = 'form_contatti') che lo staff inserisce poi a
-- mano in Info4U è il percorso normale, non un'eccezione: prima di questa
-- migration, trova_o_crea_persona trovava quella riga per nome+cognome ma,
-- vedendo una fonte diversa da 'info4u', la lasciava intoccata — il
-- chiamante (sync-abbonamenti.ps1) creava allora una scheda separata con un
-- puntatore di conflitto, da rivedere a mano ogni volta. Per un lead che poi
-- diventa davvero cliente Info4U questo è rumore, non un vero conflitto.
--
-- Da qui in avanti: se la riga trovata è 'form_contatti' E il cellulare
-- coincide ESATTAMENTE (non solo "nessun conflitto" — uguale, non uno dei
-- due assente) col cellulare del chiamante, la riga viene reclamata: fonte
-- e source_utente_id passano al chiamante, come se fosse sempre stata sua.
-- Il cellulare esatto (non la sola disambiguazione da omonimi già usata per
-- il resto della funzione) è la soglia più alta voluta esplicitamente per
-- questo caso, che scrive sopra la fonte di una riga — non solo i campi
-- vuoti.
--
-- 'inserimento_manuale' (le uniche altre due righe non-info4u, oltre a
-- form_contatti) resta protetto come prima: potrebbe non seguire lo stesso
-- percorso lead del sito → cliente, quindi qualunque omonimo trovato lì
-- continua a finire in una scheda separata con la segnalazione di
-- conflitto, per una revisione umana.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-23-dedup-nome-cognome.sql.

create or replace function public.trova_o_crea_persona(
	p_nome text,
	p_cognome text,
	p_email text,
	p_cellulare text,
	p_fonte text default 'form_contatti',
	p_source_utente_id integer default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	v_email text := normalizza_email(p_email);
	v_norm text := normalizza_cellulare(p_cellulare);
	v_nome text := normalizza_nome_persona(p_nome);
	v_id uuid;
	v_fonte_trovata text;
	v_cellulare_norm_trovato text;
	-- Un lead del sito (form_contatti) che poi viene inserito a mano in
	-- Info4U è il percorso normale, non un'eccezione da segnalare: la
	-- stessa persona, trovata di nuovo per nome, con lo stesso cellulare
	-- (non solo "nessun conflitto" — proprio uguale), va reclamata come
	-- info4u invece di restare "non toccata" con una scheda separata e un
	-- conflitto da rivedere a mano. Un inserimento_manuale resta invece
	-- protetto come qualunque altra fonte diversa dal chiamante: potrebbe
	-- non seguire lo stesso percorso lead→cliente.
	v_reclama boolean := false;
begin
	-- Senza nome non si può deduplicare: creare una riga qui vorrebbe dire un
	-- duplicato garantito al contatto successivo.
	if v_nome is null then
		return null;
	end if;

	if p_source_utente_id is not null then
		select id into v_id from persone where source_utente_id = p_source_utente_id limit 1;
	end if;

	if v_id is null then
		v_id := trova_persona_per_nome_e_cellulare(p_nome, p_cognome, p_cellulare);
	end if;

	if v_id is null then
		insert into persone (nome, cognome, email, cellulare, cellulare_norm, fonte, storico, source_utente_id)
		values (
			nullif(btrim(coalesce(p_nome, '')), ''),
			nullif(btrim(coalesce(p_cognome, '')), ''),
			v_email,
			p_cellulare,
			v_norm,
			p_fonte,
			p_fonte = 'migrazione',
			p_source_utente_id
		)
		returning id into v_id;
		return v_id;
	end if;

	select fonte, cellulare_norm into v_fonte_trovata, v_cellulare_norm_trovato
	from persone where id = v_id;

	v_reclama := v_fonte_trovata = 'form_contatti'
		and v_cellulare_norm_trovato is not null
		and v_norm is not null
		and v_cellulare_norm_trovato = v_norm;

	update persone set
		nome = coalesce(nome, nullif(btrim(coalesce(p_nome, '')), '')),
		cognome = coalesce(cognome, nullif(btrim(coalesce(p_cognome, '')), '')),
		email = coalesce(email, v_email),
		cellulare = coalesce(cellulare, p_cellulare),
		cellulare_norm = coalesce(cellulare_norm, v_norm),
		fonte = case when v_reclama then p_fonte else coalesce(fonte, p_fonte) end,
		-- Una riga trovata per nome+cellulare ma di una fonte DIVERSA da
		-- quella del chiamante non riceve mai il source_utente_id, a meno
		-- che non la si stia reclamando (v_reclama): altrimenti la scheda
		-- separata che il chiamante crea per quell'IDUtente fallirebbe per
		-- chiave duplicata (verificato in produzione).
		source_utente_id = case
			when v_reclama then coalesce(source_utente_id, p_source_utente_id)
			when p_source_utente_id is not null and fonte is not null and fonte <> p_fonte
				then source_utente_id
			else coalesce(source_utente_id, p_source_utente_id)
		end,
		storico = case when p_fonte = 'migrazione' then storico else false end,
		aggiornato_il = now()
	where id = v_id;

	return v_id;
end;
$$;

comment on function public.trova_o_crea_persona(text, text, text, text, text, integer) is
	'Trova o crea una persona per nome+cognome (col cellulare a disambiguare gli omonimi — vedi trova_persona_per_nome_e_cellulare). p_source_utente_id, quando c''è, ha precedenza: un utente Info4U già sincronizzato è sempre la sua riga. Sui campi trovati completa solo i vuoti, mai sovrascrive — eccetto un lead form_contatti con lo stesso cellulare esatto del chiamante, che viene reclamato (fonte e source_utente_id aggiornati): è il percorso normale lead del sito → cliente Info4U, non un''eccezione da segnalare. Altre fonti (es. inserimento_manuale) restano protette: mai un source_utente_id su una riga di una fonte diversa da quella del chiamante, altrimenti la scheda separata che il chiamante crea per quell''IDUtente fallirebbe per chiave duplicata.';
