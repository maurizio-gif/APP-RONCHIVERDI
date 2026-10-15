-- I Flex rinnovati in automatico escono dai conteggi dei rinnovi.
--
-- Il Flex è l'abbonamento Core mensile a rinnovo automatico: Info4U scrive
-- una vendita nuova ogni mese (circa 28 giorni), e ognuna «scade» ed è
-- «rinnovata» dalla successiva. In Rinnovi Core e Scadenze ogni mese di ogni
-- Flex risultava così un rinnovo da lavorare o un rinnovato da contare: al 15
-- ottobre 2026, 545 righe Flex, di cui 459 rinnovi automatici, gonfiavano sia
-- le scadenze sia il tasso di rinnovo.
--
-- La regola, per i dati passati e per quelli futuri, calcolata nella vista e
-- non scritta riga per riga (nessuna sincronizzazione da aggiornare):
--
--  - un Flex seguito da un altro abbonamento dello stesso gruppo che parte
--    entro 30 giorni dalla sua scadenza è un rinnovo automatico: è ESCLUSO
--    dal report (escluso_automatico, ed escluso_da_report vero), come se
--    qualcuno lo avesse escluso a mano;
--  - un Flex senza niente dopo è un Flex disdetto: resta come qualunque
--    altra scadenza, da gestire.
--
-- Il successivo si cerca dall'inizio del Flex, non dalla sua fine come per il
-- «rinnovato» della vista: Info4U a volte fa partire il mese nuovo qualche
-- giorno prima che finisca il vecchio (3 casi al 15 ottobre), e quelli sono
-- rinnovi automatici esattamente come gli altri. Vale qualunque abbonamento
-- dopo, non solo un altro Flex: chi passa dal Flex a un annuale non va
-- richiamato.
--
-- abbonamenti_scadenze_mensili (il riepilogo per mese in /dashboard/abbonamenti)
-- lascia fuori le stesse righe: un mese di Flex rinnovato non è una scadenza.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-10-05-abbonamenti-scadenze-durata.sql.

-- «create or replace» e non drop: le colonne esistenti restano uguali per nome
-- e tipo (cambia solo l'espressione di escluso_da_report), quella nuova va in
-- fondo, e la vista mensile che dipende da questa non va ricreata.
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
	coalesce(l.escluso_da_report, false) or coalesce(fx.automatico, false) as escluso_da_report,
	a.durata,
	a.periodo,
	r.durata as rinnovo_durata,
	r.periodo as rinnovo_periodo,
	coalesce(fx.automatico, false) as escluso_automatico
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
		and not mr.gruppo_id is distinct from m.gruppo_id
		and coalesce(mr.no_abbonamento, false) = false
	order by r_1.data_inizio
	limit 1
) r on true
-- Il Flex rinnovato in automatico: c'è un abbonamento dello stesso gruppo che
-- parte dopo l'inizio del Flex ed entro 30 giorni dalla sua fine.
left join lateral (
	select true as automatico
	from public.abbonamenti s
	left join public.abbonamenti_mappatura ms on ms.prodotto = s.abbonamento
	where a.abbonamento ilike '%flex%'
		and s.persona_id = a.persona_id
		and s.cancellato_il is null
		and s.id <> a.id
		and s.data_inizio > a.data_inizio
		and s.data_inizio <= (a.data_fine + 30)
		and not ms.gruppo_id is distinct from m.gruppo_id
		and coalesce(ms.no_abbonamento, false) = false
	limit 1
) fx on true
left join public.abbonamenti_scadenze_lavorazione l on l.abbonamento_id = a.id
where a.cancellato_il is null
	and a.data_fine is not null
	and a.persona_id is not null
	and coalesce(m.no_abbonamento, false) = false;

comment on column public.abbonamenti_scadenze.escluso_automatico is
	'Vero per un Flex rinnovato in automatico (seguito da un abbonamento dello stesso gruppo entro 30 giorni dalla fine): escluso dai conteggi dei rinnovi senza che nessuno lo segni. Un Flex senza seguito è un Flex disdetto e resta da gestire.';

create or replace view public.abbonamenti_scadenze_mensili as
select
	date_trunc('month', data_fine::timestamp without time zone)::date as mese,
	gruppo_id,
	rinnovato,
	count(*) as numero,
	sum(coalesce(totale, 0::numeric)) as valore
from public.abbonamenti_scadenze
where not escluso_automatico
group by (date_trunc('month', data_fine::timestamp without time zone)::date), gruppo_id, rinnovato;
