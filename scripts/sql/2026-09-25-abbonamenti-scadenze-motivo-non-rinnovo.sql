-- Due campi in più dal foglio Excel "REPORT RINNOVI" di origine, distinti
-- dalla nota di gestione generale (abbonamenti_scadenze_lavorazione.nota):
-- il motivo del mancato rinnovo (elenco fisso, gli stessi valori già usati
-- nel foglio) e una nota libera più lunga specifica su quel motivo. Manuali
-- come stato_manuale e nota: nessuna sincronizzazione li scrive.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-25-abbonamenti-scadenze-stato-manuale.sql.

alter table public.abbonamenti_scadenze_lavorazione
	add column if not exists motivo_non_rinnovo text,
	add column if not exists note_non_rinnovo text;

alter table public.abbonamenti_scadenze_lavorazione
	drop constraint if exists abbonamenti_scadenze_lavorazione_motivo_non_rinnovo_check;

alter table public.abbonamenti_scadenze_lavorazione
	add constraint abbonamenti_scadenze_lavorazione_motivo_non_rinnovo_check
	check (motivo_non_rinnovo is null or motivo_non_rinnovo in (
		'ALTRA STRUTTURA', 'ALTRO SPORT', 'DISDETTA FLEX', 'LAVORO', 'MAI VENUTO',
		'MOTIVI PERSONALI', 'NESSUNA RISPOSTA', 'PIGRIZIA E IMPEGNI FAMIGLIARI',
		'POCA FREQUENZA', 'PREZZO', 'PREZZO X FREQUENZA', 'RATE INSOLUTE', 'RECUPERO',
		'SALUTE', 'SOLO PERIODO ESTIVO', 'SOLO PERIODI BREVI',
		'SOVRAFFOLAMENTO-PREZZO- QUALITA'' SERVIZI', 'STUDIO',
		'TRASFERIMENTO ABITAZIONE', 'TRASFERIMENTO LAVORO', 'TRASFERIMENTO STUDIO'
	));

comment on column public.abbonamenti_scadenze_lavorazione.motivo_non_rinnovo is
	'Perché non ha rinnovato, a elenco fisso — lo stesso campo del vecchio foglio "REPORT RINNOVI" (vedi MOTIVI_NON_RINNOVO in scadenze/actions.ts). Manuale: nessuna sincronizzazione lo scrive.';
comment on column public.abbonamenti_scadenze_lavorazione.note_non_rinnovo is
	'Nota libera e lunga sul mancato rinnovo, distinta da motivo_non_rinnovo (categoria fissa) e da nota (nota di gestione generale) — stessa distinzione a tre colonne del foglio Excel di origine.';

-- Stessa ragione del drop cascade nella migration precedente: aggiungere
-- colonne a metà di una vista esistente (non in coda) richiede ricrearla.
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
	l.motivo_non_rinnovo,
	l.note_non_rinnovo,
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
	'Una riga per ogni vendita non cancellata con data_fine, esclusi i prodotti "no abbonamento", con persona, gruppo, rinnovo (calcolato) e lavorazione manuale (stato_manuale, nota, motivo_non_rinnovo, note_non_rinnovo, assegnato_a — vedi abbonamenti_scadenze_lavorazione). Filtrare per data_fine per il report di /dashboard/abbonamenti/scadenze.';

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
