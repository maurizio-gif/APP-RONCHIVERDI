-- Lo stato di lavorazione manuale di un rinnovo: una nota libera e il flag
-- "in trattativa" per i casi ancora aperti — nessuna sincronizzazione da
-- Info4U può dedurli, sono decisioni di chi lavora il rinnovo. Prima vivevano
-- solo nel foglio Excel "REPORT RINNOVI"; qui diventano un campo in più della
-- stessa riga che si vede in /dashboard/abbonamenti/scadenze, non un posto
-- separato da aprire.
--
-- Tabella a parte e non colonne su `abbonamenti`: quella tabella è scritta
-- solo dalla sincronizzazione Info4U (ops/sync-info4u/), che la riscrive per
-- intero a ogni giro — qualunque colonna manuale aggiunta lì verrebbe persa
-- al sync successivo.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-24-abbonamenti-scadenze-venditore.sql.

create table if not exists public.abbonamenti_scadenze_lavorazione (
	abbonamento_id uuid primary key references public.abbonamenti(id) on delete cascade,
	in_trattativa boolean not null default false,
	nota text,
	aggiornato_da text,
	aggiornato_il timestamptz not null default now()
);

comment on table public.abbonamenti_scadenze_lavorazione is
	'Stato di lavorazione manuale di un abbonamento in scadenza: nota libera e flag "in trattativa" per i rinnovi ancora aperti (né rinnovati né persi). Una riga per abbonamento (abbonamenti.id), creata al primo salvataggio dalla pagina /dashboard/abbonamenti/scadenze.';

-- ─────────────────────────────────────────────────────────────────── vista
--
-- Stessa definizione di 2026-09-24-abbonamenti-scadenze-venditore.sql, con
-- in_trattativa e nota aggiunte in coda via un left join sulla tabella sopra
-- (abbonamento senza lavorazione salvata = in_trattativa false, nota null).
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
	coalesce(l.in_trattativa, false) as in_trattativa,
	l.nota
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
	'Una riga per ogni vendita non cancellata con data_fine, esclusi i prodotti "no abbonamento", con persona, gruppo, rinnovo (calcolato) e lavorazione manuale (in_trattativa, nota — vedi abbonamenti_scadenze_lavorazione). Filtrare per data_fine per il report di /dashboard/abbonamenti/scadenze.';
