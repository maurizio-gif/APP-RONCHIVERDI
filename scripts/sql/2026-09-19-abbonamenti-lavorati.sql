-- "Lavorato" o no: una vendita è lavorata se la persona ha, in un momento
-- qualunque, una richiesta dal sito (form_contatti), una trattativa
-- (opportunita) o un'azione della segreteria — task, appuntamento, visita in
-- sede (task, collegata alla persona o a una sua richiesta: vedi
-- scripts/sql/2026-09-08-eventi-collegati.sql). Non lavorata è tutto il resto:
-- un rinnovo al banco, un walk-in mai passato dal sito.
--
-- Da eseguire nel SQL Editor di Supabase, dopo
-- 2026-09-18-abbonamenti-gruppi.sql (serve abbonamenti_mappatura).
--
-- ──────────────────────────────────────────────────────── perché una vista sola
--
-- La lista "Dettaglio del giorno" e il Report mensile classificano le vendite
-- via TypeScript (vedi lib/attivitaCommerciale.ts), interrogando
-- form_contatti/opportunita/task solo per le persone che servono in quel
-- momento — una manciata o poche centinaia. Il grafico degli ultimi 12 mesi
-- non può fare lo stesso: `abbonamenti` supera le 190.000 righe e un anno
-- intero può comunque essere qualche migliaio di vendite, più di quante ne
-- gestisca comodamente il client in una pagina. Da qui una vista che aggrega
-- lato database — ma filtrata ai soli ultimi 13 mesi **dentro la vista
-- stessa**, non lasciata al filtro della pagina: aggregare "lavorato o no"
-- sull'intero storico (tre EXISTS per riga, per 190.000 righe) sarebbe lento
-- ad ogni caricamento della pagina Abbonamenti. 13 e non 12: un mese di
-- margine perché il grafico riparte dal primo giorno di 11 mesi fa.
create or replace view public.abbonamenti_mensili_lavorati as
select
	date_trunc('month', a.data_vendita)::date as mese,
	m.gruppo_id,
	(
		exists (select 1 from public.form_contatti fc where fc.persona_id = a.persona_id)
		or exists (select 1 from public.opportunita o where o.persona_id = a.persona_id)
		or exists (
			select 1 from public.task t
			where (t.entita = 'persona' and t.entita_id = a.persona_id::text)
				or (t.entita = 'form_contatti' and t.entita_id in (
					select fc2.id::text from public.form_contatti fc2 where fc2.persona_id = a.persona_id
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
