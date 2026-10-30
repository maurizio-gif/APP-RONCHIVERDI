-- Tesseramenti CSI: l'«ABBONAMENTO WELFARE AZIENDALE» non si tessera.
--
-- Viene venduto a società, non a persone: le schede in anagrafica sono
-- segnaposto dell'azienda (es. «Erre Company Srl» / «1»), senza dati di
-- nascita. Il prodotto esce da tesseramenti_csi_prodotti (attivo = false), quindi
-- non compare più negli elenchi (nemmeno fra i non tesserabili) e il
-- tesseramento automatico non lo considera. Rieseguire
-- 2026-10-29-tesseramento-csi-prodotti.sql non lo riattiva (ha la stessa
-- esclusione).
--
-- Si può rieseguire senza danni.

update public.tesseramenti_csi_prodotti
set attivo = false, aggiornato_il = now()
where attivo and prodotto ilike 'ABBONAMENTO WELFARE AZIENDALE%';

-- Verifica
select prodotto, attivo from public.tesseramenti_csi_prodotti where prodotto ilike 'ABBONAMENTO WELFARE AZIENDALE%';
