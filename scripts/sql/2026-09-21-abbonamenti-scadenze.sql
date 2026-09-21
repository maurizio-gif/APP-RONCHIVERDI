-- Report "abbonamenti in scadenza": per ogni vendita non cancellata con una
-- data_fine, dice anche se quella persona ha già rinnovato — un nuovo
-- abbonamento (non cancellato) nello STESSO gruppo prodotto, che inizia alla
-- scadenza o dopo. "Stesso gruppo" e non "stesso prodotto esatto": chi
-- rinnova passando da "1.1-GOLD UNDER 30" a "1.1-GOLD UNDER 35" (cambio
-- fascia d'età) ha comunque rinnovato lo stesso tipo di abbonamento.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-21-abbonamenti-cancellati.sql (serve
-- la colonna cancellato_il).

-- ────────────────────────────────────────────────────────────── indici
--
-- Il filtro esterno (pagina Abbonamenti) cerca per data_fine dentro una
-- finestra di mesi; la EXISTS del rinnovo cerca, persona per persona, se
-- esiste un data_inizio successivo. Senza questi due indici entrambe le
-- ricerche sarebbero una scansione delle oltre 190.000 righe.

create index if not exists abbonamenti_data_fine_idx
	on public.abbonamenti (data_fine)
	where data_fine is not null and cancellato_il is null;

create index if not exists abbonamenti_persona_data_inizio_idx
	on public.abbonamenti (persona_id, data_inizio)
	where cancellato_il is null;

-- ─────────────────────────────────────────────────────────────────── vista

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
	exists (
		select 1
		from public.abbonamenti r
		left join public.abbonamenti_mappatura mr on mr.prodotto = r.abbonamento
		where r.persona_id = a.persona_id
			and r.cancellato_il is null
			and r.id <> a.id
			and r.data_inizio >= a.data_fine
			and mr.gruppo_id is not distinct from m.gruppo_id
	) as rinnovato
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
left join public.persone p on p.id = a.persona_id
where a.cancellato_il is null
	and a.data_fine is not null
	and a.persona_id is not null;

comment on view public.abbonamenti_scadenze is
	'Una riga per ogni vendita non cancellata con data_fine, con persona e gruppo, più "rinnovato": esiste un altro abbonamento non cancellato della stessa persona, stesso gruppo (gruppo_id compreso il caso "entrambi non categorizzati"), con data_inizio alla scadenza di questa riga o dopo. Filtrare per data_fine per il report di /dashboard/abbonamenti/scadenze — senza filtro scansiona tutta la tabella.';

-- ────────────────────────────────────────────────────────────── aggregata
--
-- Per i conteggi mensili della card riassuntiva (non l'elenco riga per
-- riga, quello resta sulla vista sopra): PostgREST tronca comunque a 1000
-- righe una select qualunque sia il `.limit()` chiesto dal client (stesso
-- vincolo già noto altrove in questo codice, vedi il commento in
-- app/dashboard/abbonamenti/report/page.tsx) — un solo mese di punta
-- (settembre, oltre 1500 scadenze) basta a farlo scattare e a restituire un
-- conteggio parziale silenzioso. Aggregando qui lato database il risultato
-- resta poche righe (mesi × gruppi × rinnovato sì/no), mai vicino al limite.
create or replace view public.abbonamenti_scadenze_mensili as
select
	date_trunc('month', data_fine)::date as mese,
	gruppo_id,
	rinnovato,
	count(*) as numero
from public.abbonamenti_scadenze
group by 1, 2, 3;

comment on view public.abbonamenti_scadenze_mensili is
	'Conteggio delle scadenze per mese, gruppo e stato di rinnovo — per i riquadri riassuntivi di /dashboard/abbonamenti; per l''elenco riga per riga usa abbonamenti_scadenze (paginata, non in un colpo solo: PostgREST tronca a 1000 righe).';
