-- RLS su tutte le tabelle, viste chiuse ad anon e authenticated.
--
-- Il pannello legge e scrive solo lato server con la service role key
-- (lib/supabase/serviceClient.ts), che bypassa RLS; la sincronizzazione
-- Info4U (ops/sync-info4u) usa la stessa chiave. La anon key — pubblica, sta
-- nel bundle del browser — serve solo per Supabase Auth. Il modello del
-- progetto è quindi "RLS attiva e nessuna policy": per anon e authenticated
-- le tabelle sono vuote.
--
-- Al 15 ottobre 2026 nove tabelle erano state create senza RLS, e i grant di
-- default di Supabase le lasciavano leggere, modificare e cancellare a
-- chiunque avesse la anon key, via /rest/v1. Stesso discorso per le viste
-- senza security_invoker: girano coi permessi del proprietario, quindi
-- l'RLS delle tabelle sotto non le ferma — per esempio abbonamenti_scadenze
-- e persone_primo_canale esponevano nomi e scadenze.
--
-- Niente cambia per il pannello né per la sync: la service role mantiene
-- tutti i suoi grant e non è soggetta a RLS.

-- ── 1. Le nove tabelle senza RLS ─────────────────────────────────────────

alter table public.abbonamenti enable row level security;
alter table public.abbonamenti_attivi_storico enable row level security;
alter table public.abbonamenti_gruppi enable row level security;
alter table public.abbonamenti_macro_settori enable row level security;
alter table public.abbonamenti_mappatura enable row level security;
alter table public.abbonamenti_obiettivi_mensili enable row level security;
alter table public.abbonamenti_scadenze_lavorazione enable row level security;
alter table public.obiettivi_giornalieri enable row level security;
alter table public.sync_info4u_stato enable row level security;

-- ── 2. Viste: nessun accesso per anon e authenticated ────────────────────
--
-- Tutte quelle dello schema public, anche le security_invoker (già filtrate
-- dall'RLS delle tabelle): nessun ruolo pubblico deve passare di qui.

do $$
declare
	v record;
begin
	for v in
		select c.relname
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		where n.nspname = 'public' and c.relkind in ('v', 'm')
	loop
		execute format('revoke all on public.%I from anon, authenticated', v.relname);
	end loop;
end
$$;

-- ── 3. Le tabelle e viste future nascono chiuse ──────────────────────────
--
-- Senza questo, ogni create table/view fatto da postgres riceve di nuovo i
-- grant per anon e authenticated, e basta dimenticare l'RLS una volta.

alter default privileges for role postgres in schema public
	revoke all on tables from anon, authenticated;
