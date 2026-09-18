-- Business unit sopra i gruppi prodotto (vedi 2026-09-18-abbonamenti-gruppi.sql):
-- "Core" vs "Young School Tennis/Nuoto/Triathlon" ecc., le stesse categorie
-- già usate altrove nel CRM (lib/auth/sezioni.ts, gruppo "Richieste dal
-- sito") — qui servono per aggregare/filtrare i report per settore, non per
-- instradare richieste. Il macro settore si assegna al GRUPPO, non al
-- singolo prodotto: un gruppo cambia settore una volta sola, i prodotti che
-- gli appartengono lo ereditano automaticamente.

create table if not exists public.abbonamenti_macro_settori (
	id uuid primary key default gen_random_uuid(),
	nome text not null unique,
	ordine integer not null default 0,
	creato_il timestamptz not null default now()
);

alter table public.abbonamenti_gruppi
	add column if not exists macro_settore_id uuid references public.abbonamenti_macro_settori(id) on delete set null;

-- Precompilata con le categorie già in uso nel resto del CRM, così la
-- reportistica per business unit è coerente da subito — restano comunque
-- rinominabili/aggiungibili dalla pagina di gestione.
insert into public.abbonamenti_macro_settori (nome, ordine) values
	('Core', 1),
	('Young School Tennis', 2),
	('Young School Nuoto', 3),
	('Young School Triathlon', 4),
	('Summer Camp', 5),
	('Chinesis', 6),
	('Padel', 7),
	('Fitness Manager', 8)
on conflict (nome) do nothing;
