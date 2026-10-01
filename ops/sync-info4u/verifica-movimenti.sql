/*
  Confronto vendite / movimenti di cassa / rate per prodotto, dal 1° gennaio
  2023. Da lanciare in SSMS su dbgym. Solo letture; blocchi indipendenti.

  Il CRM copia solo le vendite (AbbonamentiIscrizione). La lista «Prodotti
  mancanti» conta invece movimenti: qui si mettono i tre numeri affiancati,
  prodotto per prodotto, per vedere da quale dei tre viene ogni cifra.
*/

-- ───────────────────────────────────────────────────────────── A
-- I prodotti della lista nel catalogo Info4U, con categoria e macro
-- categoria, e quante vendite hanno avuto in tutto (anche prima del 2023).
-- Un prodotto con 0 vendite non arriverà mai nel CRM.
SELECT a.IDAbbonamento, a.Descrizione AS abbonamento, a.Attivo,
       cat.Descrizione AS categoria, mc.Descrizione AS macro_categoria,
       (SELECT COUNT(*) FROM dbo.AbbonamentiIscrizione ai
          JOIN dbo.AbbonamentiDurata ad ON ad.IDDurata = ai.IDDurata
         WHERE ad.IDAbbonamento = a.IDAbbonamento) AS vendite_totali,
       (SELECT MAX(ai.DataOperazione) FROM dbo.AbbonamentiIscrizione ai
          JOIN dbo.AbbonamentiDurata ad ON ad.IDDurata = ai.IDDurata
         WHERE ad.IDAbbonamento = a.IDAbbonamento) AS ultima_vendita
FROM dbo.Abbonamenti a
LEFT JOIN dbo.AbbonamentiCategorie cat ON cat.IDCategoria = a.IDCategoria
LEFT JOIN dbo.AbbonamentiMacroCategorie mc ON mc.IDMacroCategoria = cat.IDMacroCategoria
WHERE a.Descrizione LIKE '%SWIM%' OR a.Descrizione LIKE '%FLEX%' OR a.Descrizione LIKE '%4M%'
   OR a.Descrizione LIKE '%GYM UNDER 20%' OR a.Descrizione LIKE '%BUSINESS%'
   OR a.Descrizione LIKE '%WELFARE%' OR a.Descrizione LIKE '%FAMILY%'
   OR a.Descrizione LIKE '%PROMOZIONI%' OR a.Descrizione LIKE '%QUOTA ISCRIZIONE%'
   OR a.Descrizione LIKE '%GOLD UNDER 1%'
ORDER BY categoria, abbonamento;

-- ───────────────────────────────────────────────────────────── B
-- Per ogni prodotto, dal 2023: vendite (quello che ha il CRM), movimenti di
-- cassa e rate, con gli importi. È la tabella da mettere accanto alla lista.
DECLARE @dal datetime = '2023-01-01';

WITH vendite AS (
  SELECT ad.IDAbbonamento, COUNT(*) AS vendite, SUM(ISNULL(ai.Totale, 0)) AS totale_vendite
  FROM dbo.AbbonamentiIscrizione ai
  JOIN dbo.AbbonamentiDurata ad ON ad.IDDurata = ai.IDDurata
  WHERE ai.DataOperazione >= @dal
  GROUP BY ad.IDAbbonamento
), cassa AS (
  SELECT ad.IDAbbonamento, COUNT(*) AS movimenti_cassa, SUM(cm.Importo) AS incassato_cassa,
         SUM(CASE WHEN cm.IDCassaMovimentoStorno IS NOT NULL THEN 1 ELSE 0 END) AS storni
  FROM dbo.CassaMovimenti cm
  JOIN dbo.AbbonamentiIscrizione ai ON ai.IDIscrizione = cm.IDIscrizione
  JOIN dbo.AbbonamentiDurata ad ON ad.IDDurata = ai.IDDurata
  WHERE cm.DataOperazione >= @dal
  GROUP BY ad.IDAbbonamento
), rate AS (
  SELECT ad.IDAbbonamento, COUNT(*) AS rate, SUM(ap.Importo) AS importo_rate,
         SUM(CASE WHEN ap.DataPagato IS NOT NULL THEN 1 ELSE 0 END) AS rate_pagate
  FROM dbo.AbbonamentiPagamenti ap
  JOIN dbo.AbbonamentiIscrizione ai ON ai.IDIscrizione = ap.IDIscrizione
  JOIN dbo.AbbonamentiDurata ad ON ad.IDDurata = ai.IDDurata
  WHERE ap.DataRata >= @dal
  GROUP BY ad.IDAbbonamento
)
SELECT cat.Descrizione AS categoria, a.Descrizione AS abbonamento,
       ISNULL(v.vendite, 0) AS vendite, ISNULL(v.totale_vendite, 0) AS totale_vendite,
       ISNULL(c.movimenti_cassa, 0) AS movimenti_cassa, ISNULL(c.incassato_cassa, 0) AS incassato_cassa,
       ISNULL(c.storni, 0) AS storni,
       ISNULL(r.rate, 0) AS rate, ISNULL(r.rate_pagate, 0) AS rate_pagate, ISNULL(r.importo_rate, 0) AS importo_rate
FROM dbo.Abbonamenti a
LEFT JOIN dbo.AbbonamentiCategorie cat ON cat.IDCategoria = a.IDCategoria
LEFT JOIN vendite v ON v.IDAbbonamento = a.IDAbbonamento
LEFT JOIN cassa c ON c.IDAbbonamento = a.IDAbbonamento
LEFT JOIN rate r ON r.IDAbbonamento = a.IDAbbonamento
WHERE v.vendite IS NOT NULL OR c.movimenti_cassa IS NOT NULL OR r.rate IS NOT NULL
ORDER BY categoria, abbonamento;

-- ───────────────────────────────────────────────────────────── C
-- Movimenti di cassa che non portano più a una vendita: vendita eliminata
-- («Eliminato abbonamento … per intero») o movimento senza IDIscrizione.
-- Contano nei report di cassa, non nel CRM.
SELECT cm.DescrizioneServizio, cm.TipoServizio,
       CASE WHEN cm.IDIscrizione IS NULL THEN 'senza vendita' ELSE 'vendita eliminata' END AS motivo,
       COUNT(*) AS movimenti, SUM(cm.Importo) AS importo
FROM dbo.CassaMovimenti cm
LEFT JOIN dbo.AbbonamentiIscrizione ai ON ai.IDIscrizione = cm.IDIscrizione
WHERE cm.DataOperazione >= '2023-01-01'
  AND ai.IDIscrizione IS NULL
  AND (cm.IDIscrizione IS NOT NULL OR cm.Causale LIKE 'ABBONAMENT%' OR cm.Causale LIKE 'PAGAMENTO RATA%')
GROUP BY cm.DescrizioneServizio, cm.TipoServizio,
         CASE WHEN cm.IDIscrizione IS NULL THEN 'senza vendita' ELSE 'vendita eliminata' END
ORDER BY movimenti DESC;

-- ───────────────────────────────────────────────────────────── D
-- Incassi registrati in cassa con un prodotto, su una vendita che oggi ne
-- porta un altro (prodotto cambiato dopo l'incasso). È il caso di
-- «Swim Under 30»: la cassa dice un nome, la vendita — e quindi il CRM — un altro.
SELECT cm.DescrizioneServizio AS prodotto_in_cassa, a.Descrizione AS prodotto_sulla_vendita,
       COUNT(*) AS movimenti, SUM(cm.Importo) AS importo,
       MIN(cm.IDIscrizione) AS esempio_id_iscrizione
FROM dbo.CassaMovimenti cm
JOIN dbo.AbbonamentiIscrizione ai ON ai.IDIscrizione = cm.IDIscrizione
JOIN dbo.AbbonamentiDurata ad ON ad.IDDurata = ai.IDDurata
JOIN dbo.Abbonamenti a ON a.IDAbbonamento = ad.IDAbbonamento
WHERE cm.DataOperazione >= '2023-01-01'
  AND cm.DescrizioneServizio IS NOT NULL
  AND LTRIM(RTRIM(UPPER(cm.DescrizioneServizio))) <> LTRIM(RTRIM(UPPER(a.Descrizione)))
GROUP BY cm.DescrizioneServizio, a.Descrizione
ORDER BY movimenti DESC;
