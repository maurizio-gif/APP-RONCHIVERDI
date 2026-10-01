/*
  Verifica delle discrepanze fra Info4U e CRM (lista «Prodotti mancanti / da
  rivedere», ottobre 2026). Da lanciare in SSMS su dbgym, sul PC della
  sincronizzazione. Solo letture. Tutto dal 1° gennaio 2023 in poi.

  Il CRM copia SOLO dbo.AbbonamentiIscrizione (una riga per vendita, col suo
  Totale). Se un report Info4U conta «movimenti» o incassi, legge un'altra
  tabella: le query 1 e 2 servono a trovare quale.

  Le query sono indipendenti: si possono selezionare e lanciare una alla volta.
*/

-- ───────────────────────────────────────────────────────────── 1
-- Dove stanno i nomi «Categoria mancante»: in quale tabella e colonna di
-- dbgym compaiono. Se non sono in dbo.Abbonamenti, il CRM non li vedrà mai.
--
-- Per non scorrere tutto il database cerca solo nelle tabelle di catalogo e
-- di movimenti (nomi nel filtro qui sotto) e, dove la tabella ha una colonna
-- data, solo dal 1° gennaio 2023. Le tabelle di catalogo senza date (es.
-- dbo.Abbonamenti) si leggono intere: sono piccole.
IF OBJECT_ID('tempdb..#cercati') IS NOT NULL DROP TABLE #cercati;
CREATE TABLE #cercati (nome nvarchar(200));
INSERT INTO #cercati VALUES
  (N'%FLEX UNDER 35%SWIM INDOOR%'), (N'%FLEX UNDER 30%SWIM INDOOR%'),
  (N'%RICORRENTE FLEX%'), (N'%OVER 30 4M%'), (N'%SWIM UNDER 30%'), (N'%GYM UNDER 20%');

DECLARE @dal date = '2023-01-01';
DECLARE @sql nvarchar(max) = N'';

;WITH tabelle AS (
  SELECT t.object_id, s.name AS schema_nome, t.name AS tabella,
         -- La colonna data su cui filtrare: prima quelle dell'operazione o
         -- del pagamento, poi qualsiasi «Data…», poi la prima che c'è.
         (SELECT TOP 1 c.name
          FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id
          WHERE c.object_id = t.object_id AND ty.name IN ('date', 'datetime', 'datetime2', 'smalldatetime')
          ORDER BY CASE WHEN c.name LIKE '%Operazione%' OR c.name LIKE '%Moviment%' OR c.name LIKE '%Pagament%' THEN 0
                        WHEN c.name LIKE 'Data%' THEN 1 ELSE 2 END, c.column_id) AS colonna_data
  FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
  WHERE t.name LIKE '%Abbonament%' OR t.name LIKE '%Prodott%' OR t.name LIKE '%Articol%'
     OR t.name LIKE '%Serviz%' OR t.name LIKE '%Categori%' OR t.name LIKE '%Listin%'
     OR t.name LIKE '%Moviment%' OR t.name LIKE '%Cassa%' OR t.name LIKE '%Pagament%'
     OR t.name LIKE '%Incass%' OR t.name LIKE '%Ricorren%' OR t.name LIKE '%Rate%'
     OR t.name LIKE '%Scontrin%' OR t.name LIKE '%Vendit%' OR t.name LIKE '%Fattur%'
)
SELECT @sql = @sql
  + CASE WHEN @sql = N'' THEN N'' ELSE N' UNION ALL ' END
  + N'SELECT ' + QUOTENAME(x.schema_nome + N'.' + x.tabella, '''') + N' AS tabella, '
  + QUOTENAME(c.name, '''') + N' AS colonna, '
  + N'CAST(' + QUOTENAME(c.name) + N' AS nvarchar(400)) AS valore, COUNT(*) AS righe '
  + N'FROM ' + QUOTENAME(x.schema_nome) + N'.' + QUOTENAME(x.tabella) + N' '
  + N'WHERE EXISTS (SELECT 1 FROM #cercati k WHERE CAST(' + QUOTENAME(c.name) + N' AS nvarchar(400)) LIKE k.nome)'
  + ISNULL(N' AND ' + QUOTENAME(x.colonna_data) + N' >= @dal', N'')
  + N' GROUP BY CAST(' + QUOTENAME(c.name) + N' AS nvarchar(400))' + NCHAR(10)
FROM tabelle x
JOIN sys.columns c ON c.object_id = x.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE ty.name IN ('varchar', 'nvarchar', 'char', 'nchar') AND (c.max_length = -1 OR c.max_length >= 10);

IF @sql <> N''
BEGIN
  SET @sql = @sql + N' ORDER BY tabella, colonna, valore';
  EXEC sp_executesql @sql, N'@dal date', @dal = @dal;
END
DROP TABLE #cercati;

-- ───────────────────────────────────────────────────────────── 2
-- Le tabelle che possono contenere «movimenti» (incassi, rate, ricorrenze):
-- il report Info4U che conta movimenti legge probabilmente una di queste.
-- Legge solo i metadati: è immediata.
SELECT s.name + '.' + t.name AS tabella, SUM(p.rows) AS righe
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
WHERE t.name LIKE '%Moviment%' OR t.name LIKE '%Cassa%' OR t.name LIKE '%Pagament%'
   OR t.name LIKE '%Incass%' OR t.name LIKE '%Ricorren%' OR t.name LIKE '%Rate%'
   OR t.name LIKE '%Scontrin%' OR t.name LIKE '%Fattur%' OR t.name LIKE '%Categori%'
GROUP BY s.name, t.name
ORDER BY tabella;

-- ───────────────────────────────────────────────────────────── 3
-- I prodotti della lista come li vede il CRM: vendite (iscrizioni) per anno,
-- quante a totale zero, fatturato. Da confrontare riga per riga col report
-- Info4U, sullo STESSO periodo.
SELECT a.Descrizione AS abbonamento,
       YEAR(ai.DataOperazione) AS anno,
       COUNT(*) AS vendite,
       SUM(CASE WHEN ISNULL(ai.Totale, 0) = 0 THEN 1 ELSE 0 END) AS a_zero,
       SUM(ISNULL(ai.Totale, 0)) AS fatturato,
       SUM(CASE WHEN ai.Bloccato = 1 THEN 1 ELSE 0 END) AS bloccate,
       SUM(CASE WHEN ai.Convertito = 1 THEN 1 ELSE 0 END) AS convertite,
       SUM(CASE WHEN ai.DataDisdetta IS NOT NULL THEN 1 ELSE 0 END) AS disdette
FROM dbo.AbbonamentiIscrizione ai
LEFT JOIN dbo.AbbonamentiDurata ad ON ad.IDDurata = ai.IDDurata
LEFT JOIN dbo.Abbonamenti a ON a.IDAbbonamento = ad.IDAbbonamento
WHERE ai.DataOperazione >= '2023-01-01'
  AND a.Descrizione IN (
  N'GOLD UNDER 17', N'GOLD UNDER 13 FAMILY', N'PROMOZIONI', N'GOLD FOR FAMILY*1 TENNIS',
  N'ABBONAMENTO WELFARE AZIENDALE', N'UNDER 30 4M', N'OVER 30 4M', N'UNDER 17 FAMILY',
  N'QUOTA ISCRIZIONE ABBONAMENTI', N'RICORRENTE FLEX GOLD', N'3.1 RONCHIVERDI BUSINESS',
  N'RONCHIVERDI BUSINESS/CONVENZIONE')
GROUP BY a.Descrizione, YEAR(ai.DataOperazione)
ORDER BY abbonamento, anno;

-- ───────────────────────────────────────────────────────────── 4
-- Iscrizioni che il CRM NON può copiare: la sincronizzazione fa INNER JOIN
-- su dbo.Utenti, quindi una vendita con l'utente cancellato o mancante resta
-- fuori. Spiega un CRM con meno righe di Info4U (es. UNDER 30 4M: 8 vs 6).
SELECT a.Descrizione AS abbonamento, COUNT(*) AS iscrizioni_senza_utente
FROM dbo.AbbonamentiIscrizione ai
LEFT JOIN dbo.Utenti u ON u.IDUtente = ai.IDUtente
LEFT JOIN dbo.AbbonamentiDurata ad ON ad.IDDurata = ai.IDDurata
LEFT JOIN dbo.Abbonamenti a ON a.IDAbbonamento = ad.IDAbbonamento
WHERE u.IDUtente IS NULL
  AND ai.DataOperazione >= '2023-01-01'
GROUP BY a.Descrizione
ORDER BY iscrizioni_senza_utente DESC;

-- ───────────────────────────────────────────────────────────── 5
-- Il dettaglio di UNDER 30 4M (Info4U dice 8 movimenti, il CRM ne ha 6):
-- tutte le iscrizioni, con utente e totale, da confrontare una a una.
SELECT ai.IDIscrizione, ai.IDUtente, u.Cognome, u.Nome, ai.DataOperazione, ai.DataInizio, ai.DataFine,
       ai.Totale, ai.ImportoListino, ai.Bloccato, ai.DataDisdetta, ad.Descrizione AS variante
FROM dbo.AbbonamentiIscrizione ai
LEFT JOIN dbo.Utenti u ON u.IDUtente = ai.IDUtente
LEFT JOIN dbo.AbbonamentiDurata ad ON ad.IDDurata = ai.IDDurata
LEFT JOIN dbo.Abbonamenti a ON a.IDAbbonamento = ad.IDAbbonamento
WHERE a.Descrizione = N'UNDER 30 4M'
  AND ai.DataOperazione >= '2023-01-01'
ORDER BY ai.DataOperazione;
