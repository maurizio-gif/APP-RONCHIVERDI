-- Reportistica sulle vendite di abbonamenti (tabella `abbonamenti`, alimentata
-- dalla sincronizzazione Info4U — vedi ops/sync-info4u/). Info4U porta oltre
-- 60 nomi di prodotto distinti (es. "1.1 GOLD OVER 35", "CARNET LEZIONI
-- NUOTO...", "TENNIS ORE VOLANTI...") senza nessuna categoria a monte: il
-- raggruppamento in "gruppi" (es. Soci, Corsi, Tennis...) è una scelta
-- commerciale di Ronchiverdi, non un dato del gestionale — vive quindi qui,
-- editabile dal CRM (vedi /dashboard/abbonamenti/gruppi), non in Info4U.
--
-- Da eseguire nel SQL Editor di Supabase prima del deploy.

-- ────────────────────────────────────────────────────────────── gruppi

create table if not exists public.abbonamenti_gruppi (
	id uuid primary key default gen_random_uuid(),
	nome text not null unique,
	-- Ordine di visualizzazione nelle tabelle di report: scelto a mano
	-- (non alfabetico), es. per tenere insieme le fasce Gold/Silver/Gym.
	ordine integer not null default 0,
	creato_il timestamptz not null default now()
);

-- ────────────────────────────────────────────────────── mappatura prodotto

create table if not exists public.abbonamenti_mappatura (
	id uuid primary key default gen_random_uuid(),
	-- Il nome esatto così come arriva da Info4U (colonna `abbonamenti.abbonamento`).
	-- Un prodotto nuovo mai visto prima compare "non categorizzato" nei report
	-- finché qualcuno non gli assegna un gruppo dalla pagina di gestione.
	prodotto text not null unique,
	gruppo_id uuid references public.abbonamenti_gruppi(id) on delete set null,
	aggiornato_il timestamptz not null default now()
);

create index if not exists abbonamenti_mappatura_gruppo_id_idx on public.abbonamenti_mappatura (gruppo_id);

-- ────────────────────────────────────────────────────────────────── viste
--
-- Tre viste aggregate invece di far leggere `abbonamenti` riga per riga alle
-- pagine di report: la tabella ha oltre 190.000 righe (e cresce di continuo),
-- e il client Supabase tronca comunque una select diretta a 1000 righe. Le
-- viste aggregano lato database — poche decine/centinaia di righe da
-- leggere — e il join con `abbonamenti_mappatura` fa sì che ricategorizzare
-- un prodotto aggiorni all'istante anche lo storico dei report, senza dover
-- ricalcolare o rimigrare nulla.

-- Un prodotto per riga, con quanto è stato venduto in tutto: la pagina di
-- gestione gruppi la usa per elencare cosa c'è da categorizzare.
create or replace view public.abbonamenti_prodotti as
select
	a.abbonamento as prodotto,
	count(*) as numero_vendite,
	max(a.data_vendita) as ultima_vendita
from public.abbonamenti a
where a.abbonamento is not null
group by a.abbonamento;

-- Una riga per (giorno, gruppo): il report giornaliero.
create or replace view public.abbonamenti_giornalieri as
select
	a.data_vendita::date as giorno,
	m.gruppo_id,
	count(*) as numero_vendite,
	sum(a.totale) as fatturato
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
where a.data_vendita is not null
group by a.data_vendita::date, m.gruppo_id;

-- Una riga per (mese, gruppo): l'andamento mensile — MTD è semplicemente il
-- mese in corso letto qui (parziale, aggiornato a oggi), YTD/confronto fra
-- anni è la stessa vista filtrata su più mesi/anni.
create or replace view public.abbonamenti_mensili as
select
	date_trunc('month', a.data_vendita)::date as mese,
	m.gruppo_id,
	count(*) as numero_vendite,
	sum(a.totale) as fatturato
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
where a.data_vendita is not null
group by date_trunc('month', a.data_vendita)::date, m.gruppo_id;
