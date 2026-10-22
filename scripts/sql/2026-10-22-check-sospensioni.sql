-- Check sospensioni: il motivo di ogni sospensione, scritto da chi l'ha
-- inserita.
--
-- Info4U non registra perché una scadenza è stata spostata: il motivo stava
-- nelle note dell'anagrafica del socio, che il CRM non legge, e una proroga
-- per malattia, una per trasferimento e un mese regalato avevano lo stesso
-- aspetto. Ogni operatore di segreteria trova nella pagina «Check sospensioni»
-- le proroghe inserite da lui dal 1 settembre 2026 ancora senza motivo, lo
-- scrive e la riga esce dall'elenco.
--
-- Una sospensione qui è una PROROGA del registro delle azioni di Info4U
-- (abbonamenti_modifiche con proroga_giorni > 0, vedi
-- 2026-10-07-abbonamenti-modifiche.sql): una riga per modifica, non per
-- abbonamento — due sospensioni sullo stesso abbonamento hanno due motivi. Il
-- registro porta sempre l'operatore, ed è da lì che si sa a chi tocca.
--
-- Il motivo è testo libero: le categorie (medico, lavoro, ...) si decidono
-- dopo aver letto cosa scrivono gli operatori. Una nota salvata NON si
-- modifica e non si cancella (lo impedisce il trigger qui sotto): per
-- correggerla se ne aggiunge un'altra, che vale come rettifica. Lo storico
-- resta intero.
--
--   staff_users.operatore_info4u  il nome con cui l'operatore compare in
--                                 Info4U («Margherita Di Mauro»): lega le
--                                 proroghe del registro all'utente del CRM
--   sospensioni_motivi            le note, una riga per nota, mai modificate
--   check_sospensioni             le proroghe dal 1 settembre con operatore,
--                                 socio, abbonamento e l'ultima nota
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-10-07-abbonamenti-modifiche.sql.
-- Rilanciabile.

-- 1. L'operatore Info4U di ciascun utente del CRM.

alter table public.staff_users
	add column if not exists operatore_info4u text;

comment on column public.staff_users.operatore_info4u is
	'Nome dell''operatore in Info4U, come lo scrive il registro delle azioni (abbonamenti_modifiche.operatore_nome): lega le sospensioni inserite in Info4U all''utente del CRM che deve scriverne il motivo (pagina Check sospensioni).';

-- Gli stessi nomi, scritti a volte un po' diversi (Dimauro / Di Mauro): li si
-- abbina qui una volta, non per somiglianza a ogni lettura.
update public.staff_users u
set operatore_info4u = v.operatore
from (values
	('m.dimauro@ronchiverdi.it', 'Margherita Di Mauro'),
	('f.perrone@ronchiverdi.it', 'Francesca Perrone'),
	('agnoletto.sarina@gmail.com', 'Sara Agnoletto'),
	('j.catalano@ronchiverdi.it', 'Jasmine Catalano'),
	('rita.oliverio75@gmail.com', 'Rita Oliverio'),
	('c.pautasso@ronchiverdi.it', 'Chiara Pautasso'),
	('c.porcella@ronchiverdi.it', 'Carola Porcella'),
	('m.francaviglia@ronchiverdi.it', 'Mariagrazia Francaviglia')
) as v (email, operatore)
where u.email = v.email
	and u.operatore_info4u is distinct from v.operatore;

-- 2. Le note.

create table if not exists public.sospensioni_motivi (
	id uuid primary key default gen_random_uuid(),
	-- La proroga a cui si riferisce: IdLog del registro di Info4U.
	source_log_id integer not null references public.abbonamenti_modifiche (source_log_id),
	-- Ripetuto dalla proroga per leggere le note di un abbonamento senza
	-- passare dal registro (colonna Motivo della pagina Sospensioni).
	source_iscrizione_id integer,
	testo text not null check (btrim(testo) <> '' and length(testo) <= 2000),
	-- Email di staff_users: sopravvive alla persona.
	autore text not null,
	creato_il timestamptz not null default now()
);

create index if not exists sospensioni_motivi_proroga_idx
	on public.sospensioni_motivi (source_log_id, creato_il desc);
create index if not exists sospensioni_motivi_iscrizione_idx
	on public.sospensioni_motivi (source_iscrizione_id, creato_il desc);

-- Come le altre tabelle del pannello: legge e scrive solo il server.
alter table public.sospensioni_motivi enable row level security;

comment on table public.sospensioni_motivi is
	'Il motivo di ogni sospensione (proroga del registro di Info4U), scritto dalla pagina /dashboard/abbonamenti/check-sospensioni. Una riga per nota, con autore e orario. Non si modifica né si cancella: una correzione è una nota nuova (rettifica).';

-- Nessuna modifica, nessuna cancellazione: nemmeno dal server. Chi deve
-- correggere aggiunge una nota.
create or replace function public.sospensioni_motivi_immutabili()
returns trigger
language plpgsql
as $$
begin
	raise exception 'Le note sui motivi delle sospensioni non si modificano né si cancellano: aggiungi una rettifica.';
end;
$$;

drop trigger if exists sospensioni_motivi_immutabili on public.sospensioni_motivi;
create trigger sospensioni_motivi_immutabili
	before update or delete on public.sospensioni_motivi
	for each row execute function public.sospensioni_motivi_immutabili();

-- 3. Le proroghe da controllare, dal 1 settembre 2026 (giornata di Roma).

create or replace view public.check_sospensioni
with (security_invoker = true) as
select
	m.source_log_id,
	m.data_operazione,
	(m.data_operazione at time zone 'Europe/Rome')::date as giorno,
	m.operatore_nome,
	m.source_iscrizione_id,
	m.persona_id,
	p.nome as persona_nome,
	p.cognome as persona_cognome,
	a.abbonamento,
	a.variante,
	m.fine_precedente,
	m.fine_nuova,
	m.proroga_giorni,
	coalesce(n.note, 0) as note,
	coalesce(n.note, 0) > 0 as motivata,
	n.ultima_testo,
	n.ultima_autore,
	n.ultima_il
from public.abbonamenti_modifiche m
left join public.persone p on p.id = m.persona_id
left join public.abbonamenti a on a.source_iscrizione_id = m.source_iscrizione_id
left join lateral (
	select
		count(*)::integer as note,
		(array_agg(s.testo order by s.creato_il desc))[1] as ultima_testo,
		(array_agg(s.autore order by s.creato_il desc))[1] as ultima_autore,
		max(s.creato_il) as ultima_il
	from public.sospensioni_motivi s
	where s.source_log_id = m.source_log_id
) n on true
where m.interpretata
	and m.proroga_giorni > 0
	and m.data_operazione >= timestamp '2026-09-01 00:00' at time zone 'Europe/Rome'
	-- Una vendita cancellata in Info4U dopo la proroga non ha più niente da
	-- motivare.
	and a.cancellato_il is null;

comment on view public.check_sospensioni is
	'Le sospensioni (proroghe del registro di Info4U) dal 1 settembre 2026, con l''ultima nota sul motivo: motivata = almeno una nota. Pagina /dashboard/abbonamenti/check-sospensioni.';

-- 4. La sezione: a tutta la segreteria, a chi compare come operatore Info4U e
-- a chi vede già le Sospensioni (sezione Abbonamenti).

update public.staff_users
set sezioni_consentite = array_append(sezioni_consentite, 'check-sospensioni')
where (operatore_segreteria or operatore_info4u is not null or 'abbonamenti' = any (sezioni_consentite))
	and not ('check-sospensioni' = any (sezioni_consentite));

select email, operatore_info4u from public.staff_users
where 'check-sospensioni' = any (sezioni_consentite)
order by email;
