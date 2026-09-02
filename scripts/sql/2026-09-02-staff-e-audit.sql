-- Fondazione del pannello Ronchiverdi: chi può entrare e cosa ha fatto.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), lo stesso su cui il sito scrive form_contatti e le
-- sessioni: le enquiries del pannello sono quei lead, senza sincronizzazioni.
--
--   staff_users → autorizzazione al pannello e permessi granulari
--   audit_log   → traccia delle azioni degli operatori
--
-- Nessuna policy RLS: scrive e legge solo il pannello con la service_role key
-- (che bypassa RLS), mai il browser con la anon key.

create table if not exists public.staff_users (
	email text primary key,
	created_at timestamptz not null default now(),
	nome text,
	cognome text,
	-- Chiavi delle sezioni visibili a questa persona (vedi lib/auth/sezioni.ts).
	-- Il Riepilogo è sempre visibile a chi è autenticato e non compare qui.
	sezioni_consentite text[] not null default '{}',
	-- "Amministratore" del pannello: può invitare e cambiare i permessi altrui.
	puo_invitare boolean not null default false,
	-- Può cancellare definitivamente un record.
	puo_cancellare boolean not null default false
);

comment on table public.staff_users is 'Persone autorizzate al pannello Ronchiverdi, con i permessi per sezione. Sostituisce una allowlist via variabile d''ambiente: aggiungere o togliere qualcuno si fa da Gestione utenti senza un redeploy.';
comment on column public.staff_users.sezioni_consentite is 'Chiavi delle sezioni visibili (vedi lib/auth/sezioni.ts). Il Riepilogo è sempre visibile e non ha una chiave.';
comment on column public.staff_users.puo_invitare is 'Amministratore: può invitare nuove persone e modificare permessi e sezioni degli altri.';

create table if not exists public.audit_log (
	id bigint generated always as identity primary key,
	created_at timestamptz not null default now(),
	-- Email dell'operatore, non un id: resta leggibile anche dopo che la
	-- persona è stata rimossa da staff_users.
	email text,
	azione text not null,
	entita text,
	entita_id text,
	dettagli jsonb
);

comment on table public.audit_log is 'Log delle azioni degli operatori nel pannello (accessi, permessi, gestione richieste). Le etichette in italiano delle azioni stanno in lib/audit.ts.';

create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);
create index if not exists audit_log_email_idx on public.audit_log (email);
create index if not exists audit_log_azione_idx on public.audit_log (azione);

alter table public.staff_users enable row level security;
alter table public.audit_log enable row level security;

-- I grant di default di Supabase darebbero comunque accesso ad anon e
-- authenticated: la RLS senza policy già blocca tutto, ma questi grant non
-- servono a nessuno e restano una superficie inutile.
revoke all on public.staff_users from anon, authenticated;
revoke all on public.audit_log from anon, authenticated;

-- Il primo amministratore va inserito a mano: senza nessuno in tabella non
-- si può entrare nel pannello, e senza puo_invitare non si può invitare
-- nessun altro. Da qui in avanti tutto si fa da Gestione utenti.
--
-- Sostituisci l'email, poi crea l'utente in Supabase Auth (Authentication →
-- Users → Add user, oppure "Invite") con la stessa email.
--
-- insert into public.staff_users (email, nome, cognome, puo_invitare, puo_cancellare, sezioni_consentite)
-- values (
--     'nome@ronchiverdi.it', 'Nome', 'Cognome', true, true,
--     array['agenda', 'enquiries', 'persone', 'visite-sito', 'timbratura', 'utenti', 'log-operatori']
-- )
-- on conflict (email) do update set puo_invitare = true, puo_cancellare = true;
