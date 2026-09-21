-- Corregge abbonamenti_attivi_al: "utenti/abbonati attivi" sono PERSONE, non
-- righe di abbonamento. Con count(*) (versione originale, vedi
-- 2026-09-21-abbonamenti-attivi.sql) una persona con due abbonamenti attivi
-- nello stesso gruppo — es. due carnet lezioni nuoto comprati in momenti
-- diversi, o un rinnovo fatto in anticipo che si sovrappone al vecchio
-- ancora non scaduto — veniva contata due volte. Qui si conta
-- count(distinct persona_id): stessa persona, stesso gruppo, un solo
-- conteggio, indipendentemente da quanti abbonamenti attivi ha in quel
-- gruppo in quel momento.
--
-- persona_id is not null in piu': una vendita senza persona agganciata
-- (biglietto anonimo, vedi il commento su persona_id nullable in
-- 2026-09-17-sync-info4u-abbonamenti.sql) non rappresenta nessuno da
-- contare come "utente attivo".
--
-- Nota: la stessa persona può comparire nel conteggio di PIÙ gruppi
-- contemporaneamente (es. abbonata sia al Tennis sia ai Corsi nuoto) — è
-- corretto così, ogni gruppo conta i suoi utenti attivi indipendentemente
-- dagli altri gruppi.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-21-abbonamenti-cancellati.sql.

create or replace function public.abbonamenti_attivi_al(p_data date default current_date)
returns table (gruppo_id uuid, numero_attivi bigint)
language sql
stable
as $$
	select
		m.gruppo_id,
		count(distinct a.persona_id) as numero_attivi
	from public.abbonamenti a
	left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
	where a.cancellato_il is null
		and a.persona_id is not null
		and a.data_inizio is not null
		and a.data_inizio <= p_data
		and (a.data_fine is null or a.data_fine >= p_data)
	group by m.gruppo_id;
$$;

comment on function public.abbonamenti_attivi_al(date) is
	'Utenti (persone distinte) attivi per gruppo in una data qualsiasi: non cancellato in origine, persona_id valorizzato, data_inizio <= p_data, e (data_fine null o >= p_data). Bloccato e disdetta non escludono dal conteggio. Conta persone, non righe: chi ha piu'' abbonamenti attivi nello stesso gruppo conta una volta sola.';
