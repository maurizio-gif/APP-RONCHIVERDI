-- Timbra cartellino: entrate e uscite dei dipendenti.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-02-staff-e-audit.sql.
--
-- Valgono solo le timbrature rilevate dentro la zona del club (Corso
-- Moncalieri 466: centro e raggio in lib/timbratura.ts). I tentativi fuori
-- zona NON finiscono qui: restano solo in audit_log, azione
-- "timbratura_rifiutata", così il cartellino contiene solo timbri validi ma
-- il tentativo resta comunque tracciato.

create table if not exists public.timbrature (
	id bigint generated always as identity primary key,
	created_at timestamptz not null default now(),
	email text not null,
	tipo text not null check (tipo in ('entrata', 'uscita')),
	-- Posizione al momento del timbro: serve a poter ricontrollare un turno
	-- contestato. La distanza è già calcolata lato server, così una verifica
	-- non deve rifare la formula.
	lat double precision,
	lng double precision,
	distanza_metri numeric
);

comment on table public.timbrature is 'Timbrature entrata/uscita dei dipendenti, valide solo se rilevate nella zona del club (Corso Moncalieri 466, Torino). I tentativi fuori zona non vengono salvati qui: restano solo in audit_log, azione "timbratura_rifiutata".';
comment on column public.timbrature.distanza_metri is 'Distanza in metri dal centro della zona al momento del timbro, calcolata lato server (lib/timbratura.ts).';

create index if not exists timbrature_email_created_idx on public.timbrature (email, created_at desc);
create index if not exists timbrature_created_at_idx on public.timbrature (created_at desc);

alter table public.timbrature enable row level security;
revoke all on public.timbrature from anon, authenticated;
