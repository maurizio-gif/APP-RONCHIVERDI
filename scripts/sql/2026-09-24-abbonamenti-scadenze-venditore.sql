-- Aggiunge venditore_nome, sul modello di operatore_nome (vedi
-- 2026-09-24-abbonamenti-scadenze-operatore.sql).
--
-- A differenza dell'operatore, Info4U (dbgym.dbo.AbbonamentiIscrizione) non
-- porta da nessuna parte un nome venditore già risolto: ha solo IDVenditore,
-- un numero. Verificato sullo schema: nessuna colonna NomeVenditore esiste,
-- e non c'è una tabella Venditori separata — IDVenditore punta alla stessa
-- Operatori (chiave IDOperatore) dell'operatore, solo nel ruolo di chi ha
-- fatto la vendita.
--
-- Per questo venditore_nome si popola SOLO da qui in avanti: lo script di
-- sync (ops/sync-info4u/sync-abbonamenti.ps1) ora risolve IDVenditore contro
-- Operatori.NomeOperatore al momento della vendita e lo scrive come testo,
-- esattamente come Info4U fa già per l'operatore — così il nome resta
-- congelato a quel momento e non risente di una futura riassegnazione
-- dell'id. Le vendite già sincronizzate PRIMA di questa modifica restano con
-- venditore_nome null: non c'è alcun nome storico da recuperare per loro, e
-- risalirci oggi con un join contro Operatori (anagrafica corrente)
-- rischierebbe di mostrare la persona sbagliata, lo stesso problema già
-- escluso per operatore_id (id riassegnato nel tempo, verificato sui dati).

alter table public.abbonamenti
	add column if not exists venditore_nome text;

comment on column public.abbonamenti.venditore_nome is
	'Nome del venditore (IDVenditore), risolto e congelato dal sync al momento della vendita. Null per le vendite sincronizzate prima dell''introduzione di questa colonna: nessun nome storico recuperabile in modo affidabile, vedi commento sopra.';

-- venditore_nome è l'ultima colonna del select, non vicino a venditore_id:
-- create or replace view non permette di cambiare posizione alle colonne già
-- esistenti (vedi 2026-09-24-abbonamenti-scadenze-operatore.sql per lo
-- stesso motivo su operatore_nome).

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
	order by r.data_inizio asc
	limit 1
) r on true
where a.cancellato_il is null
	and a.data_fine is not null
	and a.persona_id is not null;

comment on view public.abbonamenti_scadenze is
	'Una riga per ogni vendita non cancellata con data_fine, con persona, gruppo, operatore e venditore (quest''ultimo solo per le vendite sincronizzate dopo l''introduzione di venditore_nome), più il rinnovo trovato (se c''è): esiste un altro abbonamento non cancellato della stessa persona, stesso gruppo (gruppo_id compreso il caso "entrambi non categorizzati"), con data_inizio entro 30 giorni dalla scadenza di questa riga (compreso lo stesso giorno) — rinnovo_id/rinnovo_abbonamento/rinnovo_data_inizio/rinnovo_data_fine/rinnovo_totale sono quella riga (la più vicina, se più di una), null se non c''è. Filtrare per data_fine per il report di /dashboard/abbonamenti/scadenze — senza filtro scansiona tutta la tabella. Un mese recente può risultare sottostimato: se la scadenza è a meno di 30 giorni da oggi, la finestra di rinnovo non si è ancora chiusa.';
