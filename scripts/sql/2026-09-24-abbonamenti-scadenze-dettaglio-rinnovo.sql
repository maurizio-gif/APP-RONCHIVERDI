-- Estende abbonamenti_scadenze (vedi 2026-09-21-abbonamenti-scadenze-30-giorni.sql)
-- con i dati del rinnovo trovato, non solo il booleano "rinnovato": serve
-- alla pagina /dashboard/abbonamenti/scadenze per mostrare quale nuovo
-- abbonamento ha rinnovato questo, con le sue date e il suo importo — prima
-- l'EXISTS diceva solo sì/no e scartava la riga che aveva effettivamente
-- trovato.
--
-- Stessa condizione di prima (stessa persona, stesso gruppo — compreso il
-- caso "entrambi non categorizzati" — data_inizio entro 30 giorni dalla
-- scadenza), ma come LEFT JOIN LATERAL invece di un EXISTS, prendendo la
-- riga con la data_inizio più vicina alla scadenza quando ce n'è più di una
-- (raro, ma un rinnovo doppio per errore non deve rompere l'ordine "una
-- riga = un abbonamento in scadenza").
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-21-abbonamenti-scadenze-30-giorni.sql.

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
	r.id is not null as rinnovato,
	r.id as rinnovo_id,
	r.abbonamento as rinnovo_abbonamento,
	r.data_inizio as rinnovo_data_inizio,
	r.data_fine as rinnovo_data_fine,
	r.totale as rinnovo_totale
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
	order by r.data_inizio asc
	limit 1
) r on true
where a.cancellato_il is null
	and a.data_fine is not null
	and a.persona_id is not null;

comment on view public.abbonamenti_scadenze is
	'Una riga per ogni vendita non cancellata con data_fine, con persona e gruppo, più il rinnovo trovato (se c''è): esiste un altro abbonamento non cancellato della stessa persona, stesso gruppo (gruppo_id compreso il caso "entrambi non categorizzati"), con data_inizio entro 30 giorni dalla scadenza di questa riga (compreso lo stesso giorno) — rinnovo_id/rinnovo_abbonamento/rinnovo_data_inizio/rinnovo_data_fine/rinnovo_totale sono quella riga (la più vicina, se più di una), null se non c''è. Filtrare per data_fine per il report di /dashboard/abbonamenti/scadenze — senza filtro scansiona tutta la tabella. Un mese recente può risultare sottostimato: se la scadenza è a meno di 30 giorni da oggi, la finestra di rinnovo non si è ancora chiusa.';

-- abbonamenti_scadenze_mensili è un `create or replace view ... select ...
-- from abbonamenti_scadenze`: eredita la nuova definizione automaticamente
-- (seleziona solo mese/gruppo_id/rinnovato/count, non tocca le colonne
-- nuove), senza bisogno di essere toccata.
