-- Bugfix: 2026-09-24-abbonamenti-scadenze-dettaglio-rinnovo.sql (poi
-- ricostruita da -operatore.sql e -venditore.sql) è stata scritta sopra
-- 2026-09-21-abbonamenti-scadenze-30-giorni.sql invece che sopra
-- 2026-09-21-abbonamenti-no-abbonamento.sql: il filtro
-- "coalesce(m.no_abbonamento, false) = false" introdotto da quest'ultima è
-- sparito silenziosamente, sia dalla riga principale sia dal LEFT JOIN
-- LATERAL usato per trovare il rinnovo. Da quel momento il report
-- /dashboard/abbonamenti/scadenze è tornato a includere QUOTA ISCRIZIONE
-- ABBONAMENTI, VISITA MEDICA, TESSERAMENTO FITP, i prodotti STAFF ecc. come
-- fossero abbonamenti veri in scadenza — verificato confrontando
-- pg_get_viewdef() della vista live con questo file.
--
-- abbonamenti_vendite_tipo (2026-09-22-abbonamenti-vendite-tipo.sql) non ha
-- mai avuto il filtro: stesso problema, mai corretto.
--
-- Nota a parte, non un bug: "310. RONCHIVERDI STAFF FAMILY" è un prodotto
-- STAFF senza alcuna riga in abbonamenti_mappatura (probabile rinomina non
-- ancora ricategorizzata da /dashboard/abbonamenti/gruppi) — tutti gli altri
-- prodotti STAFF risultavano già no_abbonamento = true. La marchiamo qui
-- invece di aspettare un intervento manuale.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-24-abbonamenti-scadenze-venditore.sql.

insert into public.abbonamenti_mappatura (prodotto, no_abbonamento)
values ('310. RONCHIVERDI STAFF FAMILY', true)
on conflict (prodotto) do update set no_abbonamento = true;

-- ────────────────────────────────────────────────────────── scadenze

create or replace view public.abbonamenti_scadenze as
select
	a.id, a.source_iscrizione_id, a.persona_id, a.abbonamento, m.gruppo_id,
	a.data_inizio, a.data_fine, a.totale,
	p.nome, p.cognome, p.email, p.cellulare,
	r.id is not null as rinnovato,
	r.id as rinnovo_id, r.abbonamento as rinnovo_abbonamento,
	r.data_inizio as rinnovo_data_inizio, r.data_fine as rinnovo_data_fine,
	r.totale as rinnovo_totale,
	a.operatore_nome,
	a.venditore_nome
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
left join public.persone p on p.id = a.persona_id
left join lateral (
	select r.id, r.abbonamento, r.data_inizio, r.data_fine, r.totale
	from public.abbonamenti r
	left join public.abbonamenti_mappatura mr on mr.prodotto = r.abbonamento
	where r.persona_id = a.persona_id
		and r.cancellato_il is null
		and r.id <> a.id
		and r.data_inizio between a.data_fine and (a.data_fine + 30)
		and mr.gruppo_id is not distinct from m.gruppo_id
		and coalesce(mr.no_abbonamento, false) = false
	order by r.data_inizio asc
	limit 1
) r on true
where a.cancellato_il is null
	and a.data_fine is not null
	and a.persona_id is not null
	and coalesce(m.no_abbonamento, false) = false;

comment on view public.abbonamenti_scadenze is
	'Una riga per ogni vendita non cancellata con data_fine, esclusi i prodotti segnati "no abbonamento" (vedi abbonamenti_mappatura.no_abbonamento — include tutti i prodotti STAFF, QUOTA ISCRIZIONE, VISITA MEDICA, TESSERAMENTO FITP...), con persona, gruppo, operatore e venditore (quest''ultimo solo per le vendite sincronizzate dopo l''introduzione di venditore_nome), più il rinnovo trovato (se c''è, anch''esso escluso se "no abbonamento"): esiste un altro abbonamento non cancellato della stessa persona, stesso gruppo (gruppo_id compreso il caso "entrambi non categorizzati"), con data_inizio entro 30 giorni dalla scadenza di questa riga (compreso lo stesso giorno) — rinnovo_id/rinnovo_abbonamento/rinnovo_data_inizio/rinnovo_data_fine/rinnovo_totale sono quella riga (la più vicina, se più di una), null se non c''è. Filtrare per data_fine per il report di /dashboard/abbonamenti/scadenze — senza filtro scansiona tutta la tabella. Un mese recente può risultare sottostimato: se la scadenza è a meno di 30 giorni da oggi, la finestra di rinnovo non si è ancora chiusa.';

-- abbonamenti_scadenze_mensili è un `create or replace view ... select ...
-- from abbonamenti_scadenze`: eredita l'esclusione automaticamente.

-- ────────────────────────────────────────────────── vendite (nuovo/rinnovo)

create or replace view public.abbonamenti_vendite_tipo as
select
	a.id,
	a.data_vendita::date as giorno,
	m.gruppo_id,
	a.totale,
	exists (
		select 1
		from public.abbonamenti r
		left join public.abbonamenti_mappatura mr on mr.prodotto = r.abbonamento
		where r.persona_id = a.persona_id
			and r.cancellato_il is null
			and r.id <> a.id
			and r.data_fine between (a.data_inizio - 30) and a.data_inizio
			and mr.gruppo_id is not distinct from m.gruppo_id
			and coalesce(mr.no_abbonamento, false) = false
	) as rinnovo
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
where a.cancellato_il is null
	and a.data_vendita is not null
	and a.persona_id is not null
	and coalesce(m.no_abbonamento, false) = false;

comment on view public.abbonamenti_vendite_tipo is
	'Una riga per ogni vendita non cancellata, esclusi i prodotti "no abbonamento", con "rinnovo": esiste un altro abbonamento non cancellato (anch''esso non "no abbonamento") della stessa persona, stesso gruppo (gruppo_id compreso il caso "entrambi non categorizzati"), con data_fine entro 30 giorni prima della data_inizio di questa riga (compreso lo stesso giorno) — stessa finestra di abbonamenti_scadenze, letta dal verso opposto. Usata per distinguere vendite nuove da rinnovi nella tabella "confronto a parità di giorni" di /dashboard/abbonamenti.';

-- abbonamenti_giornalieri_tipo resta invariata: è un `select ... from
-- abbonamenti_vendite_tipo`, eredita l'esclusione automaticamente.
