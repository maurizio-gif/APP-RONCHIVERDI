-- Le note di gestione di un rinnovo diventano uno storico: ogni nota inviata
-- dalla tabella Rinnovi Core / Scadenze è una riga a sé, con chi l'ha scritta
-- e quando — lo stesso modello delle note sulle disdette di Athlon. Prima la
-- nota era un unico campo (abbonamenti_scadenze_lavorazione.nota) che ogni
-- salvataggio sovrascriveva: chi richiamava un socio non sapeva cosa si era
-- detto la volta prima, né chi l'aveva detto.
--
-- abbonamenti_scadenze_lavorazione.nota resta e continua a essere scritta con
-- il testo dell'ultima nota inviata (vedi aggiungiNotaScadenza in
-- app/dashboard/abbonamenti/scadenze/actions.ts): la vista
-- abbonamenti_scadenze la espone già, e chi la legge come "ultima nota" non
-- deve cambiare niente.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-25-abbonamenti-scadenze-escluso-report.sql.

create table if not exists public.abbonamenti_scadenze_note (
	id uuid primary key default gen_random_uuid(),
	abbonamento_id uuid not null references public.abbonamenti(id) on delete cascade,
	testo text not null check (btrim(testo) <> ''),
	-- Email di staff_users, come aggiornato_da: sopravvive alla persona. null
	-- solo per le note importate qui sotto, scritte prima dello storico.
	autore text,
	creato_il timestamptz not null default now()
);

create index if not exists abbonamenti_scadenze_note_abbonamento_idx
	on public.abbonamenti_scadenze_note (abbonamento_id, creato_il desc);

-- Come le altre tabelle del pannello: si scrive e si legge solo dal server
-- con la service role, nessun accesso diretto dal browser.
alter table public.abbonamenti_scadenze_note enable row level security;

comment on table public.abbonamenti_scadenze_note is
	'Storico delle note di gestione di un abbonamento in scadenza: una riga per nota inviata dalla tabella /dashboard/abbonamenti/rinnovi (o /scadenze), con autore (email staff) e orario. Non si modificano: una nota nuova è una riga nuova.';

-- Le note già scritte nel campo unico diventano la prima voce dello storico.
-- Senza autore: aggiornato_da/aggiornato_il dicono chi ha toccato per ultimo
-- *qualunque* campo della riga (stato, assegnatario…), non chi ha scritto la
-- nota, e attribuirla a lui sarebbe un dato che mente. L'orario è quello
-- dell'ultima modifica della riga, l'unico che si ha: il pannello le mostra
-- come "Prima dello storico". Il not exists rende lo script rieseguibile.
insert into public.abbonamenti_scadenze_note (abbonamento_id, testo, autore, creato_il)
select l.abbonamento_id, btrim(l.nota), null, l.aggiornato_il
from public.abbonamenti_scadenze_lavorazione l
where l.nota is not null
	and btrim(l.nota) <> ''
	and not exists (
		select 1 from public.abbonamenti_scadenze_note n where n.abbonamento_id = l.abbonamento_id
	);
