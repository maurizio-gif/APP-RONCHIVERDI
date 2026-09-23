-- Cambia la chiave di deduplicazione dell'anagrafica da email/cellulare a
-- nome + cognome, con il cellulare a disambiguare gli omonimi.
--
-- Perché: email e cellulare possono essere condivisi da due persone vere
-- (un indirizzo di famiglia, un numero di casa), e usarli come chiave univoca
-- ha fuso identità diverse in una sola scheda ogni volta che due utenti
-- Info4U diversi condividevano un recapito. Verificato sui dati: 1.422
-- schede di persone/abbonamenti risultano oggi agganciate a più di un
-- source_utente_id, e in 1.275 di questi casi (90%) i periodi di abbonamento
-- dei due utenti si sovrappongono — cioè erano soci contemporaneamente, non
-- la stessa persona ritesserata in tempi diversi.
--
-- Questa migrazione sistema SOLO la logica per le anagrafiche nuove da qui
-- in avanti: le 1.422 schede già fuse restano fuse finché non si esegue una
-- bonifica separata (vedi ops/sync-info4u/bonifica-fusioni.ps1), perché
-- Supabase ha già perso il nome originale di una delle due persone a ogni
-- sync passata — serve tornare a interrogare Info4U per ciascun
-- source_utente_id coinvolto, cosa che questo file (eseguito da SQL Editor)
-- non può fare da solo.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-22-persone-conflitto-info4u.sql.

-- ────────────────────────────────────────────── normalizzazione nome/cognome

/**
 * Nome o cognome pronti per il confronto: minuscolo, spazi esterni via,
 * spazi interni multipli ridotti a uno solo — "  Mario  ", "MARIO" e "Mario"
 * sono la stessa chiave.
 *
 * Non toglie accenti di proposito, in questa prima versione: un "è" scritto
 * "e" per errore resta un mancato match invece di un falso positivo — che
 * con nome+cognome come chiave costerebbe una fusione impropria, esattamente
 * il problema che questa migrazione risolve. Si può aggiungere in seguito
 * senza toccare chi la chiama.
 */
create or replace function public.normalizza_nome_persona(p_testo text)
returns text
language sql
immutable
as $$
	select nullif(regexp_replace(lower(btrim(coalesce(p_testo, ''))), '\s+', ' ', 'g'), '');
$$;

-- ────────────────────────────────────────────────────────────────── indici

-- Email e cellulare non sono più univoci: due persone diverse possono avere
-- davvero lo stesso indirizzo o lo stesso numero di casa. Restano utili per
-- le ricerche dirette (agenda, avviso di duplicato), solo non più unique.
drop index if exists public.persone_email_idx;
drop index if exists public.persone_cellulare_idx;

create index if not exists persone_email_lookup_idx on public.persone (email) where email is not null;
create index if not exists persone_cellulare_lookup_idx on public.persone (cellulare_norm) where cellulare_norm is not null;

-- La nuova chiave di deduplicazione.
create index if not exists persone_nome_cognome_norm_idx
	on public.persone (normalizza_nome_persona(nome), normalizza_nome_persona(cognome));

-- ─────────────────────────────────────────── deduplicazione per nome+cellulare

/**
 * L'id della persona che corrisponde a questo nome e cognome, o null se
 * nessuna riga è abbastanza sicura da riconoscere.
 *
 *  - Fra gli omonimi (uno o più), quello il cui cellulare coincide: è lui,
 *    sempre — anche se ce n'è un solo omonimo, un cellulare che coincide è
 *    la conferma migliore che si possa avere.
 *  - Nessun cellulare coincidente, ma è l'unico omonimo in anagrafica, e il
 *    cellulare non lo contraddice apertamente (manca da una delle due parti,
 *    o da entrambe): si fida del nome da solo.
 *  - Nessun cellulare coincidente e più di un omonimo (o l'unico omonimo ha
 *    un cellulare diverso, valorizzato su entrambi i lati): nessuna riga è
 *    abbastanza sicura. Meglio trattarla come persona nuova — e lasciare a
 *    uno staff il confronto — che fondere due persone con lo stesso nome.
 */
create or replace function public.trova_persona_per_nome_e_cellulare(
	p_nome text,
	p_cognome text,
	p_cellulare text
) returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
	v_nome text := normalizza_nome_persona(p_nome);
	v_cognome text := normalizza_nome_persona(p_cognome);
	v_cell text := normalizza_cellulare(p_cellulare);
	v_id uuid;
	v_omonimi int;
begin
	if v_nome is null then
		return null;
	end if;

	if v_cell is not null then
		select id into v_id
		from persone
		where normalizza_nome_persona(nome) = v_nome
			and normalizza_nome_persona(cognome) is not distinct from v_cognome
			and cellulare_norm = v_cell
		limit 1;

		if v_id is not null then
			return v_id;
		end if;
	end if;

	select count(*) into v_omonimi
	from persone
	where normalizza_nome_persona(nome) = v_nome
		and normalizza_nome_persona(cognome) is not distinct from v_cognome;

	if v_omonimi = 1 then
		select id into v_id
		from persone
		where normalizza_nome_persona(nome) = v_nome
			and normalizza_nome_persona(cognome) is not distinct from v_cognome
			and (cellulare_norm is null or v_cell is null)
		limit 1;
	end if;

	return v_id;
end;
$$;

comment on function public.trova_persona_per_nome_e_cellulare(text, text, text) is
	'Deduplicazione per nome+cognome (normalizzati), col cellulare a disambiguare gli omonimi. Null se nessuna riga è abbastanza sicura da riconoscere (persona nuova). Usata da trova_o_crea_persona.';

revoke all on function public.trova_persona_per_nome_e_cellulare(text, text, text) from public, anon, authenticated;
grant execute on function public.trova_persona_per_nome_e_cellulare(text, text, text) to service_role;

-- ────────────────────────────────────────────── trova_o_crea_persona (v2)

-- Firma diversa dalla precedente (si aggiunge p_source_utente_id): senza
-- questo drop, create or replace creerebbe un secondo overload invece di
-- sostituire quello a 5 argomenti, e i chiamanti esistenti (trigger del
-- sito, agenda, pannello) continuerebbero silenziosamente a usare la
-- versione vecchia — quella con email/cellulare come chiave.
drop function if exists public.trova_o_crea_persona(text, text, text, text, text);

/**
 * Trova la persona che corrisponde a questi dati, o la crea.
 *
 * Nuova regola di deduplicazione: nome + cognome (vedi
 * trova_persona_per_nome_e_cellulare), non più email o cellulare — email e
 * cellulare restano scritti sulla scheda, ma solo come recapiti, mai come
 * chiave di riconoscimento.
 *
 * p_source_utente_id è per la sincronizzazione Info4U: un utente già
 * sincronizzato ha già la sua riga (persone.source_utente_id è univoco), ed
 * è sempre quella — a prescindere da nome o cellulare, che nel frattempo
 * possono essere davvero cambiati. Gli altri chiamanti (form del sito,
 * agenda) lo lasciano null e passano direttamente dalla ricerca per nome.
 *
 * Sulla riga trovata si completano solo i campi vuoti, mai sovrascrivendo un
 * valore già presente: un form compilato in fretta, o un omonimo trovato per
 * nome, non deve peggiorare — o correggere alla cieca — un'anagrafica già
 * buona.
 */
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

	update persone set
		nome = coalesce(nome, nullif(btrim(coalesce(p_nome, '')), '')),
		cognome = coalesce(cognome, nullif(btrim(coalesce(p_cognome, '')), '')),
		email = coalesce(email, v_email),
		cellulare = coalesce(cellulare, p_cellulare),
		cellulare_norm = coalesce(cellulare_norm, v_norm),
		fonte = coalesce(fonte, p_fonte),
		source_utente_id = coalesce(source_utente_id, p_source_utente_id),
		storico = case when p_fonte = 'migrazione' then storico else false end,
		aggiornato_il = now()
	where id = v_id;

	return v_id;
end;
$$;

comment on function public.trova_o_crea_persona(text, text, text, text, text, integer) is
	'Trova o crea una persona per nome+cognome (col cellulare a disambiguare gli omonimi — vedi trova_persona_per_nome_e_cellulare). p_source_utente_id, quando c''è, ha precedenza: un utente Info4U già sincronizzato è sempre la sua riga. Sui campi trovati completa solo i vuoti, mai sovrascrive.';

revoke all on function public.trova_o_crea_persona(text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.trova_o_crea_persona(text, text, text, text, text, integer) to service_role;

-- ─────────────────────────────────────────────────────────── conflitto_campo

-- Con la chiave nome+cognome un "conflitto" non è più solo un indice univoco
-- violato su email/cellulare: è anche un omonimo il cui cellulare non
-- coincide (o non c'è modo di verificarlo). 'nome_cognome' copre questo
-- nuovo caso; 'email'/'cellulare' restano per le righe nate prima di questa
-- migrazione.
alter table public.persone drop constraint if exists persone_conflitto_campo_check;
alter table public.persone add constraint persone_conflitto_campo_check
	check (conflitto_campo in ('email', 'cellulare', 'nome_cognome'));

comment on column public.persone.conflitto_campo is
	'Quale corrispondenza ha causato il conflitto. ''email''/''cellulare'': riga nata prima di questa migrazione, quando la chiave era il recapito — quel campo è stato lasciato vuoto sulla riga per non violare l''indice univoco di allora. ''nome_cognome'': un omonimo il cui cellulare non coincide (o non verificabile) — qui nessun campo viene omesso, perché con la chiave nome+cognome due persone possono avere davvero lo stesso indirizzo o lo stesso numero.';
