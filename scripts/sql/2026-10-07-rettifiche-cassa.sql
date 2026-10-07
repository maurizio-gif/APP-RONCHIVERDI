-- Report ELIMINAZIONI E STORNI (pagina /dashboard/incassato/eliminazioni):
-- l'evidenza, per chi controlla la contabilità, di tutto quello che in
-- Info4U corregge un incasso già registrato.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi, dopo
-- 2026-10-07-transazioni-cassa.sql e 2026-10-07-incassato-report.sql.
--
-- Come funzionano le rettifiche in Info4U (verificato sui dati dal 2023):
--   * Eliminare una vendita NON cancella gli incassi: aggiunge un movimento
--     NEGATIVO con causale «ABBONAMENTI: Eliminato abbonamento <prodotto>»,
--     di norma lo stesso giorno dell'incasso, che punta al movimento
--     originale (source_movimento_storno_id) — nella maggior parte dei casi.
--   * Se poi la vendita viene ricreata corretta, il nuovo incasso è un
--     movimento POSITIVO che punta all'eliminazione che compensa: è una
--     modifica (elimina e ricrea), non una perdita. Per questo una
--     eliminazione da sola non dice nulla: conta il netto eliminazioni meno
--     ripristini.
--   * Quando si elimina una vendita con rate pagate, ogni rata pagata ha il
--     suo storno negativo «PAGAMENTO RATA - storno per eliminazione».
--   * Esistono molti movimenti a importo zero (omaggi, vendite gratuite): si
--     contano ma il report li nasconde di default.
--
-- Categorie (colonna `categoria`):
--   eliminazione    causale «ABBONAMENTI: Elimina…» (importo negativo o zero)
--   ripristino      storno con importo positivo: ricrea quanto era stato
--                   eliminato
--   storno_rata     «PAGAMENTO RATA - storno…»
--   storno_altro    ogni altro movimento che punta a un movimento originale

create or replace view public.rettifiche_cassa
with (security_invoker = true) as
select
	t.source_movimento_id,
	t.data_operazione,
	(t.data_operazione at time zone 'Europe/Rome')::date as giorno,
	t.importo,
	t.tipo_servizio,
	t.causale,
	t.metodo_pagamento,
	t.operatore_nome,
	t.persona_id,
	p.nome as persona_nome,
	p.cognome as persona_cognome,
	t.source_iscrizione_id,
	case
		when t.causale ilike 'ABBONAMENTI: Elimina%' then 'eliminazione'
		when t.source_movimento_storno_id is not null and t.importo > 0 then 'ripristino'
		when t.causale ilike 'PAGAMENTO RATA - storno%' then 'storno_rata'
		else 'storno_altro'
	end as categoria,
	t.source_movimento_storno_id as storno_di,
	-- Il movimento rettificato, se è fra quelli migrati (dal 2023): un
	-- puntatore a un movimento precedente resta con `originale_id` nullo.
	o.source_movimento_id as originale_id,
	o.data_operazione as originale_data,
	o.importo as originale_importo,
	o.operatore_nome as originale_operatore,
	o.metodo_pagamento as originale_metodo,
	-- Giorni fra l'incasso originale e la sua rettifica: 0 = stesso giorno
	-- (una correzione di banco), molti = una rettifica a posteriori.
	((t.data_operazione at time zone 'Europe/Rome')::date
		- (o.data_operazione at time zone 'Europe/Rome')::date) as giorni_dall_originale,
	-- Vero se la rettifica cade in un mese diverso da quello dell'incasso:
	-- cambia un mese che la contabilità può aver già chiuso.
	(date_trunc('month', t.data_operazione at time zone 'Europe/Rome')
		<> date_trunc('month', o.data_operazione at time zone 'Europe/Rome')) as mese_diverso
from public.transazioni t
left join public.transazioni o on o.source_movimento_id = t.source_movimento_storno_id
left join public.persone p on p.id = t.persona_id
where t.cancellato_il is null
  and t.data_operazione <= now()
  and (t.causale ilike 'ABBONAMENTI: Elimina%' or t.source_movimento_storno_id is not null);

comment on view public.rettifiche_cassa is
	'Eliminazioni di vendita, ripristini e storni di cassa di Info4U, ognuno col movimento originale rettificato (se migrato), i giorni di distanza e se cade in un altro mese. Vedi il commento in testa a 2026-10-07-rettifiche-cassa.sql per come leggerle.';
