<#
.SYNOPSIS
    Sincronizza le vendite (AbbonamentiIscrizione) da Info4U/TeamSystem
    (dbgym, locale su questo server) verso Supabase: persone + abbonamenti.

.DESCRIPTION
    Idempotente: rieseguirlo non crea duplicati. Il "watermark" — da dove
    riprendere — è MAX(source_iscrizione_id) letto da Supabase stessa, non
    un file locale: se lo script gira su una macchina diversa o si perde lo
    stato locale, riparte comunque dal punto giusto.

    Nessun modulo esterno richiesto: usa solo .NET (System.Data.SqlClient,
    già presente su Windows Server) e Invoke-RestMethod.

.PARAMETER ConfigPath
    Percorso del file di configurazione (vedi config.example.json). Di
    default cerca config.json nella stessa cartella dello script — quel
    file non va mai versionato: contiene la password SQL e la service role
    key di Supabase.
#>

param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot "config.json")
)

$ErrorActionPreference = "Stop"

# Invoke-RestMethod manda di default uno User-Agent che inizia con
# "Mozilla/5.0" (per compatibilità con siti che controllano il browser).
# Supabase pero' rifiuta con 401 l'uso della secret key da richieste che
# sembrano provenire da un browser, e riconosce anche questo User-Agent
# come tale. Il fix e' dichiarare qui, una volta sola, uno User-Agent
# "non da browser" per ogni chiamata Invoke-RestMethod dello script.
$PSDefaultParameterValues["Invoke-RestMethod:UserAgent"] = "sync-info4u-ronchiverdi/1.0"

function Write-Log {
    param([string]$Messaggio, [string]$Livello = "INFO")
    $riga = "{0:yyyy-MM-dd HH:mm:ss} [{1}] {2}" -f (Get-Date), $Livello, $Messaggio
    # Write-Host, non Write-Output: Write-Output finisce nel flusso di
    # output della funzione chiamante — se Send-PersonaUpsert chiama
    # Write-Log e poi "return $idEsistente", il risultato che il chiamante
    # riceve e' un ARRAY [riga di log, idEsistente], non il solo UUID (e'
    # esattamente quello che ha fatto scrivere un array al posto di uno
    # UUID in persona_id). Write-Host stampa a schermo senza toccare
    # l'output della funzione.
    Write-Host $riga
    Add-Content -Path (Join-Path $PSScriptRoot "sync.log") -Value $riga
}

# Il valore "NULL" scritto come testo (non come vero NULL) su Telefono_2 di
# qualche riga di dbgym: senza questa pulizia finiremmo con la parola
# "NULL" scritta nei recapiti delle persone.
function Get-TestoPulito {
    param($Valore)
    if ($null -eq $Valore -or $Valore -is [System.DBNull]) { return $null }
    $testo = [string]$Valore
    $testo = $testo.Trim()
    if ($testo -eq "" -or $testo -eq "NULL") { return $null }
    return $testo
}

function Get-DataPulita {
    param($Valore, [string]$Formato = "yyyy-MM-dd")
    if ($null -eq $Valore -or $Valore -is [System.DBNull]) { return $null }
    return ([datetime]$Valore).ToString($Formato)
}

function Get-IstantePulito {
    param($Valore)
    if ($null -eq $Valore -or $Valore -is [System.DBNull]) { return $null }
    # SQL Server restituisce un datetime "naive" (Kind Unspecified): senza
    # marcarlo come locale, "o" non porta con se' nessun offset di fuso, e
    # Postgres legge la stringa come se fosse gia' UTC - sfalsando l'orario
    # di venduto di due ore (il fuso di Roma in CEST, uno in CET).
    $locale = [datetime]::SpecifyKind([datetime]$Valore, [System.DateTimeKind]::Local)
    return $locale.ToString("o")
}

function Get-NumeroPulito {
    param($Valore)
    if ($null -eq $Valore -or $Valore -is [System.DBNull]) { return $null }
    return [double]$Valore
}

function Get-BoolPulito {
    param($Valore)
    if ($null -eq $Valore -or $Valore -is [System.DBNull]) { return $null }
    return [bool]$Valore
}

# ──────────────────────────────────────────────────────────────── config

if (-not (Test-Path $ConfigPath)) {
    throw "Manca il file di configurazione: $ConfigPath. Copia config.example.json, rinominalo config.json e riempilo."
}
$config = Get-Content $ConfigPath -Raw | ConvertFrom-Json

$batchSize = if ($config.BatchSize) { [int]$config.BatchSize } else { 500 }
$maxBatches = if ($config.MaxBatchesPerRun) { [int]$config.MaxBatchesPerRun } else { 20 }

$supabaseHeaders = @{
    "apikey"        = $config.Supabase.ServiceRoleKey
    "Authorization" = "Bearer $($config.Supabase.ServiceRoleKey)"
    "Content-Type"  = "application/json"
}

# ────────────────────────────────────────────────────── connessione SQL

$connectionString = "Server=$($config.SqlServer.Server),$($config.SqlServer.Port);Database=$($config.SqlServer.Database);User Id=$($config.SqlServer.User);Password=$($config.SqlServer.Password);TrustServerCertificate=True;"

# ──────────────────────────────────────────────────────────── watermark

function Get-UltimoIdSincronizzato {
    $url = "$($config.Supabase.Url)/rest/v1/abbonamenti?select=source_iscrizione_id&order=source_iscrizione_id.desc&limit=1"
    $risposta = Invoke-RestMethod -Uri $url -Headers $supabaseHeaders -Method Get
    if ($risposta.Count -gt 0) { return [int]$risposta[0].source_iscrizione_id }
    return 0
}

# ────────────────────────────────────────────────────────────── upsert

# Il testo di un errore HTTP di PostgREST, sia su PowerShell 5.1 sia 7: la
# prima ha gia' popolato $_.ErrorDetails.Message per una risposta con corpo
# JSON, ma non sempre — quando manca si rilegge lo stream a mano.
function Get-CorpoErrore {
    param($ErroreCatturato)
    if ($ErroreCatturato.ErrorDetails -and $ErroreCatturato.ErrorDetails.Message) {
        return $ErroreCatturato.ErrorDetails.Message
    }
    $risposta = $ErroreCatturato.Exception.Response
    if (-not $risposta) { return "" }
    try {
        $stream = $risposta.GetResponseStream()
        $lettore = New-Object System.IO.StreamReader($stream)
        return $lettore.ReadToEnd()
    }
    catch { return "" }
}

# Se una scrittura verso Supabase fallisce, il corpo esatto mandato si
# salva su file (non in console: per il batch di abbonamenti puo' essere
# grande) — cosi' si vede la riga/il campo preciso incriminato invece di
# ipotizzare alla cieca.
function Invoke-SupabaseScrittura {
    param($Uri, $Headers, $Method, $Corpo)
    # Invoke-RestMethod di Windows PowerShell 5.1, quando -Body e' una
    # STRINGA, la codifica con la codifica di sistema (spesso Windows-1252
    # su una macchina italiana), non UTF-8 — anche se il Content-Type dice
    # "application/json". Con un carattere accentato (es. "Via Cossù") il
    # risultato e' una sequenza di byte non valida in UTF-8, e Postgres la
    # rifiuta come "Empty or invalid json". Passando invece byte UTF-8
    # espliciti, il problema sparisce qualunque sia il testo.
    $corpoUtf8 = [System.Text.Encoding]::UTF8.GetBytes($Corpo)
    try {
        return Invoke-RestMethod -Uri $Uri -Headers $Headers -Method $Method -Body $corpoUtf8
    }
    catch {
        Set-Content -Path (Join-Path $PSScriptRoot "ultimo-corpo-fallito.json") -Value $Corpo -Encoding UTF8
        throw
    }
}

# Upsert di UNA persona. Riga per riga e non in blocco: `persone` ha gia'
# due indici unici da prima di questa sincronizzazione — email e
# cellulare_norm, dalla deduplicazione dei lead del sito (vedi
# scripts/sql/2026-09-02-persone.sql) — e un utente Info4U puo' avere la
# stessa email o lo stesso numero di un contatto che ha gia' scritto dal
# sito. `ON CONFLICT (source_utente_id)` non protegge da quello: Postgres
# alzerebbe comunque una violazione sull'altro indice, e in un upsert
# multi-riga farebbe fallire l'intero batch per una riga sola.
#
# Quindi: prima si prova l'inserimento normale; se va in conflitto su
# email/cellulare invece che su source_utente_id, si cerca la persona che
# gia' li ha e si aggiorna quella, agganciandole il source_utente_id — non
# se ne crea una seconda con gli stessi recapiti.
function Send-PersonaUpsert {
    param($Riga)

    $corpoPersona = [ordered]@{
        source_utente_id    = [int]$Riga.IDUtente
        nome                = Get-TestoPulito $Riga.Nome
        cognome             = Get-TestoPulito $Riga.Cognome
        email               = Get-TestoPulito $Riga.Email
        cellulare           = Get-TestoPulito $Riga.Cellulare
        telefono_1          = Get-TestoPulito $Riga.Telefono_1
        telefono_2          = Get-TestoPulito $Riga.Telefono_2
        codice_fiscale      = Get-TestoPulito $Riga.CodiceFiscale
        data_nascita        = Get-DataPulita $Riga.Data_Nascita
        sesso               = Get-TestoPulito $Riga.Sesso
        indirizzo_via       = Get-TestoPulito $Riga.Indirizzo_Via
        indirizzo_civico    = Get-TestoPulito $Riga.Indirizzo_NumeroCivico
        indirizzo_cap       = Get-TestoPulito $Riga.Indirizzo_CAP
        indirizzo_citta     = Get-TestoPulito $Riga.Indirizzo_Citta
        indirizzo_provincia = Get-TestoPulito $Riga.Indirizzo_PV
        indirizzo_stato     = Get-TestoPulito $Riga.Indirizzo_Stato
        fonte               = "info4u"
    }

    $headers = $supabaseHeaders.Clone()
    $headers["Prefer"] = "resolution=merge-duplicates,return=representation"

    $corpoJson = @($corpoPersona) | ConvertTo-Json -Depth 5

    try {
        $risposta = Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/persone?on_conflict=source_utente_id" `
            -Headers $headers -Method Post -Corpo $corpoJson
        return $risposta[0].id
    }
    catch {
        $corpoErrore = Get-CorpoErrore $_
        if ($corpoErrore -notmatch "duplicate key value violates unique constraint") {
            throw
        }

        Write-Log "IDUtente $($Riga.IDUtente): email/cellulare gia' di un'altra persona, aggancio quella invece di duplicarla." "WARN"

        # Si cerca la persona che gia' possiede l'email o il cellulare: chi
        # dei due ha causato il conflitto non lo sappiamo dal messaggio
        # d'errore, quindi si prova prima l'uno poi l'altro.
        $trovata = $null
        if ($corpoPersona.email) {
            $filtro = "email=eq." + [uri]::EscapeDataString($corpoPersona.email)
            $trovata = Invoke-RestMethod -Uri "$($config.Supabase.Url)/rest/v1/persone?$filtro&select=id" -Headers $supabaseHeaders -Method Get
        }
        if ((-not $trovata -or $trovata.Count -eq 0) -and $corpoPersona.cellulare) {
            $filtro = "cellulare=eq." + [uri]::EscapeDataString($corpoPersona.cellulare)
            $trovata = Invoke-RestMethod -Uri "$($config.Supabase.Url)/rest/v1/persone?$filtro&select=id" -Headers $supabaseHeaders -Method Get
        }
        if (-not $trovata -or $trovata.Count -eq 0) {
            Write-Log "IDUtente $($Riga.IDUtente): non trovo la persona in conflitto, salto l'anagrafica per questa vendita." "WARN"
            return $null
        }

        $idEsistente = $trovata[0].id
        $corpoAggiornamento = $corpoPersona | ConvertTo-Json -Depth 5
        Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/persone?id=eq.$idEsistente" `
            -Headers $supabaseHeaders -Method Patch -Corpo $corpoAggiornamento | Out-Null
        return $idEsistente
    }
}

# Upsert delle persone di un batch, deduplicate per IDUtente: la stessa
# persona puo' comparire piu' volte in un batch di vendite (piu' acquisti,
# stesso utente), e non ha senso interrogare due volte la stessa riga.
function Send-PersoneUpsert {
    param([array]$Righe)

    $mappa = @{}
    foreach ($r in $Righe) {
        $idUtente = [int]$r.IDUtente
        if ($mappa.ContainsKey($idUtente)) { continue }
        $mappa[$idUtente] = Send-PersonaUpsert -Riga $r
    }
    return $mappa
}

function Send-AbbonamentiUpsert {
    param([array]$Righe, [hashtable]$MappaPersone)

    # Le LEFT JOIN su AbbonamentiDurata/Abbonamenti in teoria duplicano una
    # riga di AbbonamentiIscrizione se in dbgym una durata risultasse
    # collegata a piu' di un abbonamento: PostgREST rifiuta un upsert
    # multi-riga che tenta di aggiornare lo stesso source_iscrizione_id due
    # volte nello stesso comando ("ON CONFLICT DO UPDATE command cannot
    # affect row a second time"). Dedup per sicurezza, prima occorrenza vince.
    $visti = @{}
    $abbonamenti = foreach ($r in $Righe) {
        $idIscrizione = [int]$r.IDIscrizione
        if ($visti.ContainsKey($idIscrizione)) { continue }
        $visti[$idIscrizione] = $true

        [ordered]@{
            source_iscrizione_id     = [int]$r.IDIscrizione
            persona_id               = $MappaPersone[[int]$r.IDUtente]
            source_utente_id         = [int]$r.IDUtente
            source_durata_id         = if ($r.IDDurata -is [System.DBNull]) { $null } else { [int]$r.IDDurata }
            source_abbonamento_id    = if ($r.IDAbbonamento -is [System.DBNull]) { $null } else { [int]$r.IDAbbonamento }
            abbonamento              = Get-TestoPulito $r.Abbonamento
            variante                 = Get-TestoPulito $r.Variante
            durata                   = if ($r.Durata -is [System.DBNull]) { $null } else { [int]$r.Durata }
            periodo                  = Get-TestoPulito $r.Periodo
            data_vendita             = Get-IstantePulito $r.DataVendita
            data_inizio              = Get-DataPulita $r.DataInizio
            data_fine                = Get-DataPulita $r.DataFine
            totale                   = Get-NumeroPulito $r.TotaleRegistrato
            importo_listino          = Get-NumeroPulito $r.ImportoListino
            importo_categoria        = Get-NumeroPulito $r.ImportoCategoria
            importo_configurato      = Get-NumeroPulito $r.ImportoConfigurato
            operatore_id             = if ($r.IDOperatore -is [System.DBNull]) { $null } else { [int]$r.IDOperatore }
            operatore_nome           = Get-TestoPulito $r.NomeOperatore
            venditore_id             = if ($r.IDVenditore -is [System.DBNull]) { $null } else { [int]$r.IDVenditore }
            club_id                  = if ($r.IDClub -is [System.DBNull]) { $null } else { [int]$r.IDClub }
            bloccato                 = Get-BoolPulito $r.Bloccato
            convertito               = Get-BoolPulito $r.Convertito
            rinnovo_automatico       = Get-BoolPulito $r.RinnovoAutomatico
            data_disdetta            = Get-DataPulita $r.DataDisdetta
            motivo_disdetta          = Get-TestoPulito $r.MotivoDisdetta
            sconto_id                = if ($r.IDSconto -is [System.DBNull]) { $null } else { [int]$r.IDSconto }
            sconto_durata_id         = if ($r.IDScontoDurata -is [System.DBNull]) { $null } else { [int]$r.IDScontoDurata }
            gg_omaggio               = if ($r.GGOmaggio -is [System.DBNull]) { $null } else { [int]$r.GGOmaggio }
            gg_festivi               = if ($r.GGFestivi -is [System.DBNull]) { $null } else { [int]$r.GGFestivi }
            gg_sospensione           = if ($r.GGsospensione -is [System.DBNull]) { $null } else { [int]$r.GGsospensione }
            data_inizio_sospensione  = Get-DataPulita $r.DataInizioSospensione
            data_fine_sospensione    = Get-DataPulita $r.DataFineSospensione
            note                     = Get-TestoPulito $r.Note
        }
    }
    if (-not $abbonamenti) { return }

    $url = "$($config.Supabase.Url)/rest/v1/abbonamenti?on_conflict=source_iscrizione_id"
    $corpo = $abbonamenti | ConvertTo-Json -Depth 5
    $headers = $supabaseHeaders.Clone()
    $headers["Prefer"] = "resolution=merge-duplicates,return=minimal"

    Invoke-SupabaseScrittura -Uri $url -Headers $headers -Method Post -Corpo $corpo | Out-Null
}

# ─────────────────────────────────────────────────────────────── query

$query = @"
SELECT
    ai.IDIscrizione, ai.IDUtente, ai.IDDurata, ad.IDAbbonamento,
    ai.DataOperazione AS DataVendita,
    u.Nome, u.Cognome, u.Email, u.Telefono_1, u.Telefono_2, u.SMS AS Cellulare,
    u.CodiceFiscale, u.Data_Nascita, u.Sesso,
    u.Indirizzo_Via, u.Indirizzo_NumeroCivico, u.Indirizzo_CAP,
    u.Indirizzo_Citta, u.Indirizzo_PV, u.Indirizzo_Stato,
    a.Descrizione AS Abbonamento, ad.Descrizione AS Variante, ad.Durata, ad.Periodo,
    ai.DataInizio, ai.DataFine,
    ai.Totale AS TotaleRegistrato, ai.ImportoListino, ai.ImportoCategoria,
    ad.Importo AS ImportoConfigurato,
    ai.IDOperatore, ai.NomeOperatore, ai.IDVenditore, ai.IDClub,
    ai.Bloccato, ai.Convertito, ai.RinnovoAutomatico, ai.DataDisdetta, ai.MotivoDisdetta,
    ai.IDSconto, ai.IDScontoDurata,
    ai.GGOmaggio, ai.GGFestivi, ai.GGsospensione,
    ai.DataInizioSospensione, ai.DataFineSospensione,
    ai.Note
FROM dbo.AbbonamentiIscrizione ai
INNER JOIN dbo.Utenti u ON u.IDUtente = ai.IDUtente
LEFT JOIN dbo.AbbonamentiDurata ad ON ad.IDDurata = ai.IDDurata
LEFT JOIN dbo.Abbonamenti a ON a.IDAbbonamento = ad.IDAbbonamento
WHERE ai.IDIscrizione > @LastId
"@

function Get-RigheDaSincronizzare {
    param([int]$LastId, [int]$Top)

    $connessione = New-Object System.Data.SqlClient.SqlConnection $connectionString
    try {
        $connessione.Open()
        $comando = $connessione.CreateCommand()
        # TOP dentro il SELECT vero, non su una sottoquery: una ORDER BY in
        # una derived table senza TOP al suo interno e' un errore in SQL
        # Server ("The ORDER BY clause is invalid in ... derived tables ...
        # unless TOP ... is also specified").
        $comando.CommandText = ($query -replace '^SELECT', "SELECT TOP ($Top)") + "`nORDER BY ai.IDIscrizione ASC"
        $comando.Parameters.AddWithValue("@LastId", $LastId) | Out-Null

        $lettore = $comando.ExecuteReader()
        $tabella = New-Object System.Data.DataTable
        $tabella.Load($lettore)

        # DataRow non espone le colonne come proprieta' via la notazione a
        # punto (es. $riga.Nome) — serve l'indicizzatore $riga["Nome"]; e'
        # proprio questo che ha fatto leggere 0/null ogni singolo campo in
        # tutte le esecuzioni precedenti (source_iscrizione_id, nome,
        # email, tutto). Si converte qui, una volta sola, ogni riga in un
        # vero oggetto PowerShell, cosi' il resto dello script — scritto
        # con la notazione a punto — legge davvero i valori.
        $nomiColonne = @($tabella.Columns | ForEach-Object { $_.ColumnName })
        $righeConvertite = @(foreach ($riga in $tabella.Rows) {
            $oggetto = [ordered]@{}
            foreach ($nome in $nomiColonne) { $oggetto[$nome] = $riga[$nome] }
            [PSCustomObject]$oggetto
        })
        return , $righeConvertite
    }
    finally {
        $connessione.Close()
    }
}

# ─────────────────────────────────────────────────────────────────── run

Write-Log "Avvio sincronizzazione."

try {
    $lastId = Get-UltimoIdSincronizzato
    Write-Log "Watermark di partenza: source_iscrizione_id > $lastId"

    $totaleRighe = 0
    for ($batch = 1; $batch -le $maxBatches; $batch++) {
        $righe = Get-RigheDaSincronizzare -LastId $lastId -Top $batchSize
        if ($righe.Count -eq 0) {
            Write-Log "Nessuna nuova riga: sincronizzazione al passo con la sorgente."
            break
        }

        $mappaPersone = Send-PersoneUpsert -Righe $righe
        Send-AbbonamentiUpsert -Righe $righe -MappaPersone $mappaPersone

        $ultimaRiga = $righe[$righe.Count - 1]
        $lastId = [int]$ultimaRiga.IDIscrizione
        $totaleRighe += $righe.Count
        Write-Log "Batch ${batch}: $($righe.Count) righe, watermark ora a $lastId."

        if ($righe.Count -lt $batchSize) {
            Write-Log "Ultimo batch piu' corto della dimensione richiesta: sincronizzazione al passo."
            break
        }
    }

    Write-Log "Fine: $totaleRighe righe sincronizzate in questa esecuzione."
}
catch {
    # $_.Exception.Message da solo, per un errore HTTP, e' solo "(500)
    # Errore interno del server" — il motivo vero (quale colonna, quale
    # vincolo) sta nel corpo JSON della risposta, che va riletto a parte.
    $corpoErrore = Get-CorpoErrore $_
    if ($corpoErrore) {
        Write-Log "ERRORE: $($_.Exception.Message) — dettaglio: $corpoErrore" "ERROR"
    } else {
        Write-Log "ERRORE: $($_.Exception.Message)" "ERROR"
    }
    exit 1
}
