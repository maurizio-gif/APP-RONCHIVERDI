-- Ticket di assistenza a due livelli.
--
-- Chiunque usi il CRM apre un ticket (pulsante «Assistenza», sempre a
-- portata): sceglie la sezione fra quelle a cui ha accesso, descrive il
-- problema, allega immagini o PDF. Il ticket va al primo livello (Simone),
-- che lo analizza con note interne storicizzate, risponde a chi l'ha aperto
-- o lo passa al secondo livello (Maurizio). Chi riceve una risposta la trova
-- in evidenza nel CRM finché non conferma la lettura chiudendo il ticket o
-- rispondendo. Il secondo livello vede tutto il flusso, anche i ticket che
-- non gli sono stati passati.
--
--   ticket              una riga per ticket: chi, cosa, dove, stato, a chi tocca
--   ticket_eventi       la storia: apertura, note interne, risposte, repliche,
--                       passaggi di livello, presa visione, chiusura
--   ticket_allegati     i file, nel bucket privato ticket-allegati
--   ticket_da_leggere   chi ha qualcosa da leggere su quale ticket: è il
--                       segnale che lampeggia nel CRM, finché non si legge
--   ticket_gestori      chi gestisce e a che livello (modificabile qui, senza
--                       toccare il codice)
--
-- Tutto con RLS accesa e nessuna policy: legge e scrive solo il server.

create table if not exists public.ticket_gestori (
	email text primary key,
	livello smallint not null check (livello in (1, 2)),
	attivo boolean not null default true
);

insert into public.ticket_gestori (email, livello) values
	('s.aggazio@ronchiverdi.it', 1),
	('maurizio@ready2digital.it', 2)
on conflict (email) do nothing;

create table if not exists public.ticket (
	id uuid primary key default gen_random_uuid(),
	-- Il numero da dire a voce: «il ticket 12».
	numero integer generated always as identity unique,
	aperto_il timestamptz not null default now(),
	aperto_da text not null,
	-- La sezione del CRM di cui parla, fra quelle che chi apre può vedere;
	-- null = «in generale».
	sezione text,
	titolo text not null,
	descrizione text not null,
	-- aperto: tocca a chi gestisce; risposto: tocca a chi l'ha aperto;
	-- chiuso: finito.
	stato text not null default 'aperto',
	-- 1 = Simone, 2 = Maurizio. Sale con il passaggio di livello.
	livello smallint not null default 1,
	-- Il gestore di turno.
	assegnato_a text not null,
	aggiornato_il timestamptz not null default now(),
	chiuso_il timestamptz,
	chiuso_da text,
	constraint ticket_stato_check check (stato in ('aperto', 'risposto', 'chiuso')),
	constraint ticket_livello_check check (livello in (1, 2))
);

create index if not exists ticket_aperto_da_idx on public.ticket (aperto_da, aggiornato_il desc);
create index if not exists ticket_stato_idx on public.ticket (stato, aggiornato_il desc);

create table if not exists public.ticket_eventi (
	id uuid primary key default gen_random_uuid(),
	ticket_id uuid not null references public.ticket(id) on delete cascade,
	creato_il timestamptz not null default now(),
	autore text not null,
	tipo text not null,
	testo text,
	-- Se lo vede anche chi ha aperto il ticket. Le note interne e i passaggi
	-- di livello no.
	pubblico boolean not null default false,
	constraint ticket_eventi_tipo_check check (tipo in (
		'apertura', 'nota', 'risposta', 'replica', 'escalation', 'rimando', 'presa_visione', 'chiusura', 'riapertura'
	))
);

create index if not exists ticket_eventi_ticket_idx on public.ticket_eventi (ticket_id, creato_il);

create table if not exists public.ticket_allegati (
	id uuid primary key default gen_random_uuid(),
	ticket_id uuid not null references public.ticket(id) on delete cascade,
	evento_id uuid references public.ticket_eventi(id) on delete set null,
	percorso text not null unique,
	nome text not null,
	tipo text,
	byte bigint,
	caricato_da text not null,
	creato_il timestamptz not null default now()
);

create index if not exists ticket_allegati_ticket_idx on public.ticket_allegati (ticket_id);

create table if not exists public.ticket_da_leggere (
	ticket_id uuid not null references public.ticket(id) on delete cascade,
	email text not null,
	motivo text not null,
	dal timestamptz not null default now(),
	primary key (ticket_id, email)
);

create index if not exists ticket_da_leggere_email_idx on public.ticket_da_leggere (email);

alter table public.ticket_gestori enable row level security;
alter table public.ticket enable row level security;
alter table public.ticket_eventi enable row level security;
alter table public.ticket_allegati enable row level security;
alter table public.ticket_da_leggere enable row level security;
revoke all on public.ticket_gestori, public.ticket, public.ticket_eventi, public.ticket_allegati, public.ticket_da_leggere
	from anon, authenticated;

-- Il bucket degli allegati: privato, fino a 10 MB a file, solo immagini
-- (comprese quelle dell'iPhone, HEIC/HEIF) e PDF. I file si caricano dal
-- browser con un URL firmato e si leggono con un URL firmato a tempo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-allegati', 'ticket-allegati', false, 10485760, array['image/*', 'application/pdf'])
on conflict (id) do update
	set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- La sezione «Ticket» nel menu: per chi gestisce. Tutti gli altri arrivano
-- ai propri ticket dal pulsante «Assistenza».
update public.staff_users
set sezioni_consentite = array_append(sezioni_consentite, 'ticket')
where email in (select email from public.ticket_gestori)
	and not ('ticket' = any (sezioni_consentite));
