-- L'obiettivo di fatturato del mese, ora anche per singolo gruppo prodotto
-- (Soci, Corsi, Tennis...) e non solo generale: la direzione vuole poter
-- fissare un target sia sul totale sia su una business unit — "il mese va
-- bene" e "il mese va bene per il Core ma non per i Corsi" sono due
-- controlli diversi, e finora la pagina ne sapeva fare uno solo.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-18-abbonamenti-obiettivo-mensile.sql e
-- 2026-09-18-abbonamenti-gruppi.sql.
--
-- `gruppo_id` null continua a significare "generale": aggiungendo la colonna
-- senza backfill, ogni obiettivo già impostato da prima resta quello che
-- era, il generale del suo mese.
--
-- `mese` da solo non è più la chiave: la stessa data ora compare una volta
-- per il generale e una per ogni gruppo con un obiettivo suo. Una primary
-- key non ammette colonne nullable, quindi la chiave diventa un id
-- surrogato, e sono due indici unici parziali — uno per il generale, uno per
-- gruppo — a far rispettare l'unicità che prima faceva la primary key su
-- mese da sola.

alter table public.abbonamenti_obiettivi_mensili
	add column if not exists id uuid not null default gen_random_uuid(),
	add column if not exists gruppo_id uuid references public.abbonamenti_gruppi(id) on delete cascade;

comment on column public.abbonamenti_obiettivi_mensili.gruppo_id is
	'Il gruppo prodotto a cui si riferisce questo obiettivo. NULL significa "generale" (il totale, non un gruppo). On delete cascade: un obiettivo senza il suo gruppo non vuol dire niente.';

alter table public.abbonamenti_obiettivi_mensili drop constraint if exists abbonamenti_obiettivi_mensili_pkey;
alter table public.abbonamenti_obiettivi_mensili add primary key (id);

create unique index if not exists abbonamenti_obiettivi_mensili_generale_idx
	on public.abbonamenti_obiettivi_mensili (mese)
	where gruppo_id is null;

create unique index if not exists abbonamenti_obiettivi_mensili_gruppo_idx
	on public.abbonamenti_obiettivi_mensili (mese, gruppo_id)
	where gruppo_id is not null;

create index if not exists abbonamenti_obiettivi_mensili_gruppo_id_idx
	on public.abbonamenti_obiettivi_mensili (gruppo_id);
