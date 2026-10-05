-- La durata venduta dell'abbonamento in scadenza e del suo rinnovo, nella
-- vista delle scadenze: in Rinnovi Core il solo nome del prodotto non dice
-- se è un mensile, un quadrimestrale o un annuale — lo stesso "1.1 GOLD OVER
-- 35" esiste da 1, 3, 6 e 12 mesi — e chi richiama il socio deve saperlo.
--
-- Il dato è quello di Info4U (abbonamenti.durata + abbonamenti.periodo, la
-- durata della variante venduta: 12 + 'M' = 12 mesi; 'G' giorni; 'P' altro),
-- non la distanza fra data_inizio e data_fine: quella si allunga con
-- proroghe, omaggi e sospensioni (un annuale arriva a 395, 425, 515 giorni) e
-- farebbe leggere un "17 mesi" che nessuno ha venduto.
--
-- create or replace e colonne in coda: Postgres lo consente senza drop, e le
-- viste che dipendono da questa (abbonamenti_scadenze_mensili) non vanno
-- ricreate. Il resto della definizione è identico a
-- 2026-09-25-abbonamenti-scadenze-escluso-report.sql.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-10-05-abbonamenti-scadenze-note-storico.sql.

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
	r.totale as rinnovo_totale,
	a.operatore_nome,
	a.venditore_nome,
	l.stato_manuale,
	l.nota,
	l.motivo_non_rinnovo,
	l.note_non_rinnovo,
	l.assegnato_a,
	l.escluso_da_report,
	a.durata,
	a.periodo,
	r.durata as rinnovo_durata,
	r.periodo as rinnovo_periodo
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
left join public.persone p on p.id = a.persona_id
left join lateral (
	select r_1.id, r_1.abbonamento, r_1.data_inizio, r_1.data_fine, r_1.totale, r_1.durata, r_1.periodo
	from public.abbonamenti r_1
	left join public.abbonamenti_mappatura mr on mr.prodotto = r_1.abbonamento
	where r_1.persona_id = a.persona_id
		and r_1.cancellato_il is null
		and r_1.id <> a.id
		and r_1.data_inizio >= a.data_fine
		and r_1.data_inizio <= (a.data_fine + 30)
		and mr.gruppo_id is not distinct from m.gruppo_id
		and coalesce(mr.no_abbonamento, false) = false
	order by r_1.data_inizio
	limit 1
) r on true
left join public.abbonamenti_scadenze_lavorazione l on l.abbonamento_id = a.id
where a.cancellato_il is null
	and a.data_fine is not null
	and a.persona_id is not null
	and coalesce(m.no_abbonamento, false) = false;

comment on view public.abbonamenti_scadenze is
	'Una riga per ogni vendita non cancellata con data_fine, esclusi i prodotti "no abbonamento", con persona, gruppo, durata venduta (durata + periodo, da Info4U), rinnovo (calcolato, con la sua durata) e lavorazione manuale (stato_manuale, nota, motivo_non_rinnovo, note_non_rinnovo, assegnato_a, escluso_da_report — vedi abbonamenti_scadenze_lavorazione). Filtrare per data_fine per il report di /dashboard/abbonamenti/scadenze.';
