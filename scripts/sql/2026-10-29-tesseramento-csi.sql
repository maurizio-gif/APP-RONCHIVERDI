-- Tesseramento CSI automatico.
--
-- Ogni nuovo abbonamento di un prodotto che dà diritto alla tessera CSI deve
-- far partire da solo il tesseramento sul server nazionale (web service JSON,
-- "Chiamate al server nazionale di tesseramento" v. 2.3). Lo fa la edge
-- function tesseramento-csi, chiamata da pg_cron
-- (2026-10-16-automazioni-su-supabase.sql) in due giri:
--
-- - «nuovi», ogni 10 minuti: crea la riga di tesseramento per le nuove
--   vendite e la invia;
-- - «ritenta», ogni 2 ore: riprova chi non è ancora tesserato (dati
--   corretti nel frattempo, credito ricaricato, CSI raggiungibile).
--
-- Prima di ogni invio la function chiede a CSI se la persona è già
-- tesserata nella stagione (operazione I per codice fiscale): chi è già
-- tesserato dal portale si riconosce da solo e finisce fra i tesserati.
-- Nessuna email parte da qui: la segreteria legge l'esito nella pagina
-- Tesseramenti del CRM.
--
-- Cinque pezzi:
--
-- 1. `persone.luogo_nascita`: CSI lo richiede, il sync Info4U non lo porta
--    ancora (da verificare in Info4U, vedi ops/sync-info4u).
-- 2. `tesseramenti_csi_prodotti`: quali prodotti dànno la tessera e con quale
--    codice attività CSI. Vuota: la riempie chi decide (vedi in fondo).
-- 3. `tesseramenti_csi`: una riga per persona e stagione, con lo stato, i
--    dati della tessera e il motivo se non è stata emessa.
-- 4. `tesseramenti_csi_tentativi`: lo storico di ogni chiamata a CSI.
-- 5. L'interruttore in `automazioni` e i due job di pg_cron.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi, nell'ordine
-- dei blocchi; si può rieseguire senza danni. La automazione nasce SPENTA e
-- la function, finché il segreto CSI_LIVE non vale 1, chiama CSI in
-- simulazione (test = 1): nulla viene inserito né scalato dal credito.

-- ───────────────────────────────────────────────────── luogo di nascita
alter table public.persone add column if not exists luogo_nascita text;

comment on column public.persone.luogo_nascita is
	'Comune di nascita (o stato, per i nati all''estero): obbligatorio per il tesseramento CSI.';

-- ──────────────────────────────────────────── prodotti che dànno la tessera
create table if not exists public.tesseramenti_csi_prodotti (
	-- Il nome del prodotto come sta in abbonamenti.abbonamento.
	prodotto text primary key,
	-- Il codice da mandare in codiceatt1: si legge con l'operazione S di CSI
	-- (campo `codiceatt` di `attivita`).
	codice_attivita text not null check (char_length(codice_attivita) between 2 and 3),
	attivo boolean not null default true,
	aggiornato_il timestamptz not null default now()
);

comment on table public.tesseramenti_csi_prodotti is
	'Prodotti (abbonamenti.abbonamento) che generano una tessera CSI e il codice attività da usare. Solo service role.';

-- ─────────────────────────────────────────────────────────── tesseramenti
create table if not exists public.tesseramenti_csi (
	id uuid primary key default gen_random_uuid(),
	persona_id uuid not null references public.persone (id),
	-- Primo anno della stagione sportiva (2025 per il 2025/26): quello della
	-- tessera, non quello della vendita.
	stagione integer not null,
	-- La vendita che ha fatto nascere la riga.
	abbonamento_id uuid references public.abbonamenti (id) on delete set null,
	codice_attivita text,
	-- da_inviare: creata, mai tentata. tesserato: tessera emessa (o già
	-- presente su CSI). non_tesserato: tentata o bloccata, vedi `motivo`.
	-- simulato: la prova in test = 1 sarebbe andata a buon fine.
	stato text not null default 'da_inviare'
		check (stato in ('da_inviare', 'tesserato', 'non_tesserato', 'simulato')),
	-- automatico: l'ha emessa questa procedura. gia_presente: c'era già su
	-- CSI (tesserata dal portale o da un altro giro).
	origine text check (origine in ('automatico', 'gia_presente')),
	tessera text,
	quota numeric,
	rilascio date,
	scadenza date,
	tesserato_il timestamptz,
	-- Il perché non è tesserato, in chiaro, e la sua categoria.
	motivo text,
	motivo_tipo text check (motivo_tipo in ('dati_mancanti', 'csi', 'credito', 'rete', 'configurazione')),
	tentativi integer not null default 0,
	ultimo_tentativo_il timestamptz,
	creato_il timestamptz not null default now(),
	aggiornato_il timestamptz not null default now(),
	-- Una tessera per persona e stagione: è la regola di CSI (doppio
	-- tesseramento), e rende innocuo un giro che si sovrappone a un altro.
	constraint tesseramenti_csi_persona_stagione unique (persona_id, stagione)
);

create index if not exists tesseramenti_csi_stato_idx on public.tesseramenti_csi (stato, aggiornato_il desc);
create index if not exists tesseramenti_csi_abbonamento_idx on public.tesseramenti_csi (abbonamento_id);

comment on table public.tesseramenti_csi is
	'Una riga per persona e stagione: stato del tesseramento sul server nazionale CSI. Scritta dalla edge function tesseramento-csi.';

-- ───────────────────────────────────────────────────────────── tentativi
-- Ogni chiamata a CSI (I, N): la risposta intera è la prova di cosa ha detto.
-- La richiesta non contiene mai credenziali né immagini.
create table if not exists public.tesseramenti_csi_tentativi (
	id bigint generated always as identity primary key,
	tesseramento_id uuid not null references public.tesseramenti_csi (id) on delete cascade,
	creato_il timestamptz not null default now(),
	operazione text not null,
	-- true se la chiamata era una simulazione (test = 1).
	test boolean not null default false,
	esito text not null check (esito in ('OK', 'KO', 'rete')),
	errore text,
	richiesta jsonb,
	risposta jsonb
);

create index if not exists tesseramenti_csi_tentativi_idx
	on public.tesseramenti_csi_tentativi (tesseramento_id, creato_il desc);

-- Come le altre tabelle riservate al server: RLS accesa e nessuna policy, le
-- legge e scrive solo il CRM con la service role key.
alter table public.tesseramenti_csi_prodotti enable row level security;
alter table public.tesseramenti_csi enable row level security;
alter table public.tesseramenti_csi_tentativi enable row level security;

-- ───────────────────────────────────────────────────────────── interruttore
insert into public.automazioni (chiave, attiva, descrizione)
values (
	'tesseramento_csi',
	false,
	'Tesseramento automatico sul server nazionale CSI per ogni nuovo abbonamento dei prodotti configurati.'
)
on conflict (chiave) do nothing;

-- ───────────────────────────────────────────────────────────────── cron
-- A interruttore spento non parte nessuna richiesta; la function lo
-- ricontrolla comunque. Si può rieseguire: cron.schedule con lo stesso nome
-- aggiorna il job esistente.
select cron.schedule(
	'tesseramento-csi-nuovi',
	'*/10 * * * *',
	$$select public.chiama_edge_function('tesseramento-csi', '?giro=nuovi')
	   where exists (select 1 from public.automazioni where chiave = 'tesseramento_csi' and attiva)$$
);

select cron.schedule(
	'tesseramento-csi-ritenta',
	'0 */2 * * *',
	$$select public.chiama_edge_function('tesseramento-csi', '?giro=ritenta')
	   where exists (select 1 from public.automazioni where chiave = 'tesseramento_csi' and attiva)$$
);

-- ───────────────────────────────────────────────────────────── permesso
-- La pagina Tesseramenti sta in Segreteria, come Check sospensioni: la
-- ricevono chi ha già Abbonamenti o è operatore di segreteria.
update public.staff_users
set sezioni_consentite = array_append(sezioni_consentite, 'tesseramenti')
where (operatore_segreteria or 'abbonamenti' = any (sezioni_consentite))
	and not ('tesseramenti' = any (sezioni_consentite));

-- ───────────────────────────────────────────────────────────── verifica
select chiave, attiva, attiva_dal from public.automazioni where chiave = 'tesseramento_csi';
select jobname, schedule, active from cron.job where jobname like 'tesseramento-csi%' order by jobid;

-- ───────────────────────────────────── DA FARE A MANO, su via libera
--
-- 1. I prodotti che dànno la tessera, col codice attività letto
--    dall'operazione S di CSI (esempio: i codici qui sotto sono SOLO
--    ILLUSTRATIVI, vanno sostituiti):
--
--   insert into public.tesseramenti_csi_prodotti (prodotto, codice_attivita) values
--     ('1.3 SILVER OVER 35 (cer000)', 'XXX')
--   on conflict (prodotto) do update set codice_attivita = excluded.codice_attivita, aggiornato_il = now();
--
-- 2. ACCENSIONE (parte solo dalle vendite da quel momento in poi):
--
--   update public.automazioni
--      set attiva = true, attiva_dal = now(), aggiornato_il = now()
--    where chiave = 'tesseramento_csi';
--
-- 3. SPEGNIMENTO:
--
--   update public.automazioni
--      set attiva = false, aggiornato_il = now()
--    where chiave = 'tesseramento_csi';
