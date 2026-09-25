-- A chi è affidato il lavoro di un rinnovo: un terzo campo manuale accanto a
-- nota e in_trattativa (vedi 2026-09-25-abbonamenti-scadenze-lavorazione.sql),
-- non un dato che arriva da Info4U. Solo un operatore di segreteria
-- (staff_users.operatore_segreteria) può comparire come assegnatario — sono
-- le persone che lavoravano i rinnovi sul foglio Excel, non i commerciali né
-- gli istruttori.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-25-abbonamenti-scadenze-lavorazione.sql.

alter table public.abbonamenti_scadenze_lavorazione
	add column if not exists assegnato_a text;

comment on column public.abbonamenti_scadenze_lavorazione.assegnato_a is
	'Email dell''operatore di segreteria a cui è affidato il lavoro di questo rinnovo (staff_users.operatore_segreteria = true). Manuale come nota e in_trattativa: nessuna sincronizzazione lo scrive.';

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
	'Una riga per ogni vendita non cancellata con data_fine, esclusi i prodotti "no abbonamento", con persona, gruppo, rinnovo (calcolato) e lavorazione manuale (in_trattativa, nota, assegnato_a — vedi abbonamenti_scadenze_lavorazione). Filtrare per data_fine per il report di /dashboard/abbonamenti/scadenze.';
