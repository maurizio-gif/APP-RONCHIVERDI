-- "Lavorata" o no: una vendita è lavorata quando la persona ha avuto almeno
-- un'azione della segreteria — un task, un appuntamento, una visita in sede
-- (tabella `task`, collegata alla persona o a una sua richiesta: vedi
-- scripts/sql/2026-09-08-eventi-collegati.sql) — nei 30 giorni prima
-- dell'acquisto. Non basta una richiesta dal sito da sola: quella dice che il
-- sito ha portato il contatto, non che qualcuno l'abbia lavorato. Stessa
-- regola, stessa finestra di `riassumi().lavorato` in lib/percorsoVendita.ts
-- — la vista qui è solo la sua versione aggregata per il grafico dei 12 mesi,
-- che di righe ne muove troppe per ricostruire il percorso di ognuna a mano
-- (vedi lib/percorsoVendita-server.ts, caricaDateAzioniDesk, per la stessa
-- classificazione fatta riga per riga nel Report mensile).
--
-- Da eseguire nel SQL Editor di Supabase, dopo
-- 2026-09-18-abbonamenti-gruppi.sql (serve abbonamenti_mappatura).
--
-- ──────────────────────────────────────────────────────── perché una vista sola
--
-- `abbonamenti` supera le 190.000 righe: aggregare "lavorata o no" su tutto
-- lo storico ad ogni caricamento della pagina Abbonamenti sarebbe lento. Da
-- qui una vista filtrata ai soli ultimi 13 mesi **dentro la vista stessa**,
-- non lasciata al filtro della pagina — 13 e non 12: un mese di margine
-- perché il grafico riparte dal primo giorno di 11 mesi fa.
create or replace view public.abbonamenti_mensili_lavorati as
select
	date_trunc('month', a.data_vendita)::date as mese,
	m.gruppo_id,
	exists (
		select 1 from public.task t
		where t.stato is distinct from 'annullato'
			and t.data >= (a.data_vendita::date - 30)
			and t.data <= a.data_vendita::date
			and (
				(t.entita = 'persona' and t.entita_id = a.persona_id::text)
				or (t.entita = 'form_contatti' and t.entita_id in (
					select fc.id::text from public.form_contatti fc where fc.persona_id = a.persona_id
				))
			)
	) as lavorata,
	count(*) as numero_vendite,
	sum(a.totale) as fatturato
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
where a.data_vendita is not null
	and a.data_vendita >= (now() - interval '13 months')
group by 1, 2, 3;
