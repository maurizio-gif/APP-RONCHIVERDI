/*
  Analisi di fattibilità di un database Info4U (o simile): quali tabelle
  hanno dati, quanti, di quando, e se sono ancora VIVE.

  Da lanciare in SSMS sul server, sul database del gestionale (qui `dbgym`).
  SOLO LETTURE e solo metadati/date: non restituisce nomi, importi né altri
  dati personali, quindi il risultato si può esportare o incollare.

  Perché la «vitalità» è il dato che conta: in Ronchiverdi due tabelle
  chiamate Sospensioni sono ferme da marzo 2025, e il nome da solo fa credere
  che contengano il dato attuale. Qui per ogni tabella si calcola l'ultima
  data (ignorando date nel futuro, tipiche di anni digitati male) e quante
  righe sono degli ultimi 12 mesi.

  Come lavora: legge il catalogo di sistema, sceglie per ogni tabella la
  colonna data più plausibile (Operazione, Inizio, Data...), e ne ricava
  prima data, ultima data e righe recenti. Con READ UNCOMMITTED, per non
  bloccare il gestionale. Salta le tabelle sopra i 20 milioni di righe.
  Su un database di qualche centinaio di tabelle ci mette di solito da
  qualche decina di secondi a pochi minuti: meglio fuori orario di punta.
*/
USE dbgym;
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

IF OBJECT_ID('tempdb..#esito') IS NOT NULL DROP TABLE #esito;
CREATE TABLE #esito (
    tabella sysname,
    righe bigint,
    colonne int,
    colonne_personali int,
    colonna_data sysname NULL,
    prima_data datetime NULL,
    ultima_data datetime NULL,
    righe_ultimi_12_mesi bigint NULL,
    errore nvarchar(200) NULL
);

-- Tutte le tabelle dello schema dbo, con righe, colonne e quante colonne
-- sembrano dati personali (per sapere dove serve attenzione GDPR).
INSERT #esito (tabella, righe, colonne, colonne_personali)
SELECT t.name,
       SUM(p.rows),
       (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = t.object_id),
       (SELECT COUNT(*) FROM sys.columns c
         WHERE c.object_id = t.object_id
           AND (c.name LIKE '%Cognome%' OR c.name LIKE '%Email%' OR c.name LIKE '%Mail%'
             OR c.name LIKE '%Telefon%' OR c.name LIKE '%Cellular%' OR c.name LIKE '%Cod%Fisc%'
             OR c.name LIKE '%Indirizzo%' OR c.name LIKE '%Nascita%' OR c.name LIKE '%IBAN%'
             OR c.name LIKE '%NomeUtente%'))
FROM sys.tables t
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
WHERE t.schema_id = SCHEMA_ID('dbo')
GROUP BY t.object_id, t.name;

DECLARE @t sysname, @c sysname, @sql nvarchar(max);
DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
    SELECT e.tabella,
           (SELECT TOP 1 c.name
              FROM sys.columns c
              JOIN sys.types ty ON ty.user_type_id = c.user_type_id
             WHERE c.object_id = OBJECT_ID('dbo.' + QUOTENAME(e.tabella))
               AND ty.name IN ('datetime', 'datetime2', 'smalldatetime', 'date')
             ORDER BY CASE WHEN c.name LIKE '%Operazion%' THEN 0
                           WHEN c.name LIKE '%Inizio%' THEN 1
                           WHEN c.name LIKE 'Data%' THEN 2
                           WHEN c.name LIKE '%Data%' THEN 3
                           ELSE 4 END, c.column_id)
      FROM #esito e
     WHERE e.righe > 0 AND e.righe <= 20000000;

OPEN cur;
FETCH NEXT FROM cur INTO @t, @c;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF @c IS NOT NULL
    BEGIN
        -- La data massima ignora il futuro, la minima le date impossibili
        -- (1900, 0001...): un anno digitato male non deve falsare la vitalità.
        SET @sql = N'UPDATE #esito SET colonna_data = @c, prima_data = x.mn, ultima_data = x.mx, righe_ultimi_12_mesi = x.n12
                     FROM (SELECT MIN(CASE WHEN ' + QUOTENAME(@c) + N' >= ''1990-01-01'' THEN ' + QUOTENAME(@c) + N' END) AS mn,
                                  MAX(CASE WHEN ' + QUOTENAME(@c) + N' <= GETDATE() THEN ' + QUOTENAME(@c) + N' END) AS mx,
                                  SUM(CASE WHEN ' + QUOTENAME(@c) + N' >= DATEADD(MONTH, -12, GETDATE())
                                            AND ' + QUOTENAME(@c) + N' <= GETDATE() THEN 1 ELSE 0 END) AS n12
                             FROM dbo.' + QUOTENAME(@t) + N') x
                     WHERE tabella = @t';
        BEGIN TRY
            EXEC sp_executesql @sql, N'@c sysname, @t sysname', @c = @c, @t = @t;
        END TRY
        BEGIN CATCH
            UPDATE #esito SET errore = LEFT(ERROR_MESSAGE(), 200) WHERE tabella = @t;
        END CATCH
    END
    FETCH NEXT FROM cur INTO @t, @c;
END
CLOSE cur;
DEALLOCATE cur;

-- Il risultato: per ambito, con la vitalità. «ambito» è un'ipotesi dal nome
-- della tabella (da confermare guardando le colonne), non una certezza.
SELECT
    CASE
        WHEN tabella LIKE '%Cassa%' OR tabella LIKE '%Pagam%' OR tabella LIKE '%Ricev%' OR tabella LIKE '%Fattur%'
          OR tabella LIKE '%Buon%' OR tabella LIKE '%Incass%' OR tabella LIKE '%Movim%'          THEN '1 Incassi e documenti'
        WHEN tabella LIKE '%Access%' OR tabella LIKE '%Ingress%' OR tabella LIKE '%Presen%'
          OR tabella LIKE '%Tornell%' OR tabella LIKE '%Passag%'                                 THEN '2 Accessi e frequenza'
        WHEN tabella LIKE '%Corso%' OR tabella LIKE '%Corsi%' OR tabella LIKE '%Prenot%'
          OR tabella LIKE '%Lezion%' OR tabella LIKE '%Campo%' OR tabella LIKE '%Agenda%'
          OR tabella LIKE '%Istrutt%' OR tabella LIKE '%Appunt%' OR tabella LIKE '%Event%'       THEN '3 Corsi e prenotazioni'
        WHEN tabella LIKE '%Abbonam%' OR tabella LIKE '%Iscriz%' OR tabella LIKE '%Sospens%'
          OR tabella LIKE '%Rinnov%' OR tabella LIKE '%Carnet%'                                  THEN '4 Abbonamenti'
        WHEN tabella LIKE '%Utent%' OR tabella LIKE '%Anagraf%' OR tabella LIKE '%Client%'
          OR tabella LIKE '%Aziend%' OR tabella LIKE '%Famigl%' OR tabella LIKE '%Convenz%'      THEN '5 Anagrafica e aziende'
        WHEN tabella LIKE '%Operator%' OR tabella LIKE '%Staff%' OR tabella LIKE '%Dipend%'
          OR tabella LIKE '%Turn%' OR tabella LIKE '%Cartellin%'                                 THEN '6 Personale'
        WHEN tabella LIKE '%Certific%' OR tabella LIKE '%Medic%' OR tabella LIKE '%Visit%'       THEN '7 Salute e certificati'
        WHEN tabella LIKE '%Sconto%' OR tabella LIKE '%Promo%' OR tabella LIKE '%Listin%'
          OR tabella LIKE '%Prodott%' OR tabella LIKE '%Articol%' OR tabella LIKE '%Magazz%'
          OR tabella LIKE '%Shop%' OR tabella LIKE '%Borsell%'                                   THEN '8 Listino, shop e borsellino'
        WHEN tabella LIKE '%Log%' OR tabella LIKE '%Audit%' OR tabella LIKE '%Storic%'
          OR tabella LIKE '%Cronolog%'                                                           THEN '9 Log e storico'
        ELSE '10 Altro'
    END AS ambito,
    tabella,
    righe,
    righe_ultimi_12_mesi,
    colonna_data,
    CONVERT(varchar(10), prima_data, 120) AS prima_data,
    CONVERT(varchar(10), ultima_data, 120) AS ultima_data,
    CASE WHEN ultima_data IS NULL THEN 'senza data'
         WHEN ultima_data >= DATEADD(DAY, -90, GETDATE()) THEN 'viva'
         WHEN ultima_data >= DATEADD(MONTH, -12, GETDATE()) THEN 'rallentata'
         ELSE 'ferma' END AS stato,
    colonne,
    colonne_personali,
    errore
FROM #esito
WHERE righe > 0
ORDER BY ambito, ultima_data DESC, righe DESC;
