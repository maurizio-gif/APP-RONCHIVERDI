/*
  Dov'è il luogo di nascita in Info4U?

  Il sync (sync-abbonamenti.ps1) legge da Utenti CodiceFiscale, Data_Nascita e
  Sesso, ma non il luogo di nascita, che il tesseramento CSI richiede
  (scripts/sql/2026-10-29-tesseramento-csi.sql). Questo script cerca dove
  sta, senza dare per scontato né il nome della colonna né la tabella: il
  gestionale ha una tabella Utenti e altre «Utenti...» (anamnesi, dati
  aggiuntivi), e il luogo potrebbe essere in una di quelle, oppure come
  codice che rimanda a una tabella di comuni.

  Da lanciare in SSMS sul server, database `dbgym`. SOLO LETTURE e solo
  metadati e conteggi: non restituisce nomi, cognomi né altri dati personali
  dei soci (al massimo i comuni più frequenti, che sono nomi di città), quindi
  il risultato si può incollare in chat. READ UNCOMMITTED, per non bloccare
  il gestionale.

  I blocchi A-E sono indipendenti: lancia tutto insieme, oppure uno alla volta
  (seleziona + F5). Il blocco C e il D possono richiedere qualche decina di
  secondi su una tabella Utenti grande.

  Cosa mi serve indietro: i risultati dei blocchi A, C, D ed E (B solo se A
  non trova nulla).
*/
USE dbgym;
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

-- ───────────────────────────────────────────────────────────── A
-- Ogni colonna del database il cui nome fa pensare a un luogo di nascita.
-- Se qui compare una tabella con una colonna tipo «LuogoNascita»,
-- «ComuneNascita», «Nascita_Luogo» o «Nascita_Comune», è lei.
SELECT t.name AS tabella, c.name AS colonna, ty.name AS tipo, c.max_length,
       (SELECT SUM(p.rows) FROM sys.partitions p
         WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)) AS righe
FROM sys.columns c
JOIN sys.tables t  ON t.object_id = c.object_id
JOIN sys.types  ty ON ty.user_type_id = c.user_type_id
WHERE t.schema_id = SCHEMA_ID('dbo')
  AND (   c.name LIKE '%Nascit%'  OR c.name LIKE '%Luogo%'   OR c.name LIKE '%Natal%'
       OR c.name LIKE '%Birth%'   OR c.name LIKE '%Catast%'  OR c.name LIKE '%Belfiore%'
       OR c.name LIKE '%Cittadin%' OR c.name LIKE '%Nazion%' OR c.name LIKE '%Comune%'
       OR c.name LIKE '%Provincia%')
ORDER BY t.name, c.column_id;

-- ───────────────────────────────────────────────────────────── B
-- Tutte le colonne delle tabelle «Utenti...»: serve solo se il blocco A non
-- trova nulla, per leggere a occhio che nomi ha usato il gestionale.
SELECT t.name AS tabella, c.column_id AS pos, c.name AS colonna, ty.name AS tipo, c.max_length
FROM sys.columns c
JOIN sys.tables t  ON t.object_id = c.object_id
JOIN sys.types  ty ON ty.user_type_id = c.user_type_id
WHERE t.schema_id = SCHEMA_ID('dbo') AND t.name LIKE 'Utenti%'
ORDER BY t.name, c.column_id;

-- ───────────────────────────────────────────────────────────── C
-- Le colonne candidate (testo o numero, nome da luogo di nascita) e quante
-- righe le hanno compilate: una colonna che esiste ma è sempre vuota non
-- serve a niente.
IF OBJECT_ID('tempdb..#cand') IS NOT NULL DROP TABLE #cand;
SELECT t.name AS tabella, c.name AS colonna, ty.name AS tipo
INTO #cand
FROM sys.columns c
JOIN sys.tables t  ON t.object_id = c.object_id
JOIN sys.types  ty ON ty.user_type_id = c.user_type_id
WHERE t.schema_id = SCHEMA_ID('dbo')
  AND ty.name IN ('varchar', 'nvarchar', 'char', 'nchar', 'int', 'smallint', 'bigint', 'tinyint')
  AND (   c.name LIKE '%Nascit%' OR c.name LIKE '%Luogo%' OR c.name LIKE '%Natal%'
       OR c.name LIKE '%Birth%'  OR c.name LIKE '%Catast%' OR c.name LIKE '%Belfiore%'
       OR c.name LIKE '%Cittadin%' OR c.name LIKE '%Nazion%')
  AND c.name NOT LIKE 'Data%Nascita%';       -- la data già la leggiamo

IF OBJECT_ID('tempdb..#riempimento') IS NOT NULL DROP TABLE #riempimento;
CREATE TABLE #riempimento (tabella sysname, colonna sysname, tipo sysname, righe bigint, compilate bigint, errore nvarchar(200) NULL);

DECLARE @t sysname, @c sysname, @ty sysname, @sql nvarchar(max);
DECLARE cur CURSOR LOCAL FAST_FORWARD FOR SELECT tabella, colonna, tipo FROM #cand;
OPEN cur;
FETCH NEXT FROM cur INTO @t, @c, @ty;
WHILE @@FETCH_STATUS = 0
BEGIN
    BEGIN TRY
        SET @sql = N'INSERT #riempimento (tabella, colonna, tipo, righe, compilate)
            SELECT @t, @c, @ty, COUNT_BIG(*),
                   SUM(CASE WHEN ' + QUOTENAME(@c) + N' IS NOT NULL
                             AND LTRIM(RTRIM(CAST(' + QUOTENAME(@c) + N' AS nvarchar(200)))) NOT IN (N'''', N''0'')
                            THEN 1 ELSE 0 END)
            FROM dbo.' + QUOTENAME(@t);
        EXEC sp_executesql @sql, N'@t sysname, @c sysname, @ty sysname', @t = @t, @c = @c, @ty = @ty;
    END TRY
    BEGIN CATCH
        INSERT #riempimento (tabella, colonna, tipo, righe, compilate, errore)
        VALUES (@t, @c, @ty, NULL, NULL, LEFT(ERROR_MESSAGE(), 200));
    END CATCH
    FETCH NEXT FROM cur INTO @t, @c, @ty;
END
CLOSE cur; DEALLOCATE cur;

SELECT tabella, colonna, tipo, righe, compilate,
       CAST(100.0 * compilate / NULLIF(righe, 0) AS decimal(5, 1)) AS percentuale_compilata, errore
FROM #riempimento
ORDER BY compilate DESC;

-- ───────────────────────────────────────────────────────────── D
-- I 10 valori più frequenti di ogni colonna candidata compilata: se sono
-- nomi di comuni (MILANO, TORINO...) è il luogo di nascita; se sono numeri
-- piccoli è un codice che rimanda a una tabella di comuni (blocco E).
IF OBJECT_ID('tempdb..#valori') IS NOT NULL DROP TABLE #valori;
CREATE TABLE #valori (tabella sysname, colonna sysname, valore nvarchar(100), n bigint);

DECLARE cur2 CURSOR LOCAL FAST_FORWARD FOR
    SELECT tabella, colonna FROM #riempimento WHERE compilate > 0 AND errore IS NULL;
OPEN cur2;
FETCH NEXT FROM cur2 INTO @t, @c;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'INSERT #valori (tabella, colonna, valore, n)
        SELECT TOP 10 @t, @c, CAST(' + QUOTENAME(@c) + N' AS nvarchar(100)), COUNT_BIG(*)
        FROM dbo.' + QUOTENAME(@t) + N'
        WHERE ' + QUOTENAME(@c) + N' IS NOT NULL
          AND LTRIM(RTRIM(CAST(' + QUOTENAME(@c) + N' AS nvarchar(200)))) NOT IN (N'''', N''0'')
        GROUP BY CAST(' + QUOTENAME(@c) + N' AS nvarchar(100))
        ORDER BY COUNT_BIG(*) DESC';
    EXEC sp_executesql @sql, N'@t sysname, @c sysname', @t = @t, @c = @c;
    FETCH NEXT FROM cur2 INTO @t, @c;
END
CLOSE cur2; DEALLOCATE cur2;

SELECT tabella, colonna, valore, n FROM #valori ORDER BY tabella, colonna, n DESC;

-- ───────────────────────────────────────────────────────────── E
-- Tabelle di decodifica (comuni, città, nazioni, province): se il luogo di
-- nascita è un codice, il nome sta in una di queste.
SELECT t.name AS tabella, SUM(p.rows) AS righe,
       STUFF((SELECT TOP 8 ', ' + c.name FROM sys.columns c
               WHERE c.object_id = t.object_id ORDER BY c.column_id FOR XML PATH('')), 1, 2, '') AS prime_colonne
FROM sys.tables t
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
WHERE t.schema_id = SCHEMA_ID('dbo')
  AND (   t.name LIKE '%Comun%' OR t.name LIKE '%Citta%' OR t.name LIKE '%Città%'
       OR t.name LIKE '%Nazion%' OR t.name LIKE '%Provinc%'
       OR t.name LIKE '%Catast%')
GROUP BY t.object_id, t.name
ORDER BY righe DESC;

/*
  Quando la colonna è trovata (esempio: Utenti.Luogo_Nascita), il sync va
  esteso in sync-abbonamenti.ps1 (le due SELECT che leggono u.CodiceFiscale e
  il corpo `corpoPersona`) e in bonifica-fusioni.ps1, e `persone.luogo_nascita`
  deve esistere nel database (scripts/sql/2026-10-29-tesseramento-csi.sql).
  Se invece il luogo è un codice, serve anche il join con la tabella di
  decodifica del blocco E.
*/
