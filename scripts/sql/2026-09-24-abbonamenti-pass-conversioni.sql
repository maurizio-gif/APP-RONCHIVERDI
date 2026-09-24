-- Sezione PASS della pagina Abbonamenti: quanti pass scadono ogni mese e
-- quanti di quei clienti hanno poi sottoscritto un vero abbonamento (di un
-- gruppo diverso da Pass) entro i 30 giorni successivi alla scadenza del
-- pass — stesso schema a LEFT JOIN LATERAL già usato per abbonamenti_scadenze
-- (vedi 2026-09-21-abbonamenti-scadenze-30-giorni.sql), qui incrociando il
-- gruppo Pass con qualunque ALTRO gruppo invece che con lo stesso gruppo.
--
-- "convertito" è per riga di pass (la conversione più vicina, se più di una),
-- stesso principio del "rinnovato" di abbonamenti_scadenze: evita di contare
-- due volte un pass se la persona ha aperto più abbonamenti nei 30 giorni.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-24-abbonamenti-scadenze-no-abbonamento-fix.sql.

create or replace view public.abbonamenti_pass_conversioni as
select
	a.id,
	a.persona_id,
	a.data_fine,
	r.id is not null as convertito
from public.abbonamenti a
join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
left join lateral (
	select r.id
	from public.abbonamenti r
	left join public.abbonamenti_mappatura mr on mr.prodotto = r.abbonamento
	where r.persona_id = a.persona_id
		and r.cancellato_il is null
		and r.id <> a.id
		and r.data_inizio between a.data_fine and (a.data_fine + 30)
		and coalesce(mr.no_abbonamento, false) = false
		and mr.gruppo_id is distinct from m.gruppo_id
	order by r.data_inizio asc
	limit 1
) r on true
where a.cancellato_il is null
	and a.data_fine is not null
	and a.persona_id is not null
	and m.gruppo_id = (select id from public.abbonamenti_gruppi where nome = 'PASS');
-- Niente "and coalesce(m.no_abbonamento, false) = false" sul pass di
-- partenza: a differenza di abbonamenti_scadenze, qui il filtro esclude solo
-- la conversione (mr.no_abbonamento), non il pass stesso — TUTTI i prodotti
-- del gruppo PASS sono marcati no_abbonamento = true (sono gratuiti/di
-- ingresso, giustamente esclusi da fatturato e rinnovi), quindi filtrarli
-- anche qui avrebbe azzerato la vista (verificato: 0 righe prima di questa
-- correzione, 31.122 dopo).

comment on view public.abbonamenti_pass_conversioni is
	'Una riga per ogni Pass scaduto (gruppo PASS, non "no abbonamento"), con "convertito": esiste un abbonamento di un gruppo DIVERSO da Pass, della stessa persona, non cancellato, con data_inizio entro 30 giorni dalla scadenza di questo pass (compreso lo stesso giorno) — la riga più vicina, se più di una. Per la sezione PASS di /dashboard/abbonamenti.';

-- pass_scaduti conta persone distinte, non righe: la stessa persona può
-- avere decine di pass "scaduti" nello stesso mese (i pass giornalieri usati
-- come ingressi ricorrenti — verificato sui dati: fino a 42 righe in un mese
-- per una sola persona, ottobre 2024 passava da 635 righe a 94 persone).
-- guest_pass resta il conteggio grezzo (ogni ingresso), mostrato accanto
-- come dettaglio nel grafico: le due letture servono a domande diverse,
-- "quante persone abbiamo visto" e "quanti ingressi abbiamo avuto".
-- guest_pass in coda, non fra mese e pass_scaduti: CREATE OR REPLACE VIEW
-- rifiuta di inserire una colonna in mezzo a quelle già esistenti ("cannot
-- change name of view column ... to ...") — può solo aggiungerne alla fine.
-- L'ordine non conta per il codice che legge questa vista (Supabase la
-- interroga per nome colonna, non per posizione).
create or replace view public.abbonamenti_pass_mensili as
select
	date_trunc('month', data_fine)::date as mese,
	count(distinct persona_id) as pass_scaduti,
	count(distinct persona_id) filter (where convertito) as convertiti,
	count(*) as guest_pass
from public.abbonamenti_pass_conversioni
group by 1;

comment on view public.abbonamenti_pass_mensili is
	'guest_pass = ogni pass scaduto quel mese (una riga per ingresso); pass_scaduti = persone distinte con almeno un pass scaduto quel mese; convertiti = quante di quelle persone hanno poi sottoscritto un abbonamento vero (di un altro gruppo) entro 30 giorni da uno dei loro pass. Per il grafico PASS di /dashboard/abbonamenti.';
