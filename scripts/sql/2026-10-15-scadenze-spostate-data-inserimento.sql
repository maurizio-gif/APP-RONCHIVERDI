-- Sospensioni (scadenze spostate): la data in cui è stata inserita.
--
-- La pagina mostrava solo le date dell'abbonamento (fine originaria e fine
-- nuova). Per lavorarla serve sapere QUANDO l'operatore ha spostato la
-- scadenza, filtrarla per intervallo e ordinarla. La data c'era già, sparsa
-- in due colonne:
--
--  - proroga_il: dal registro delle azioni di Info4U (abbonamenti_modifiche),
--    il momento esatto della proroga — c'è per tre righe su quattro;
--  - ultima_variazione_il: quando la sync del CRM ha visto cambiare la data di
--    fine (abbonamenti_scadenze_variazioni), per le poche righe che il
--    registro non copre.
--
-- inserita_il le unisce (vale il registro, se c'è), e inserita_giorno è lo
-- stesso istante come giorno di Roma: è quello su cui filtra la pagina, così
-- «dal 1 al 15 ottobre» vuol dire le giornate di Roma e non quelle UTC.
-- Le righe senza nessuna delle due (proroghe più vecchie del registro) restano
-- senza data: non se ne inventa una.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-10-07-abbonamenti-modifiche.sql.

create or replace view public.scadenze_spostate as
select
	a.id,
	a.source_iscrizione_id,
	a.persona_id,
	p.nome as persona_nome,
	p.cognome as persona_cognome,
	a.abbonamento,
	a.variante,
	a.data_vendita,
	a.data_inizio,
	(a.data_inizio + a.durata::double precision * '1 mon'::interval - '1 day'::interval)::date as scadenza_prevista,
	a.data_fine,
	a.data_fine - (a.data_inizio + a.durata::double precision * '1 mon'::interval - '1 day'::interval)::date as giorni_spostati,
	a.data_fine >= (now() at time zone 'Europe/Rome')::date as attiva,
	a.data_disdetta,
	va.ultima_variazione_il,
	a.durata,
	pr.data_operazione as proroga_il,
	pr.proroga_giorni,
	pr.operatore_nome as proroga_operatore,
	pr.operatore_id as proroga_operatore_id,
	coalesce(pr.data_operazione, va.ultima_variazione_il) as inserita_il,
	(coalesce(pr.data_operazione, va.ultima_variazione_il) at time zone 'Europe/Rome')::date as inserita_giorno
from public.abbonamenti a
left join public.persone p on p.id = a.persona_id
left join lateral (
	select max(v.rilevata_il) as ultima_variazione_il
	from public.abbonamenti_scadenze_variazioni v
	where v.abbonamento_id = a.id
) va on true
left join lateral (
	select m.data_operazione, m.proroga_giorni, m.operatore_nome, m.operatore_id
	from public.abbonamenti_modifiche m
	where m.source_iscrizione_id = a.source_iscrizione_id
		and m.interpretata
		and m.proroga_giorni > 0
	order by m.data_operazione desc
	limit 1
) pr on true
where a.cancellato_il is null
	and a.periodo = 'M'
	and a.durata > 0
	and a.data_inizio >= '2023-01-01'::date
	and a.data_fine is not null
	and (a.data_fine - (a.data_inizio + a.durata::double precision * '1 mon'::interval - '1 day'::interval)::date) > 3;

comment on column public.scadenze_spostate.inserita_il is
	'Quando è stata spostata la scadenza: la proroga dal registro di Info4U, o se manca l''ultima variazione vista dalla sync. Null se non c''è nessuna delle due.';
comment on column public.scadenze_spostate.inserita_giorno is
	'inserita_il come giorno di Roma: per i filtri per intervallo di date.';
