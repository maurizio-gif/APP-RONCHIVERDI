/*
  Esplorazione della struttura di dbgym (Info4U). Da lanciare in SSMS su
  SRVTEAMSYSTEM, database dbgym. SOLO LETTURE: nessun INSERT/UPDATE/DELETE.
  I blocchi sono indipendenti: lanciali uno alla volta (seleziona + F5) e
  incolla qui il risultato (o esporta in CSV: tasto destro sulla griglia ->
  "Salva risultati con nome").

  Obiettivo: capire dove stanno anagrafiche, transazioni (incassi, rate,
  storni), accessi e il resto, oltre a quello che il sync legge già.
  Le tabelle già note: AbbonamentiIscrizione, AbbonamentiDurata, Abbonamenti,
  AbbonamentiCategorie, AbbonamentiMacroCategorie, AbbonamentiPagamenti,
  CassaMovimenti, Utenti, Operatori.
*/
USE dbgym;
GO

-- ───────────────────────────────────────────────────────────── A
-- Tutte le tabelle con numero di righe e ultima modifica della struttura.
-- Dà la mappa del database: le più grandi sono quasi sempre i movimenti.
SELECT s.name AS schema_name, t.name AS tabella,
       SUM(p.rows) AS righe, t.create_date, t.modify_date
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
GROUP BY s.name, t.name, t.create_date, t.modify_date
ORDER BY righe DESC;

-- ───────────────────────────────────────────────────────────── B
-- Viste e stored procedure: spesso contengono già i join giusti.
SELECT s.name AS schema_name, o.name, o.type_desc, o.modify_date
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE o.type IN ('V', 'P', 'FN', 'IF', 'TF')
  AND o.is_ms_shipped = 0
ORDER BY o.type_desc, o.name;

-- ───────────────────────────────────────────────────────────── C
-- Tutte le colonne di tutte le tabelle (può essere lungo: esporta in CSV).
SELECT t.name AS tabella, c.column_id AS pos, c.name AS colonna,
       ty.name AS tipo, c.max_length, c.is_nullable
FROM sys.tables t
JOIN sys.columns c ON c.object_id = t.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
ORDER BY t.name, c.column_id;

-- ───────────────────────────────────────────────────────────── D
-- Chiavi esterne dichiarate: i collegamenti ufficiali fra le tabelle.
SELECT fk.name AS fk, tp.name AS tabella_figlia, cp.name AS colonna_figlia,
       tr.name AS tabella_padre, cr.name AS colonna_padre
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.tables tp ON tp.object_id = fkc.parent_object_id
JOIN sys.columns cp ON cp.object_id = tp.object_id AND cp.column_id = fkc.parent_column_id
JOIN sys.tables tr ON tr.object_id = fkc.referenced_object_id
JOIN sys.columns cr ON cr.object_id = tr.object_id AND cr.column_id = fkc.referenced_column_id
ORDER BY tp.name, fk.name;

-- ───────────────────────────────────────────────────────────── E
-- Se le FK non ci sono (capita nei gestionali), i collegamenti si deducono
-- dai nomi: colonne ID* che compaiono in più tabelle.
SELECT c.name AS colonna, COUNT(*) AS in_quante_tabelle,
       STRING_AGG(t.name, ', ') WITHIN GROUP (ORDER BY t.name) AS tabelle
FROM sys.tables t
JOIN sys.columns c ON c.object_id = t.object_id
WHERE c.name LIKE 'ID%'
GROUP BY c.name
HAVING COUNT(*) > 1
ORDER BY in_quante_tabelle DESC, c.name;

-- ───────────────────────────────────────────────────────────── F
-- Tabelle candidate per tema, cercate per nome (tabelle e colonne).
SELECT t.name AS tabella, c.name AS colonna, ty.name AS tipo
FROM sys.tables t
JOIN sys.columns c ON c.object_id = t.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE t.name LIKE '%Cassa%' OR t.name LIKE '%Pagam%' OR t.name LIKE '%Movim%'
   OR t.name LIKE '%Fattur%' OR t.name LIKE '%Ricev%' OR t.name LIKE '%Incass%'
   OR t.name LIKE '%Access%' OR t.name LIKE '%Ingress%' OR t.name LIKE '%Presen%'
   OR t.name LIKE '%Corso%' OR t.name LIKE '%Prenot%' OR t.name LIKE '%Appunt%'
   OR t.name LIKE '%Certific%' OR t.name LIKE '%Medic%' OR t.name LIKE '%Carnet%'
   OR t.name LIKE '%Prodott%' OR t.name LIKE '%Articol%' OR t.name LIKE '%Vendit%'
   OR t.name LIKE '%Utent%' OR t.name LIKE '%Anagraf%' OR t.name LIKE '%Cliente%'
ORDER BY t.name, c.column_id;

-- ───────────────────────────────────────────────────────────── G
-- Anagrafica: colonne e 5 righe di esempio di Utenti. ATTENZIONE: contiene
-- dati personali, non incollare nomi/CF/telefoni reali: oscura prima, o
-- lancia solo la prima SELECT (le colonne).
SELECT c.column_id AS pos, c.name AS colonna, ty.name AS tipo, c.max_length, c.is_nullable
FROM sys.columns c
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.Utenti')
ORDER BY c.column_id;

-- Per ogni colonna di Utenti: quante righe la valorizzano (come è popolata).
DECLARE @sql nvarchar(max) = N'SELECT COUNT(*) AS totale';
SELECT @sql += N', SUM(CASE WHEN ' + QUOTENAME(c.name) + N' IS NOT NULL THEN 1 ELSE 0 END) AS ' + QUOTENAME(c.name)
FROM sys.columns c
WHERE c.object_id = OBJECT_ID('dbo.Utenti')
  AND c.system_type_id NOT IN (34, 35, 99, 241); -- esclude image/text/ntext/xml
SET @sql += N' FROM dbo.Utenti;';
EXEC sp_executesql @sql;

-- ───────────────────────────────────────────────────────────── H
-- Transazioni: struttura e volumi di CassaMovimenti e AbbonamentiPagamenti.
SELECT 'CassaMovimenti' AS tabella, c.name AS colonna, ty.name AS tipo, c.is_nullable
FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.CassaMovimenti')
UNION ALL
SELECT 'AbbonamentiPagamenti', c.name, ty.name, c.is_nullable
FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.AbbonamentiPagamenti');

-- Movimenti di cassa per anno e mese: volumi, importi e storni.
SELECT YEAR(DataOperazione) AS anno, MONTH(DataOperazione) AS mese,
       COUNT(*) AS movimenti, SUM(Importo) AS importo,
       SUM(CASE WHEN IDCassaMovimentoStorno IS NOT NULL THEN 1 ELSE 0 END) AS storni
FROM dbo.CassaMovimenti
GROUP BY YEAR(DataOperazione), MONTH(DataOperazione)
ORDER BY anno DESC, mese DESC;

-- Movimenti senza vendita collegata (incassi non da abbonamento: bar, shop,
-- corsi...?). Dice se la cassa contiene più di quello che il CRM vede.
SELECT COUNT(*) AS movimenti_senza_iscrizione, SUM(Importo) AS importo
FROM dbo.CassaMovimenti
WHERE IDIscrizione IS NULL;

-- ───────────────────────────────────────────────────────────── I
-- Valori distinti nelle colonne "tipo/causale/metodo" di CassaMovimenti,
-- per capire i codici (contanti, carta, POS, rate, storno...).
SELECT c.name AS colonna
FROM sys.columns c
WHERE c.object_id = OBJECT_ID('dbo.CassaMovimenti')
  AND (c.name LIKE '%Tipo%' OR c.name LIKE '%Caus%' OR c.name LIKE '%Metod%'
    OR c.name LIKE '%Modal%' OR c.name LIKE '%Stato%' OR c.name LIKE 'ID%');
-- Poi, per ogni colonna trovata, per esempio:
--   SELECT <colonna>, COUNT(*) FROM dbo.CassaMovimenti GROUP BY <colonna> ORDER BY 2 DESC;

-- ───────────────────────────────────────────────────────────── L
-- Definizione di viste e procedure esistenti (se il blocco B ne ha trovate):
--   SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.<nome>'));
