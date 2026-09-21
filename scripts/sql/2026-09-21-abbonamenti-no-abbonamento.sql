-- Alcuni prodotti sincronizzati da Info4U non sono un vero abbonamento:
-- "VISITA MEDICA", "QUOTA ISCRIZIONE ABBONAMENTI", "Borsoni Armani Omaggio
-- (No scontrino)", "TESSERAMENTO FITP"... sono servizi, quote una tantum o
-- omaggi che finiscono comunque in `abbonamenti` (Info4U non distingue),
-- e finora sporcavano sia il conteggio degli utenti attivi (una visita
-- medica ha una data_fine come un vero abbonamento) sia il report
-- scadenze/rinnovi (falsi "da rinnovare", o peggio falsi "rinnovi" — chi
-- compra una visita medica dopo un abbonamento scaduto non lo ha rinnovato).
--
-- Il flag si imposta per PRODOTTO (abbonamenti_mappatura, la stessa tabella
-- dei gruppi, gestita da /dashboard/abbonamenti/gruppi), non per gruppo:
-- un gruppo può benissimo contenere sia veri abbonamenti sia servizi
-- accessori.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-21-abbonamenti-scadenze-30-giorni.sql.

alter table public.abbonamenti_mappatura
	add column if not exists no_abbonamento boolean not null default false;

comment on column public.abbonamenti_mappatura.no_abbonamento is
	'Il prodotto non è un vero abbonamento (servizio, quota, omaggio...): esce dal conteggio degli utenti attivi (abbonamenti_attivi_al) e dal report scadenze/rinnovi (abbonamenti_scadenze) — sia come riga propria sia come possibile "rinnovo" di un''altra vendita.';

-- ───────────────────────────────────────────────────── utenti attivi

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
		and coalesce(m.no_abbonamento, false) = false
	group by m.gruppo_id;
$$;

comment on function public.abbonamenti_attivi_al(date) is
	'Utenti (persone distinte) attivi per gruppo in una data qualsiasi: non cancellato in origine, non un prodotto segnato "no abbonamento", persona_id valorizzato, data_inizio <= p_data, e (data_fine null o >= p_data). Bloccato e disdetta non escludono dal conteggio. Conta persone, non righe: chi ha piu'' abbonamenti attivi nello stesso gruppo conta una volta sola.';

-- ────────────────────────────────────────────────────────── scadenze

create or replace view public.abbonamenti_scadenze as
select
	a.id,
	a.source_iscrizione_id,
	a.persona_id,
	a.abbonamento,
	m.gruppo_id,
	a.data_inizio,
	a.data_fine,
	a.totale,
	p.nome,
	p.cognome,
	p.email,
	p.cellulare,
	exists (
		select 1
		from public.abbonamenti r
		left join public.abbonamenti_mappatura mr on mr.prodotto = r.abbonamento
		where r.persona_id = a.persona_id
			and r.cancellato_il is null
			and r.id <> a.id
			and r.data_inizio between a.data_fine and (a.data_fine + 30)
			and mr.gruppo_id is not distinct from m.gruppo_id
			and coalesce(mr.no_abbonamento, false) = false
	) as rinnovato
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
left join public.persone p on p.id = a.persona_id
where a.cancellato_il is null
	and a.data_fine is not null
	and a.persona_id is not null
	and coalesce(m.no_abbonamento, false) = false;

comment on view public.abbonamenti_scadenze is
	'Una riga per ogni vendita non cancellata con data_fine, esclusi i prodotti segnati "no abbonamento" (vedi abbonamenti_mappatura.no_abbonamento), con persona e gruppo, più "rinnovato": esiste un altro abbonamento non cancellato (anch''esso non "no abbonamento") della stessa persona, stesso gruppo, con data_inizio entro 30 giorni dalla scadenza di questa riga. Filtrare per data_fine per il report di /dashboard/abbonamenti/scadenze — senza filtro scansiona tutta la tabella.';

-- abbonamenti_scadenze_mensili resta invariata: è un `select ... from
-- abbonamenti_scadenze`, eredita l'esclusione automaticamente.
