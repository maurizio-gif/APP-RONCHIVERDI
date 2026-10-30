-- I prodotti che dànno la tessera CSI, ricavati dalle ricevute.
--
-- La regola della società: la tessera è la condizione del non assoggettamento
-- all'IVA, cioè delle righe delle ricevute con IVA a zero e dicitura «art. 4»
-- (DPR 633/72). Un prodotto va quindi tesserato se le sue vendite portano
-- righe art. 4: nelle ricevute degli ultimi 24 mesi, almeno 5 righe e almeno il
-- 30% delle righe del prodotto. La soglia lascia fuori le versioni «non
-- tesserati» (vendute al 22%), che hanno solo qualche riga isolata.
--
-- Il collegamento è riga di ricevuta → movimento → iscrizione → abbonamento
-- (ricevute_righe.source_movimento_id = transazioni.source_movimento_id,
-- transazioni.source_iscrizione_id = abbonamenti.source_iscrizione_id).
--
-- L'attività CSI è `CR` (Circoli ricreativi) per tutti: è quella con cui la
-- società ha tesserato finora, e l'unica con credito a tessere (convenzione
-- ANIF). Non emette nulla: l'automazione resta spenta (automazioni.tesseramento_csi)
-- e la function chiama CSI in simulazione finché CSI_LIVE non vale 1.
--
-- Da eseguire dopo 2026-10-29-tesseramento-csi.sql; si può rieseguire (aggiorna
-- i prodotti già presenti) e conviene rieseguirlo quando entra un prodotto nuovo.

insert into public.tesseramenti_csi_prodotti (prodotto, codice_attivita)
select s.prodotto, 'CR'
from (
	select a.abbonamento as prodotto
	from public.ricevute r
	join public.ricevute_righe rr on rr.source_ricevuta_id = r.source_ricevuta_id
	join public.transazioni t on t.source_movimento_id = rr.source_movimento_id
	join public.abbonamenti a on a.source_iscrizione_id = t.source_iscrizione_id
	where not coalesce(r.annullata, false)
		and r.data_ricevuta >= current_date - interval '24 months'
		and a.abbonamento is not null
		-- Il tennis (Young School Tennis) non si tessera.
		and a.abbonamento not ilike '%Y.S. TENNIS%'
		-- Il welfare aziendale è venduto a società, non a persone.
		and a.abbonamento not ilike 'ABBONAMENTO WELFARE AZIENDALE%'
		and not exists (
			select 1
			from public.abbonamenti_mappatura m
			join public.abbonamenti_gruppi g on g.id = m.gruppo_id
			where m.prodotto = a.abbonamento and g.nome = 'YS TENNIS'
		)
	group by a.abbonamento
	having count(*) filter (where rr.iva = 0 and rr.iva_descrizione = 'art. 4') >= 5
		and 100.0 * count(*) filter (where rr.iva = 0 and rr.iva_descrizione = 'art. 4') / count(*) >= 30
) s
on conflict (prodotto) do update
	set codice_attivita = excluded.codice_attivita, attivo = true, aggiornato_il = now();

-- Verifica
select count(*) as prodotti, count(*) filter (where attivo) as attivi from public.tesseramenti_csi_prodotti;
