-- Check sospensioni: i documenti che giustificano il motivo (certificato
-- medico, trasferimento di lavoro, ...), caricati insieme alla nota.
--
-- Sono dati sulla salute (art. 9 GDPR): il bucket è privato, i file non hanno
-- un indirizzo pubblico e passano solo da URL firmati rilasciati dal server.
-- L'informativa del sito (/privacy#sospensioni) dice che il documento, una
-- volta visionato, viene rimosso: a differenza delle note (immutabili, vedi
-- 2026-10-22-check-sospensioni.sql) questa tabella si può quindi cancellare
-- riga per riga. Il pulsante per rimuoverli dal CRM non c'è ancora: per ora si
-- caricano e si registrano soltanto.
--
--   sospensioni_documenti   un file per riga, legato alla nota che lo ha
--                           accompagnato (e alla proroga di Info4U)
--   bucket sospensioni-documenti   i file, privato, fino a 10 MB l'uno
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-10-22-check-sospensioni.sql.
-- Rilanciabile.

create table if not exists public.sospensioni_documenti (
	id uuid primary key default gen_random_uuid(),
	-- La nota del motivo a cui il documento è allegato: i documenti seguono la
	-- nota (motivo o rettifica) con cui sono stati caricati.
	motivo_id uuid not null references public.sospensioni_motivi (id),
	-- La proroga di Info4U, ripetuta per leggere i documenti di una pagina
	-- intera senza passare dalle note.
	source_log_id integer not null references public.abbonamenti_modifiche (source_log_id),
	-- Il percorso nel bucket: <email dell'operatore>/<uuid>.<estensione>.
	percorso text not null unique,
	nome text not null check (btrim(nome) <> '' and length(nome) <= 200),
	tipo text,
	byte integer,
	-- Email di staff_users: sopravvive alla persona.
	caricato_da text not null,
	creato_il timestamptz not null default now()
);

create index if not exists sospensioni_documenti_proroga_idx
	on public.sospensioni_documenti (source_log_id, creato_il);
create index if not exists sospensioni_documenti_motivo_idx
	on public.sospensioni_documenti (motivo_id);

-- Come le altre tabelle del pannello: legge e scrive solo il server.
alter table public.sospensioni_documenti enable row level security;
revoke all on public.sospensioni_documenti from anon, authenticated;

comment on table public.sospensioni_documenti is
	'I documenti (certificati, trasferimenti di lavoro, ...) caricati con il motivo di una sospensione dalla pagina /dashboard/abbonamenti/check-sospensioni. Dati sulla salute: una volta visionati vanno rimossi (informativa privacy del sito, #sospensioni).';

-- Il bucket: privato, fino a 10 MB a file, solo immagini (comprese quelle
-- dell'iPhone, HEIC/HEIF) e PDF. I file si caricano dal browser con un URL
-- firmato rilasciato dal server.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sospensioni-documenti', 'sospensioni-documenti', false, 10485760, array['image/*', 'application/pdf'])
on conflict (id) do update
	set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
