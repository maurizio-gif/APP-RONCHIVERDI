-- Il lead del sito e il socio Info4U con il nome scritto in due modi.
--
-- Il caso vero (15 ottobre 2026): dal sito arriva «Caterina Lux», in Info4U
-- la segreteria la iscrive come «Caterina Maria Lux». Stessa email, stesso
-- cellulare — ma la chiave di trova_o_crea_persona è nome+cognome, col
-- cellulare solo a disambiguare gli omonimi (vedi
-- 2026-09-23-dedup-nome-cognome.sql): il nome non coincide, la sync crea una
-- scheda nuova, e la vendita non trova la trattativa aperta di Carola, che
-- resta «in gestione» su una scheda senza abbonamenti. Nessun segnale da
-- nessuna parte.
--
-- Unire per email o cellulare da soli non si può: sui dati, la maggior parte
-- dei casi «stesso cognome e stesso cellulare, nome diverso» sono familiari —
-- il genitore compila il modulo, si iscrive il figlio (Pascale → Agathe
-- Jacot, Yang → Ziqi e Ziyi Li). Quindi due regole distinte:
--
-- 1. UNIONE AUTOMATICA, solo quando un nome contiene l'altro parola per
--    parola («Caterina» dentro «Caterina Maria»), cognome uguale e cellulare
--    uguale, e solo fra una scheda Info4U e una che non lo è (lead del sito,
--    Guest Register, segreteria). Fra due schede Info4U no: lì «Maria Rossi»
--    e «Anna Maria Rossi» col telefono di casa sono madre e figlia, socie
--    tutte e due, ed è proprio il caso che la chiave nome+cognome esiste per
--    non fondere. Il candidato deve essere uno solo: con due possibili non si
--    sceglie a caso.
--    La riga trovata segue poi le regole di sempre: un lead del sito con lo
--    stesso cellulare viene reclamato da Info4U (2026-09-24-trova-o-crea-
--    persona-reclama-form-contatti.sql), ogni altra fonte resta intoccata e
--    la sync ne fa una scheda separata con il puntatore di conflitto.
--
-- 2. SEGNALAZIONE, in tutti gli altri casi: una scheda NUOVA che ha lo stesso
--    cognome e lo stesso cellulare di un'altra già in anagrafica, con un nome
--    diverso, nasce con il puntatore conflitto_con_persona_id e
--    conflitto_campo = 'possibile_doppione'. La scheda dei due mostra il link
--    («Possibile doppione»), e lo staff decide: se è la stessa persona sposta
--    il lead («La richiesta è per un'altra persona?»), se sono familiari
--    chiude la segnalazione («Sono persone diverse», che azzera il
--    puntatore).
--    'possibile_doppione' non è un campo della scheda: la sync, che toglie dal
--    suo aggiornamento il campo indicato in conflitto_campo (vedi
--    sync-abbonamenti.ps1), non trova niente da togliere e aggiorna tutto come
--    sempre — come già succede per 'nome_cognome'.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-24-trova-o-crea-persona-reclama-form-contatti.sql.

alter table public.persone drop constraint if exists persone_conflitto_campo_check;
alter table public.persone add constraint persone_conflitto_campo_check
	check (conflitto_campo = any (array['email', 'cellulare', 'nome_cognome', 'possibile_doppione']));

comment on column public.persone.conflitto_campo is
	'Perché questa scheda punta a conflitto_con_persona_id. email | cellulare: campo lasciato vuoto dalla sync per un conflitto di unicità. nome_cognome: stesso nome di un contatto non Info4U, scheda tenuta separata. possibile_doppione: stesso cognome e cellulare, nome diverso — da verificare (familiare o stessa persona).';

-- Vero se le parole di un nome stanno tutte nell'altro: «caterina» e
-- «caterina maria», «maria» e «anna maria». Due nomi uguali non contano: per
-- quelli c'è già la chiave esatta.
create or replace function public.nomi_uno_dentro_altro(p_a text, p_b text)
returns boolean
language sql
immutable
as $$
	select case
		when normalizza_nome_persona(p_a) is null or normalizza_nome_persona(p_b) is null then false
		when normalizza_nome_persona(p_a) = normalizza_nome_persona(p_b) then false
		else string_to_array(normalizza_nome_persona(p_a), ' ') <@ string_to_array(normalizza_nome_persona(p_b), ' ')
			or string_to_array(normalizza_nome_persona(p_b), ' ') <@ string_to_array(normalizza_nome_persona(p_a), ' ')
	end;
$$;

comment on function public.nomi_uno_dentro_altro(text, text) is
	'Vero se tutte le parole di un nome compaiono nell''altro (Caterina / Caterina Maria). Falso per nomi uguali o vuoti.';

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
	v_cognome text := normalizza_nome_persona(p_cognome);
	v_id uuid;
	v_fonte_trovata text;
	v_cellulare_norm_trovato text;
	v_candidati uuid[];
	v_simile uuid;
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

	-- Regola 1: un nome dentro l'altro, stesso cognome e cellulare, fra una
	-- scheda Info4U e una che non lo è. Un solo candidato, o niente.
	if v_id is null and v_norm is not null and v_cognome is not null then
		select array_agg(id) into v_candidati
		from persone
		where cellulare_norm = v_norm
			and normalizza_nome_persona(cognome) = v_cognome
			and nomi_uno_dentro_altro(nome, p_nome)
			and (coalesce(fonte, '') = 'info4u') <> (coalesce(p_fonte, '') = 'info4u');
		if coalesce(array_length(v_candidati, 1), 0) = 1 then
			v_id := v_candidati[1];
		end if;
	end if;

	if v_id is null then
		-- Regola 2: prima di creare, l'altra scheda con lo stesso cognome e
		-- cellulare ma un nome diverso, se c'è. Prima quella di fonte diversa
		-- dal chiamante (il lead per il socio, il socio per il lead), poi la
		-- più recente.
		if v_norm is not null and v_cognome is not null then
			select id into v_simile
			from persone
			where cellulare_norm = v_norm
				and normalizza_nome_persona(cognome) = v_cognome
				and normalizza_nome_persona(nome) is distinct from v_nome
			order by (coalesce(fonte, '') = coalesce(p_fonte, '')), creato_il desc
			limit 1;
		end if;

		insert into persone (
			nome, cognome, email, cellulare, cellulare_norm, fonte, storico, source_utente_id,
			conflitto_con_persona_id, conflitto_campo
		)
		values (
			nullif(btrim(coalesce(p_nome, '')), ''),
			nullif(btrim(coalesce(p_cognome, '')), ''),
			v_email,
			p_cellulare,
			v_norm,
			p_fonte,
			p_fonte = 'migrazione',
			p_source_utente_id,
			v_simile,
			case when v_simile is not null then 'possibile_doppione' end
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

-- ───────────────────────────────────── le segnalazioni sulle schede esistenti
--
-- Le schede Info4U già create accanto a un lead con lo stesso cognome e
-- cellulare e un nome diverso (al 15 ottobre: i Jacot, i Li, i Mohseni
-- Khorrami, Wendy/Windy Demetri). Solo Info4U contro non-Info4U: fra due
-- schede Info4U i familiari con il telefono di casa sono migliaia, e
-- segnalarli tutti in blocco sarebbe rumore.
update public.persone i
set conflitto_con_persona_id = f.id,
	conflitto_campo = 'possibile_doppione'
from public.persone f
where i.fonte = 'info4u'
	and f.fonte is distinct from 'info4u'
	and i.conflitto_con_persona_id is null
	and i.conflitto_campo is null
	and i.cellulare_norm is not null
	and i.cellulare_norm = f.cellulare_norm
	and normalizza_nome_persona(i.cognome) = normalizza_nome_persona(f.cognome)
	and normalizza_nome_persona(i.nome) is distinct from normalizza_nome_persona(f.nome);
