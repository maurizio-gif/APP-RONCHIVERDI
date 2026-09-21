-- Numero di abbonamenti attivi, per gruppo prodotto (Soci, Corsi, Tennis...),
-- in un dato momento — e il loro storico mensile.
--
-- A differenza delle vendite (vedi 2026-09-18-abbonamenti-gruppi.sql), qui
-- non serve nessuna nuova query su Info4U/dbgym: la sincronizzazione
-- (ops/sync-info4u/) porta già in `abbonamenti` TUTTO lo storico delle
-- vendite, con `data_inizio`/`data_fine` — "chi è attivo il 30 giugno 2026"
-- è quindi una domanda che Supabase può già rispondere da sola, anche per
-- una data passata, senza tornare sul database locale del gestionale.
--
-- Definizione di "attivo al giorno X" (decisa dalla direzione):
--   data_inizio <= X e (data_fine è null oppure data_fine >= X).
-- Un abbonamento bloccato (sospeso) conta comunque come attivo — è un socio
-- in pausa, non uno che se n'è andato. Una disdetta già registrata
-- (data_disdetta valorizzata) NON esclude dal conteggio finché data_fine non
-- è passata: la disdetta è solo la richiesta di non rinnovo, fino alla
-- scadenza il socio è comunque abbonato.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-18-abbonamenti-gruppi.sql (serve
-- abbonamenti_mappatura/abbonamenti_gruppi).

-- ──────────────────────────────────────────────── attivi in un dato momento

-- Set-returning function e non una vista: una vista non accetta parametri,
-- e qui il "momento" è per forza un parametro (oggi per il report corrente,
-- una data passata per un controllo storico). Restituisce una riga per
-- gruppo con quanti abbonamenti erano attivi in quella data; gruppo_id null
-- = prodotto non ancora categorizzato (stessa convenzione di
-- abbonamenti_giornalieri/abbonamenti_mensili), non "totale generale" — il
-- totale è la somma di tutte le righe.
create or replace function public.abbonamenti_attivi_al(p_data date default current_date)
returns table (gruppo_id uuid, numero_attivi bigint)
language sql
stable
as $$
	select
		m.gruppo_id,
		count(*) as numero_attivi
	from public.abbonamenti a
	left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
	where a.data_inizio is not null
		and a.data_inizio <= p_data
		and (a.data_fine is null or a.data_fine >= p_data)
	group by m.gruppo_id;
$$;

comment on function public.abbonamenti_attivi_al(date) is
	'Abbonamenti attivi per gruppo in una data qualsiasi (passata o odierna): data_inizio <= p_data e (data_fine null o >= p_data). Bloccato e disdetta non escludono dal conteggio (vedi commento in testa al file).';

-- Comodità per i report che vogliono "oggi" senza passare da una RPC: le
-- pagine possono leggerla con una select diretta, come le altre viste.
create or replace view public.abbonamenti_attivi_oggi as
select * from public.abbonamenti_attivi_al(current_date);

-- ───────────────────────────────────────────────────────────────── storico
--
-- Stesso schema id/gruppo_id/indici parziali di
-- abbonamenti_obiettivi_mensili (vedi 2026-09-19-obiettivo-mensile-per-gruppo.sql):
-- `mese` da solo non è la chiave, perché ogni mese ha una riga per gruppo (più
-- una eventuale riga "non categorizzato" a gruppo_id null) — serve un id
-- surrogato più due indici unici parziali, uno per il caso null e uno per
-- gruppo_id valorizzato, a far rispettare comunque l'unicità (mese, gruppo).
--
-- Perché una tabella e non solo la funzione sopra: la funzione ricalcola
-- sempre sullo stato ATTUALE di `abbonamenti` — corretto per "quanti sono
-- attivi oggi" o "quanti erano attivi il 30/6 secondo i dati di adesso", ma
-- un report direzionale di fine mese non deve muoversi retroattivamente se
-- domani qualcuno corregge o disdice una vendita di tre mesi fa. Qui si
-- congela il numero il giorno in cui viene registrato.
create table if not exists public.abbonamenti_attivi_storico (
	id uuid primary key default gen_random_uuid(),
	-- Il mese a cui si riferisce lo snapshot, primo giorno del mese (stessa
	-- convenzione di abbonamenti_mensili.mese) — il conteggio è comunque
	-- quello dell'ULTIMO giorno di quel mese, non del primo.
	mese date not null,
	gruppo_id uuid references public.abbonamenti_gruppi(id) on delete set null,
	numero_attivi integer not null,
	calcolato_il timestamptz not null default now()
);

create unique index if not exists abbonamenti_attivi_storico_non_categorizzato_idx
	on public.abbonamenti_attivi_storico (mese)
	where gruppo_id is null;

create unique index if not exists abbonamenti_attivi_storico_gruppo_idx
	on public.abbonamenti_attivi_storico (mese, gruppo_id)
	where gruppo_id is not null;

create index if not exists abbonamenti_attivi_storico_gruppo_id_idx
	on public.abbonamenti_attivi_storico (gruppo_id);

-- Calcola e registra lo snapshot per un mese (parametro: primo giorno del
-- mese). Rieseguibile senza creare doppioni — cancella e riscrive le righe
-- di quel mese — così si può anche usare per backfillare mesi passati o
-- ricalcolare uno snapshot sbagliato, non solo per la scrittura mensile
-- automatica.
create or replace function public.registra_snapshot_abbonamenti_attivi(p_mese date)
returns void
language plpgsql
as $$
declare
	v_mese date := date_trunc('month', p_mese)::date;
	v_ultimo_giorno date := (date_trunc('month', p_mese) + interval '1 month' - interval '1 day')::date;
begin
	delete from public.abbonamenti_attivi_storico where mese = v_mese;

	insert into public.abbonamenti_attivi_storico (mese, gruppo_id, numero_attivi)
	select v_mese, gruppo_id, numero_attivi
	from public.abbonamenti_attivi_al(v_ultimo_giorno);
end;
$$;

comment on function public.registra_snapshot_abbonamenti_attivi(date) is
	'Congela in abbonamenti_attivi_storico il numero di abbonamenti attivi per gruppo all''ultimo giorno del mese di p_mese (qualsiasi giorno di quel mese va bene come parametro). Idempotente: rieseguirlo per lo stesso mese sostituisce le righe invece di duplicarle.';

-- ────────────────────────────────────────────────────────────── scheduling
--
-- pg_cron invece dello script PowerShell già in ops/sync-info4u/: il dato
-- vive già interamente qui, quindi anche il "congelalo il 30" può vivere
-- qui, senza dipendere dallo scheduler Windows del server Info4U.
--
-- "L'ultimo giorno del mese" è scomodo da esprimere in un cron (28/29/30/31
-- cambia): si schedula invece all'inizio del mese successivo (1° alle 00:05,
-- comodo margine dopo mezzanotte) e si calcola lì lo snapshot del mese
-- appena chiuso — stesso identico risultato di "registralo il 30/31 sera",
-- espresso in un cron affidabile.
--
-- Sul progetto Ronchiverdi pg_cron è disponibile ma non ancora installata
-- (verificato via Supabase MCP, list_extensions): va creata una volta sola,
-- qui — crea da sé il proprio schema "cron".
create extension if not exists pg_cron;

do $$
begin
	if exists (select 1 from cron.job where jobname = 'registra-abbonamenti-attivi-mensile') then
		perform cron.unschedule('registra-abbonamenti-attivi-mensile');
	end if;
end $$;

select cron.schedule(
	'registra-abbonamenti-attivi-mensile',
	'5 0 1 * *',
	$$select public.registra_snapshot_abbonamenti_attivi((date_trunc('month', current_date) - interval '1 month')::date)$$
);

-- ──────────────────────────────────────────────────────────────── backfill
--
-- Per avere subito lo storico dei mesi passati (non solo da qui in avanti),
-- da eseguire una tantum dopo aver creato tutto quanto sopra — calcola uno
-- snapshot per ogni mese da quando esistono vendite fino al mese scorso
-- incluso (il mese corrente non è ancora chiuso, non si registra):
--
-- do $$
-- declare
-- 	v_mese date;
-- begin
-- 	for v_mese in
-- 		select generate_series(
-- 			(select date_trunc('month', min(data_vendita)) from public.abbonamenti),
-- 			date_trunc('month', current_date) - interval '1 month',
-- 			interval '1 month'
-- 		)::date
-- 	loop
-- 		perform public.registra_snapshot_abbonamenti_attivi(v_mese);
-- 	end loop;
-- end $$;
