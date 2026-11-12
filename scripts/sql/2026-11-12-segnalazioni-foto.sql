-- Segnalazioni dei soci: le foto.
--
-- Chi registra una segnalazione, e chi la gestisce, può scattare o caricare
-- fino a cinque foto (un odore non si fotografa, ma una perdita, un vetro, un
-- armadietto rotto sì). Una foto è legata alla segnalazione e al passaggio in
-- cui è stata aggiunta (segnalazioni_eventi), così nella storia si vede cosa
-- c'era prima e cosa dopo l'intervento.
--
-- I file stanno nel bucket privato segnalazioni-foto: solo immagini (anche
-- HEIC/HEIF dell'iPhone), fino a 10 MB l'una. Si caricano dal browser con un
-- URL firmato rilasciato dal server e si leggono con un URL firmato a tempo.
--
-- RLS accesa e nessuna policy: legge e scrive solo il server.

create table if not exists public.segnalazioni_allegati (
	id uuid primary key default gen_random_uuid(),
	segnalazione_id uuid not null references public.segnalazioni(id) on delete cascade,
	evento_id uuid references public.segnalazioni_eventi(id) on delete set null,
	percorso text not null unique,
	nome text not null,
	tipo text,
	byte bigint,
	caricato_da text not null,
	creato_il timestamptz not null default now()
);

create index if not exists segnalazioni_allegati_idx on public.segnalazioni_allegati (segnalazione_id);

alter table public.segnalazioni_allegati enable row level security;
revoke all on public.segnalazioni_allegati from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('segnalazioni-foto', 'segnalazioni-foto', false, 10485760, array['image/*'])
on conflict (id) do update
	set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
