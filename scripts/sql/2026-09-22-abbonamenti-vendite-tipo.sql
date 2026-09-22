-- Punto 4 della pagina Abbonamenti ("confronto a parità di giorni"): oltre
-- al totale, distingue quante vendite del periodo sono "nuove" e quante
-- "rinnovi". Stessa definizione di rinnovo già usata nel grafico Andamento
-- rinnovi (vedi 2026-09-21-abbonamenti-scadenze-30-giorni.sql), letta però
-- dal verso opposto: non "quell'abbonamento scaduto è stato poi rinnovato"
-- ma "questa vendita segue, entro 30 giorni, la scadenza di un abbonamento
-- precedente della stessa persona nello stesso gruppo prodotto".
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-21-abbonamenti-scadenze-30-giorni.sql
-- (serve abbonamenti_mappatura e la stessa finestra di 30 giorni).

-- L'EXISTS cerca, persona per persona, se esiste una data_fine precedente
-- entro 30 giorni da data_inizio: senza questo indice sarebbe una scansione
-- delle oltre 190.000 righe per ogni vendita del periodo.
create index if not exists abbonamenti_persona_data_fine_idx
	on public.abbonamenti (persona_id, data_fine)
	where cancellato_il is null;

-- ─────────────────────────────────────────────────────────────────── vista

create or replace view public.abbonamenti_vendite_tipo as
select
	a.id,
	a.data_vendita::date as giorno,
	m.gruppo_id,
	a.totale,
	exists (
		select 1
		from public.abbonamenti r
		left join public.abbonamenti_mappatura mr on mr.prodotto = r.abbonamento
		where r.persona_id = a.persona_id
			and r.cancellato_il is null
			and r.id <> a.id
			and r.data_fine between (a.data_inizio - 30) and a.data_inizio
			and mr.gruppo_id is not distinct from m.gruppo_id
	) as rinnovo
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
where a.cancellato_il is null
	and a.data_vendita is not null
	and a.persona_id is not null;

comment on view public.abbonamenti_vendite_tipo is
	'Una riga per ogni vendita non cancellata, con "rinnovo": esiste un altro abbonamento non cancellato della stessa persona, stesso gruppo (gruppo_id compreso il caso "entrambi non categorizzati"), con data_fine entro 30 giorni prima della data_inizio di questa riga (compreso lo stesso giorno) — stessa finestra di abbonamenti_scadenze, letta dal verso opposto. Usata per distinguere vendite nuove da rinnovi nella tabella "confronto a parità di giorni" di /dashboard/abbonamenti.';

-- ────────────────────────────────────────────────────────────── aggregata
--
-- Per giorno, gruppo e nuovo/rinnovo — come abbonamenti_giornalieri ma con
-- la distinzione in più: la pagina somma sia il totale sia le due categorie
-- separate sullo stesso intervallo di giorni.
create or replace view public.abbonamenti_giornalieri_tipo as
select
	giorno,
	gruppo_id,
	rinnovo,
	count(*) as numero_vendite,
	sum(totale) as fatturato
from public.abbonamenti_vendite_tipo
group by 1, 2, 3;

comment on view public.abbonamenti_giornalieri_tipo is
	'Conteggio e fatturato delle vendite per giorno, gruppo e nuovo/rinnovo — per la tabella "confronto a parità di giorni" di /dashboard/abbonamenti; il totale del giorno è la somma delle due righe (rinnovo true/false).';
