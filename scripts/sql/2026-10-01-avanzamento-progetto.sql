-- Avanzamento progetto: chi ha segnato fatto un passo della proposta, chi
-- l'ha riaperto, le note scritte sotto ciascun passo.
--
-- I deliverable e i passi stanno nel codice (lib/avanzamento.ts): qui solo
-- quello che le persone fanno sulla pagina /dashboard/avanzamento. Una riga
-- per gesto, mai aggiornata: lo stato di un passo è l'ultimo «fatto» o
-- «riaperto», e lo storico resta per intero.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq).

create table if not exists public.avanzamento_aggiornamenti (
	id bigint generated always as identity primary key,
	created_at timestamptz not null default now(),
	-- La chiave del passo in lib/avanzamento.ts.
	passo text not null,
	-- Email e non FK, come audit_log: la nota resta attribuita anche dopo
	-- che la persona è stata tolta da staff_users.
	email text not null,
	tipo text not null check (tipo in ('fatto', 'riaperto', 'nota')),
	testo text,
	constraint avanzamento_nota_con_testo check (tipo <> 'nota' or nullif(btrim(testo), '') is not null)
);

comment on table public.avanzamento_aggiornamenti is
	'Gesti sulla pagina Avanzamento progetto: passo segnato fatto, riaperto, o nota. I passi sono definiti in lib/avanzamento.ts (colonna passo = chiave). Solo inserimenti.';

create index if not exists avanzamento_aggiornamenti_passo_idx
	on public.avanzamento_aggiornamenti (passo, created_at);

alter table public.avanzamento_aggiornamenti enable row level security;
revoke all on public.avanzamento_aggiornamenti from anon, authenticated;

-- La sezione al gruppo di progetto.
update public.staff_users
set sezioni_consentite = array_append(sezioni_consentite, 'avanzamento')
where email in (
	'maurizio@ready2digital.it',
	'm.rolle@ronchiverdi.it',
	'l.gravante@ronchiverdi.it',
	'paola.zavattero@gmail.com',
	's.aggazio@ronchiverdi.it'
)
	and not ('avanzamento' = any (sezioni_consentite));
