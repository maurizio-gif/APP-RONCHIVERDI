-- Gli altri dati di Info4U (dbgym) che il sync non leggeva: le azioni CRM dei
-- consulenti (pratiche, appuntamenti/preventivi/walk-in con il loro esito,
-- memo), le email inviate, i certificati medici, le prenotazioni e i corsi, le
-- quote associative, le ricevute, gli accessi ai varchi e gli omaggi. Tutto dal
-- 1 gennaio 2023, come cassa e rate.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi PRIMA di
-- lanciare la nuova versione di ops/sync-info4u/sync-abbonamenti.ps1: il
-- sync scrive in queste tabelle con PostgREST (on_conflict sulla chiave
-- source_*), quindi i nomi delle colonne qui e gli alias delle query nello
-- script devono restare gli stessi.
--
-- Escluso apposta: password e impronte degli operatori, il corpo delle email,
-- anagrafica e partita IVA del cliente sulle ricevute, il numero della tessera
-- e la descrizione libera degli accessi, UtentiAnamnesi (dati sanitari).
--
-- Un limite da sapere: `persone` nasce dalle vendite, quindi un utente
-- Info4U che non ha mai comprato nulla (un lead, un walk-in) non c'è ancora
-- fra le persone. Le righe di queste tabelle tengono comunque source_utente_id;
-- persona_id si riempie da solo quando la persona esiste, e
-- info4u_riallinea_persone() (in fondo) lo riempie a posteriori.

-- persona_id dal source_utente_id, uguale per tutte le tabelle che ce l'hanno.
create or replace function public.info4u_imposta_persona()
returns trigger
language plpgsql
as $$
begin
	if new.persona_id is null and new.source_utente_id is not null then
		select p.id into new.persona_id from public.persone p where p.source_utente_id = new.source_utente_id;
	end if;
	return new;
end;
$$;

-- ───────────────────────────────────────────── anagrafiche di decodifica
-- Piccole, riscritte per intero dal sync a ogni giro di refresh.

create table if not exists public.crm_tipi_azione (
	source_tipo_id integer primary key,
	descrizione text,
	attivo boolean,
	sincronizzato_il timestamptz not null default now()
);

create table if not exists public.crm_esiti_azione (
	source_esito_id integer primary key,
	descrizione text,
	attivo boolean,
	sincronizzato_il timestamptz not null default now()
);

create table if not exists public.crm_stati_commerciali (
	source_stato_id integer primary key,
	nome text,
	attivo boolean,
	sincronizzato_il timestamptz not null default now()
);

create table if not exists public.operatori_categorie_info4u (
	source_categoria_id integer primary key,
	descrizione text,
	sincronizzato_il timestamptz not null default now()
);

-- Solo nome e ruolo: niente login, password, email, impronte.
create table if not exists public.operatori_info4u (
	source_operatore_id integer primary key,
	nome text,
	source_categoria_id integer,
	attivo boolean,
	venditore boolean,
	istruttore boolean,
	eliminato boolean,
	sincronizzato_il timestamptz not null default now()
);

create table if not exists public.prenotazioni_catalogo (
	source_prenotazione_id integer primary key,
	source_categoria_id integer,
	descrizione text,
	attivo boolean,
	costo numeric(12,2),
	max_prenotazioni integer,
	durata_minuti integer,
	data_inizio timestamptz,
	data_fine timestamptz,
	sincronizzato_il timestamptz not null default now()
);

create table if not exists public.prenotazioni_lezioni (
	source_lezione_id integer primary key,
	source_prenotazione_id integer,
	data_inizio timestamptz,
	data_fine timestamptz,
	ora_inizio text,
	ora_fine text,
	giorni_settimana integer,
	source_istruttore_id integer,
	sincronizzato_il timestamptz not null default now()
);

create table if not exists public.esiti_accesso (
	numero_esito integer primary key,
	descrizione text,
	sincronizzato_il timestamptz not null default now()
);

-- Il terminale di un accesso è (famiglia, indirizzo, concentratore).
create table if not exists public.terminali_info4u (
	id uuid primary key default gen_random_uuid(),
	source_terminale_id integer not null,
	indirizzo integer not null,
	source_concentratore_id integer not null,
	descrizione text,
	attivo boolean,
	ingresso boolean,
	uscita boolean,
	direzione text,
	zona_nr integer,
	zona_verso text,
	sincronizzato_il timestamptz not null default now(),
	unique (source_terminale_id, indirizzo, source_concentratore_id)
);

-- ───────────────────────────────────────────────── azioni CRM consulenti

-- Una pratica commerciale (AppuntamentiCategorieUtenti): la «trattativa» di
-- una persona, con stato, valore e chiusura. Le azioni si agganciano qui.
create table if not exists public.crm_pratiche (
	id uuid primary key default gen_random_uuid(),
	source_pratica_id integer not null unique,
	source_categoria_id integer,
	descrizione text,
	source_utente_id integer,
	persona_id uuid references public.persone(id),
	data_creazione timestamptz,
	source_stato_id integer,
	data_stato timestamptz,
	data_chiusura timestamptz,
	valore double precision,
	sincronizzato_il timestamptz not null default now()
);
create index if not exists crm_pratiche_utente_idx on public.crm_pratiche (source_utente_id);
create index if not exists crm_pratiche_persona_idx on public.crm_pratiche (persona_id);
create index if not exists crm_pratiche_creazione_idx on public.crm_pratiche (data_creazione desc);

-- Un'azione (AppuntamentiStorico): preventivo, walk-in, telefonata, appuntamento,
-- ma anche le azioni generate in automatico (email di marketing, mancanza
-- frequenza, certificato in scadenza: ~90% delle righe). Chi l'ha scritta è
-- operatore_autore_id; la persona si ricava dalla pratica (source_pratica_id),
-- Info4U non la porta sull'azione. Vedi la vista crm_azioni_dettaglio.
create table if not exists public.crm_azioni (
	id uuid primary key default gen_random_uuid(),
	source_azione_id integer not null unique,
	source_pratica_id integer,
	operatore_autore_id integer,
	operatore_dest_id integer,
	data_appuntamento timestamptz,
	source_tipo_id integer,
	source_esito_id integer,
	descrizione text,
	data_evasione timestamptz,
	source_stato_id integer,
	data_presa_in_carico timestamptz,
	sincronizzato_il timestamptz not null default now()
);
create index if not exists crm_azioni_pratica_idx on public.crm_azioni (source_pratica_id);
create index if not exists crm_azioni_data_idx on public.crm_azioni (data_appuntamento desc);
create index if not exists crm_azioni_autore_idx on public.crm_azioni (operatore_autore_id, data_appuntamento desc);
create index if not exists crm_azioni_tipo_idx on public.crm_azioni (source_tipo_id, source_esito_id);

create table if not exists public.crm_memo (
	id uuid primary key default gen_random_uuid(),
	source_memo_id integer not null unique,
	source_utente_id integer,
	persona_id uuid references public.persone(id),
	operatore_id integer,
	oggetto text,
	descrizione text,
	ultima_modifica timestamptz,
	data_operazione timestamptz,
	sincronizzato_il timestamptz not null default now()
);
create index if not exists crm_memo_utente_idx on public.crm_memo (source_utente_id);

-- ────────────────────────────────────────────────────── comunicazioni

-- Le email inviate dal gestionale (senza il corpo del messaggio e senza
-- l'indirizzo del destinatario: la persona si ricava da source_utente_id).
create table if not exists public.email_inviate (
	id uuid primary key default gen_random_uuid(),
	source_email_id integer not null unique,
	source_utente_id integer,
	persona_id uuid references public.persone(id),
	operatore_id integer,
	data_creazione timestamptz,
	oggetto text,
	stato smallint,
	tipo smallint,
	data_invio timestamptz,
	errore text,
	mittente_nome text,
	sincronizzato_il timestamptz not null default now()
);
create index if not exists email_inviate_utente_idx on public.email_inviate (source_utente_id, data_creazione desc);
create index if not exists email_inviate_data_idx on public.email_inviate (data_creazione desc);

-- ──────────────────────────────────────────────────── idoneità e quote

create table if not exists public.certificati (
	id uuid primary key default gen_random_uuid(),
	source_certificato_id integer not null unique,
	source_utente_id integer,
	persona_id uuid references public.persone(id),
	descrizione text,
	data_emissione date,
	data_scadenza date,
	sincronizzato_il timestamptz not null default now()
);
create index if not exists certificati_utente_idx on public.certificati (source_utente_id, data_scadenza desc);
create index if not exists certificati_scadenza_idx on public.certificati (data_scadenza);

create table if not exists public.quote_associative (
	id uuid primary key default gen_random_uuid(),
	source_quota_id integer not null unique,
	source_utente_id integer,
	persona_id uuid references public.persone(id),
	data_inizio date,
	data_fine date,
	importo numeric(12,2),
	source_iscrizione_id integer,
	sincronizzato_il timestamptz not null default now()
);
create index if not exists quote_associative_utente_idx on public.quote_associative (source_utente_id, data_fine desc);

-- ─────────────────────────────────────────── prenotazioni, corsi, omaggi

create table if not exists public.prenotazioni_iscrizioni (
	id uuid primary key default gen_random_uuid(),
	source_piscrizione_id integer not null unique,
	source_utente_id integer,
	persona_id uuid references public.persone(id),
	source_prenotazione_id integer,
	operatore_id integer,
	operatore_nome text,
	data_inizio timestamptz,
	data_fine timestamptz,
	totale numeric(12,2),
	data_operazione timestamptz,
	source_lezione_id integer,
	origine_tipo text,
	origine_id integer,
	sincronizzato_il timestamptz not null default now()
);
create index if not exists prenotazioni_iscrizioni_utente_idx on public.prenotazioni_iscrizioni (source_utente_id, data_inizio desc);
create index if not exists prenotazioni_iscrizioni_prenotazione_idx on public.prenotazioni_iscrizioni (source_prenotazione_id, data_inizio desc);

create table if not exists public.corsi_iscrizioni (
	id uuid primary key default gen_random_uuid(),
	source_iscrizione_corso_id integer not null unique,
	source_utente_id integer,
	persona_id uuid references public.persone(id),
	source_corso_id integer,
	-- Punta alla vendita: abbonamenti.source_iscrizione_id.
	source_iscrizione_id integer,
	operatore_id integer,
	data_inizio timestamptz,
	data_fine timestamptz,
	importo numeric(12,2),
	data_operazione timestamptz,
	terminato boolean,
	nr_lezioni integer,
	posti_occupati integer,
	source_piscrizione_id integer,
	sincronizzato_il timestamptz not null default now()
);
create index if not exists corsi_iscrizioni_utente_idx on public.corsi_iscrizioni (source_utente_id, data_inizio desc);
create index if not exists corsi_iscrizioni_iscrizione_idx on public.corsi_iscrizioni (source_iscrizione_id);

create table if not exists public.omaggi_iscrizioni (
	id uuid primary key default gen_random_uuid(),
	source_omaggio_iscrizione_id integer not null unique,
	source_utente_id integer,
	persona_id uuid references public.persone(id),
	source_omaggio_id integer,
	source_iscrizione_id integer,
	data_inizio date,
	data_fine date,
	omaggi_totali integer,
	omaggi_usati integer,
	source_club_id integer,
	sincronizzato_il timestamptz not null default now()
);
create index if not exists omaggi_iscrizioni_utente_idx on public.omaggi_iscrizioni (source_utente_id, data_fine desc);

-- ───────────────────────────────────────────────────────────── ricevute

-- Solo i dati amministrativi: niente cliente, indirizzo, partita IVA, note.
create table if not exists public.ricevute (
	id uuid primary key default gen_random_uuid(),
	source_ricevuta_id integer not null unique,
	azienda_id integer,
	numero integer,
	tipo text,
	data_ricevuta date,
	annullata boolean,
	tipo_pagamento text,
	source_utente_id integer,
	persona_id uuid references public.persone(id),
	acconto boolean,
	operatore_id integer,
	bloccata boolean,
	data_saldo timestamptz,
	tipo_pagamento_saldo text,
	fe_stato smallint,
	fe_data_elaborazione timestamptz,
	fe_data_scarto_sdi timestamptz,
	rt_nr_scontrino text,
	rt_data_scontrino timestamptz,
	rt_data_annullo timestamptz,
	data_ora_ricevuta timestamptz,
	inviata_email boolean,
	sincronizzato_il timestamptz not null default now()
);
create index if not exists ricevute_utente_idx on public.ricevute (source_utente_id, data_ricevuta desc);
create index if not exists ricevute_data_idx on public.ricevute (data_ricevuta desc);

create table if not exists public.ricevute_righe (
	id uuid primary key default gen_random_uuid(),
	source_riga_id integer not null unique,
	source_ricevuta_id integer not null,
	qta double precision,
	descrizione text,
	prezzo_unitario numeric(12,2),
	iva double precision,
	-- Punta alla cassa: transazioni.source_movimento_id.
	source_movimento_id integer,
	tipo smallint,
	centro_ricavo_id integer,
	iva_descrizione text,
	sincronizzato_il timestamptz not null default now()
);
create index if not exists ricevute_righe_ricevuta_idx on public.ricevute_righe (source_ricevuta_id);
create index if not exists ricevute_righe_movimento_idx on public.ricevute_righe (source_movimento_id);

-- ─────────────────────────────────────────────────────────────── accessi

-- Gli ingressi ai varchi, da dbo.AccessiStorico (archivio, fino al 29/12/2025)
-- e dbo.Accessi (corrente): ~3,4 milioni di righe dal 2023. IDAccesso è lo
-- stesso fra le due tabelle (l'archivio è uno spostamento), quindi una sola
-- chiave. `origine` dice da quale delle due l'ultima volta è stata letta
-- ('S' storico, 'A' corrente) e serve al sync per avere un watermark per
-- ciascuna. Niente persona_id: con 3,4 milioni di righe si risolve in lettura
-- da source_utente_id.
create table if not exists public.accessi (
	source_accesso_id integer primary key,
	origine text not null,
	source_utente_id integer,
	source_terminale_id integer,
	indirizzo integer,
	source_concentratore_id integer,
	source_servizio_id integer,
	data_accesso timestamptz,
	tipo_servizio text,
	tipo_accesso integer,
	source_iscrizione_id integer,
	tipo_servizio_iscrizione text,
	source_automazione_id integer
);
create index if not exists accessi_utente_idx on public.accessi (source_utente_id, data_accesso desc);
create index if not exists accessi_data_idx on public.accessi (data_accesso desc);
create index if not exists accessi_origine_idx on public.accessi (origine, source_accesso_id desc);

-- ───────────────────────────────────────────── trigger persona_id, RLS

do $$
declare
	t text;
begin
	foreach t in array array[
		'crm_pratiche', 'crm_memo', 'email_inviate', 'certificati', 'quote_associative',
		'prenotazioni_iscrizioni', 'corsi_iscrizioni', 'omaggi_iscrizioni', 'ricevute'
	] loop
		execute format('drop trigger if exists %I on public.%I', t || '_imposta_persona', t);
		execute format(
			'create trigger %I before insert or update of source_utente_id on public.%I
			 for each row execute function public.info4u_imposta_persona()',
			t || '_imposta_persona', t);
	end loop;

	foreach t in array array[
		'crm_tipi_azione', 'crm_esiti_azione', 'crm_stati_commerciali', 'operatori_categorie_info4u',
		'operatori_info4u', 'prenotazioni_catalogo', 'prenotazioni_lezioni', 'esiti_accesso',
		'terminali_info4u', 'crm_pratiche', 'crm_azioni', 'crm_memo', 'email_inviate', 'certificati',
		'quote_associative', 'prenotazioni_iscrizioni', 'corsi_iscrizioni', 'omaggi_iscrizioni',
		'ricevute', 'ricevute_righe', 'accessi'
	] loop
		execute format('alter table public.%I enable row level security', t);
	end loop;
end;
$$;

-- Riempie persona_id dove manca ma la persona nel frattempo c'è (le persone
-- nascono dalle vendite: un lead che compra dopo ha già azioni, memo, email).
-- Da lanciare a mano dopo che `persone` si allarga; restituisce quante righe
-- ha sistemato per tabella.
create or replace function public.info4u_riallinea_persone()
returns table (tabella text, righe bigint)
language plpgsql
as $$
declare
	t text;
	n bigint;
begin
	foreach t in array array[
		'crm_pratiche', 'crm_memo', 'email_inviate', 'certificati', 'quote_associative',
		'prenotazioni_iscrizioni', 'corsi_iscrizioni', 'omaggi_iscrizioni', 'ricevute'
	] loop
		execute format(
			'update public.%I x set persona_id = p.id
			 from public.persone p
			 where x.persona_id is null and x.source_utente_id = p.source_utente_id', t);
		get diagnostics n = row_count;
		tabella := t;
		righe := n;
		return next;
	end loop;
end;
$$;

-- ───────────────────────────────────────────────────────────────── viste

-- Le azioni dei consulenti lette per intero: persona (via la pratica), tipo,
-- esito, stato e nome di chi l'ha scritta. `automatica` è vera per le azioni
-- che il gestionale genera da solo (campagne e promemoria): non sono lavoro
-- di un consulente.
create or replace view public.crm_azioni_dettaglio
with (security_invoker = true) as
select
	a.source_azione_id,
	a.data_appuntamento,
	a.data_presa_in_carico,
	a.data_evasione,
	a.source_pratica_id,
	pr.source_utente_id,
	pr.persona_id,
	p.nome as persona_nome,
	p.cognome as persona_cognome,
	a.source_tipo_id,
	t.descrizione as tipo,
	a.source_esito_id,
	e.descrizione as esito,
	a.source_stato_id,
	s.nome as stato,
	a.operatore_autore_id,
	oa.nome as autore,
	a.operatore_dest_id,
	od.nome as destinatario,
	a.descrizione,
	pr.valore as valore_pratica,
	pr.data_chiusura as pratica_chiusa_il,
	(t.descrizione ilike 'Marketing-email%'
		or t.descrizione ilike 'MANCANZA FREQUENZA%'
		or t.descrizione ilike 'CERTIFICATO MEDICO IN SCADENZA%'
		or t.descrizione ilike 'UTENTI ATTIVI CHE NON FREQUENTANO%') as automatica
from public.crm_azioni a
left join public.crm_pratiche pr on pr.source_pratica_id = a.source_pratica_id
left join public.persone p on p.id = pr.persona_id
left join public.crm_tipi_azione t on t.source_tipo_id = a.source_tipo_id
left join public.crm_esiti_azione e on e.source_esito_id = a.source_esito_id
left join public.crm_stati_commerciali s on s.source_stato_id = a.source_stato_id
left join public.operatori_info4u oa on oa.source_operatore_id = a.operatore_autore_id
left join public.operatori_info4u od on od.source_operatore_id = a.operatore_dest_id;
