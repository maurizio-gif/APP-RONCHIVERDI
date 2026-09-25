-- Lo stato manuale di un rinnovo diventa a tre valori — vuoto, "in
-- trattativa" o "perso" — non più un flag booleano "in trattativa" sì/no.
-- "Perso" prima non esisteva come dato: si vedeva solo nella nota libera.
-- Un rinnovo vero (calcolato dalla vista, esiste un nuovo abbonamento) non
-- passa da qui — vedi impostaStatoManuale in scadenze/actions.ts.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-25-abbonamenti-scadenze-assegnatario.sql.

alter table public.abbonamenti_scadenze_lavorazione
	add column if not exists stato_manuale text;

alter table public.abbonamenti_scadenze_lavorazione
	drop constraint if exists abbonamenti_scadenze_lavorazione_stato_manuale_check;

alter table public.abbonamenti_scadenze_lavorazione
	add constraint abbonamenti_scadenze_lavorazione_stato_manuale_check
	check (stato_manuale is null or stato_manuale in ('in_trattativa', 'perso'));

-- Porta avanti chi era già segnato "in trattativa" col vecchio flag booleano.
update public.abbonamenti_scadenze_lavorazione
set stato_manuale = 'in_trattativa'
where in_trattativa = true and stato_manuale is null;

comment on column public.abbonamenti_scadenze_lavorazione.stato_manuale is
	'Stato manuale del rinnovo, scelto da chi lo lavora: null (vuoto, ancora da valutare), ''in_trattativa'' o ''perso''. Sostituisce il vecchio flag booleano in_trattativa.';

-- La vista va ricreata (non un semplice create or replace): sposta la
-- colonna in_trattativa via stato_manuale, e Postgres non permette di
-- rinominare/rimuovere una colonna di vista con create or replace.
-- abbonamenti_scadenze_mensili dipende da questa vista ma non referenzia
-- in_trattativa, quindi va solo ricreata identica dopo il drop cascade.
drop view if exists public.abbonamenti_scadenze cascade;

create view public.abbonamenti_scadenze as
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
	l.assegnato_a
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
left join public.persone p on p.id = a.persona_id
left join lateral (
	select r_1.id, r_1.abbonamento, r_1.data_inizio, r_1.data_fine, r_1.totale
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
	'Una riga per ogni vendita non cancellata con data_fine, esclusi i prodotti "no abbonamento", con persona, gruppo, rinnovo (calcolato) e lavorazione manuale (stato_manuale, nota, assegnato_a — vedi abbonamenti_scadenze_lavorazione). Filtrare per data_fine per il report di /dashboard/abbonamenti/scadenze.';

create view public.abbonamenti_scadenze_mensili as
select
	date_trunc('month', data_fine)::date as mese,
	gruppo_id,
	rinnovato,
	count(*) as numero,
	sum(coalesce(totale, 0)) as valore
from public.abbonamenti_scadenze
group by 1, 2, 3;

comment on view public.abbonamenti_scadenze_mensili is
	'Conteggio delle scadenze per mese, gruppo e stato di rinnovo — per i riquadri riassuntivi di /dashboard/abbonamenti; per l''elenco riga per riga usa abbonamenti_scadenze.';
