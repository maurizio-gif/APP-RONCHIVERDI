-- Piano editoriale: le richieste di post e video per la social media manager.
--
-- Ogni responsabile scrive cosa vorrebbe pubblicato (un post, un reel, un
-- video della scuola nuoto...), con una data, una descrizione e, se serve, file
-- o link. La social media manager (Giada, 10 ore a settimana) le prende in
-- carico, le sposta o le rifiuta, e aggiorna lo stato fino alla pubblicazione.
--
-- Il preavviso è di 14 giorni (lib/piano-editoriale.ts, PREAVVISO_GIORNI): una
-- richiesta con meno preavviso non viene rifiutata dal modulo ma entra come
-- «urgente», con un motivo obbligatorio, e resta una richiesta finché Giada
-- non la accetta. Chi gestisce il piano (Giada e gli amministratori) può
-- inserire direttamente una voce urgente già presa in carico.
--
--   staff_users.social_manager      chi gestisce il piano editoriale
--   piano_editoriale_voci           una riga per contenuto richiesto
--   piano_editoriale_allegati       i file allegati a una voce
--   bucket piano-editoriale-file    i file, privato, fino a 100 MB l'uno
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi. Rilanciabile.
-- Il limite di 100 MB per file vale se il piano Supabase lo consente (il
-- limite globale dei file si imposta in Storage > Settings): oltre, il
-- modulo accetta comunque un link a Drive o WeTransfer.

-- 1. Chi gestisce il piano.

alter table public.staff_users
	add column if not exists social_manager boolean not null default false;

comment on column public.staff_users.social_manager is
	'Vero per chi gestisce il piano editoriale (la social media manager): accetta, sposta e rifiuta le richieste, aggiorna lo stato. Gli amministratori (puo_invitare) hanno lo stesso diritto.';

-- !!! Da compilare: l'email di Giada, dopo averla invitata da Gestione utenti.
-- update public.staff_users set social_manager = true where email = 'INSERISCI-QUI-L-EMAIL-DI-GIADA';

-- 2. Le voci.

create table if not exists public.piano_editoriale_voci (
	id uuid primary key default gen_random_uuid(),
	-- Il giorno in cui il contenuto dovrebbe uscire.
	data_pubblicazione date not null,
	tipo text not null check (tipo in ('storia', 'post', 'carosello', 'video', 'reel', 'altro')),
	titolo text not null check (btrim(titolo) <> '' and length(titolo) <= 160),
	descrizione text not null default '' check (length(descrizione) <= 4000),
	-- Il reparto o il corso a cui si riferisce (es. «Scuola nuoto»): testo libero.
	reparto text check (reparto is null or length(reparto) <= 80),
	link text check (link is null or length(link) <= 500),
	stato text not null default 'richiesta'
		check (stato in ('richiesta', 'in_carico', 'in_lavorazione', 'da_approvare', 'pubblicato', 'rifiutata')),
	-- Richiesta con meno di 14 giorni di preavviso: serve il motivo.
	urgente boolean not null default false,
	motivo_urgenza text check (motivo_urgenza is null or length(motivo_urgenza) <= 500),
	-- Le ore di lavoro stimate (si propongono per tipo, Giada le corregge).
	ore_stimate numeric(5, 2) not null default 1 check (ore_stimate >= 0 and ore_stimate <= 40),
	-- La risposta di Giada (perché rifiutata o spostata, cosa serve ancora).
	nota_gestione text check (nota_gestione is null or length(nota_gestione) <= 1000),
	-- Email di staff_users: sopravvive alla persona.
	richiesto_da text not null,
	creato_il timestamptz not null default now(),
	aggiornato_il timestamptz not null default now()
);

create index if not exists piano_editoriale_voci_data_idx
	on public.piano_editoriale_voci (data_pubblicazione);
create index if not exists piano_editoriale_voci_richiedente_idx
	on public.piano_editoriale_voci (richiesto_da, creato_il desc);

-- Come le altre tabelle del pannello: legge e scrive solo il server.
alter table public.piano_editoriale_voci enable row level security;
revoke all on public.piano_editoriale_voci from anon, authenticated;

comment on table public.piano_editoriale_voci is
	'Le richieste di contenuti social (post, reel, video...) fatte dai responsabili alla social media manager. Pagina /dashboard/piano-editoriale.';

-- 3. Gli allegati.

create table if not exists public.piano_editoriale_allegati (
	id uuid primary key default gen_random_uuid(),
	voce_id uuid not null references public.piano_editoriale_voci (id) on delete cascade,
	-- Il percorso nel bucket: <email di chi carica>/<uuid>.<estensione>.
	percorso text not null,
	nome text not null check (length(nome) <= 200),
	tipo text,
	byte bigint,
	caricato_da text not null,
	creato_il timestamptz not null default now()
);

create index if not exists piano_editoriale_allegati_voce_idx
	on public.piano_editoriale_allegati (voce_id);

alter table public.piano_editoriale_allegati enable row level security;
revoke all on public.piano_editoriale_allegati from anon, authenticated;

-- 4. Il bucket: privato, fino a 100 MB a file, immagini, video, PDF e
-- documenti Office. I file si caricano dal browser con un URL firmato
-- rilasciato dal server (come gli allegati dei ticket).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
	'piano-editoriale-file',
	'piano-editoriale-file',
	false,
	104857600,
	array[
		'image/*',
		'video/*',
		'application/pdf',
		'application/msword',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		'application/vnd.ms-powerpoint',
		'application/vnd.openxmlformats-officedocument.presentationml.presentation',
		'text/plain'
	]
)
on conflict (id) do update
	set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- 5. La sezione: agli operatori attuali, esclusi i partner esterni (chi ha
-- solo la validazione dei voucher o la registrazione delle sessioni PT).
-- Chi la riceve vede il calendario di tutti e scrive le proprie richieste; a
-- un nuovo invitato arriva col corredo normale.

update public.staff_users
set sezioni_consentite = array_append(sezioni_consentite, 'piano-editoriale')
where not ('piano-editoriale' = any (sezioni_consentite))
	and exists (
		select 1 from unnest(sezioni_consentite) s
		where s not in ('validazione-voucher', 'personal')
	);

select email, social_manager from public.staff_users
where 'piano-editoriale' = any (sezioni_consentite)
order by email;
