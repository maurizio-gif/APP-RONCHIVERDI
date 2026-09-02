-- Agenda: appuntamenti e cose da fare della segreteria.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-02-staff-e-audit.sql.
--
-- L'agenda è UNA sola e ha due sorgenti:
--   task           → quello che la segreteria si fissa da sé (questa tabella)
--   form_contatti  → gli appuntamenti che il cliente prenota dal sito, dove
--                    azione/data_scelta/ora_scelta li scrive lui compilando
--                    il form
--
-- Tenerle unite è il punto: un appuntamento fissato dalla segreteria e uno
-- prenotato dal sito occupano lo stesso calendario, quindi /api/disponibilita
-- deve togliere dagli slot offerti sul sito entrambe le cose.

create table if not exists public.task (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),

	titolo text not null,
	tipo text not null default 'task'
		check (tipo in ('appuntamento_in_sede', 'appuntamento_telefonico', 'task', 'email', 'whatsapp')),
	note text,

	-- Data sempre presente, ora facoltativa: una voce senza ora vale "entro
	-- quel giorno" e non occupa uno slot.
	data date not null,
	ora time,
	durata_minuti integer not null default 10 check (durata_minuti > 0 and durata_minuti <= 480),

	assegnato_a text,
	creato_da text,

	stato text not null default 'aperto' check (stato in ('aperto', 'completato', 'annullato')),
	completato_il timestamptz,
	esito text,

	-- Collegamento facoltativo a ciò da cui la voce nasce, senza chiave
	-- esterna: l'entità può essere una richiesta dal sito (form_contatti) e
	-- non vogliamo che cancellare un lead porti via lo storico dell'agenda.
	entita text,
	entita_id text
);

comment on table public.task is 'Agenda della segreteria: appuntamenti e cose da fare. Insieme agli appuntamenti prenotati dal sito (form_contatti.azione/data_scelta/ora_scelta) forma un unico calendario — vedi lib/agenda.ts e /api/disponibilita.';
comment on column public.task.ora is 'Facoltativa: senza ora la voce vale "entro quel giorno" e non occupa uno slot in /api/disponibilita.';
comment on column public.task.durata_minuti is 'Minuti occupati in agenda. Non è estetica: è il dato con cui /api/disponibilita toglie gli slot offerti dal sito.';
comment on column public.task.entita is 'Da dove nasce la voce, es. "form_contatti". Nessuna chiave esterna: cancellare un lead non deve portare via lo storico dell''agenda.';

create index if not exists task_data_idx on public.task (data);
create index if not exists task_assegnato_idx on public.task (assegnato_a, data);
create index if not exists task_stato_idx on public.task (stato) where stato = 'aperto';
create index if not exists task_entita_idx on public.task (entita, entita_id);

alter table public.task enable row level security;
revoke all on public.task from anon, authenticated;
