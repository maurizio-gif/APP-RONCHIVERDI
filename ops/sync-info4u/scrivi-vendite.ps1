<#
.SYNOPSIS
    Scrive verso Info4U/TeamSystem (dbgym, locale su questo server) le
    vendite accodate da un front-end esterno su Supabase (vendite_esterne) —
    il percorso inverso di sync-abbonamenti.ps1.

.DESCRIPTION
    Legge da vendite_esterne le righe con stato = 'in_attesa', trova in
    dbgym la persona a cui appartengono (per codice fiscale, poi email, poi
    cellulare) e crea la vendita in dbo.AbbonamentiIscrizione. Segna ogni
    riga 'scritto' (con l'IDIscrizione assegnato) o 'errore' (con il
    motivo) — non la ritenta da sola: una riga in errore resta lì per la
    verifica manuale, va rimessa a 'in_attesa' a mano dopo aver risolto il
    problema (persona creata in Info4U, IDDurata corretto...).

    Una volta scritta, la vendita rientra in Supabase per la strada
    normale: sync-abbonamenti.ps1 la ritrova in Info4U al giro successivo e
    popola `persone`/`abbonamenti` — questo script non le tocca.

    PRIMA DI SCHEDULARLO IN PRODUZIONE:
      - Verifica con SQL Server Management Studio che dbo.AbbonamentiIscrizione
        non abbia altre colonne NOT NULL oltre a quelle che questo script
        valorizza (l'elenco qui sotto viene da sync-abbonamenti.ps1, che le
        LEGGE tutte — ma una colonna con un DEFAULT lato SQL potrebbe non
        comparire mai in una SELECT e comunque bloccare un INSERT che non la
        passa). Il modo più sicuro: prova un INSERT a mano dentro una
        transazione e fai ROLLBACK, prima di lanciare questo script sul serio.
      - Questo script NON crea persone nuove in dbo.Utenti: se la persona
        della vendita non esiste ancora in Info4U, la riga finisce in
        errore ("persona non trovata") invece di tentare un INSERT su una
        tabella di cui non conosciamo tutti i vincoli. Va creata a mano in
        Info4U prima di far ripartire quella riga.
      - Il front-end che accoda le vendite deve conoscere l'IDDurata vero
        di Info4U del prodotto venduto (source_durata_id): oggi non esiste
        ancora una sincronizzazione in lettura del catalogo
        Abbonamenti/AbbonamentiDurata verso Supabase che gliel'offra, va
        mappato a mano finché non la costruiamo.

.PARAMETER ConfigPath
    Stesso config.json di sync-abbonamenti.ps1 (vedi config.example.json),
    esteso con il blocco "SqlServerScrittura" — un login SQL SEPARATO da
    quello di sola lettura, con permesso di scrittura solo su
    dbo.AbbonamentiIscrizione: non serve dare a questo script gli stessi
    permessi ampi del sync in lettura.
#>

param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot "config.json")
)

$ErrorActionPreference = "Stop"

$PSDefaultParameterValues["Invoke-RestMethod:UserAgent"] = "scrivi-vendite-ronchiverdi/1.0"

function Write-Log {
    param([string]$Messaggio, [string]$Livello = "INFO")
    $riga = "{0:yyyy-MM-dd HH:mm:ss} [{1}] {2}" -f (Get-Date), $Livello, $Messaggio
    Write-Host $riga
    Add-Content -Path (Join-Path $PSScriptRoot "scrivi-vendite.log") -Value $riga
}

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

# ──────────────────────────────────────────────────────────────── config

if (-not (Test-Path $ConfigPath)) {
    throw "Manca il file di configurazione: $ConfigPath. Copia config.example.json, rinominalo config.json e riempilo."
}
$config = Get-Content $ConfigPath -Raw | ConvertFrom-Json

if (-not $config.SqlServerScrittura) {
    throw "Manca il blocco SqlServerScrittura in $ConfigPath — vedi config.example.json e il README."
}
if (-not $config.IDClub) {
    throw "Manca IDClub in $ConfigPath: la vendita in dbo.AbbonamentiIscrizione ha bisogno di sapere a quale club Info4U assegnarla."
}

$maxRigheOgniGiro = if ($config.MaxRigheOgniGiro) { [int]$config.MaxRigheOgniGiro } else { 50 }

$supabaseHeaders = @{
    "apikey"        = $config.Supabase.ServiceRoleKey
    "Authorization" = "Bearer $($config.Supabase.ServiceRoleKey)"
    "Content-Type"  = "application/json"
}

# Connessione di sola lettura (stessa di sync-abbonamenti.ps1): serve solo
# per trovare l'IDUtente della persona che ha comprato, non per scrivere.
$connectionStringLettura = "Server=$($config.SqlServer.Server),$($config.SqlServer.Port);Database=$($config.SqlServer.Database);User Id=$($config.SqlServer.User);Password=$($config.SqlServer.Password);TrustServerCertificate=True;"

# Connessione di SCRITTURA: login separato, permessi minimi (vedi README —
# in pratica solo INSERT su dbo.AbbonamentiIscrizione, non db_datawriter).
$connectionStringScrittura = "Server=$($config.SqlServerScrittura.Server),$($config.SqlServerScrittura.Port);Database=$($config.SqlServerScrittura.Database);User Id=$($config.SqlServerScrittura.User);Password=$($config.SqlServerScrittura.Password);TrustServerCertificate=True;"

# ────────────────────────────────────────────────────────────── Supabase

function Get-VenditeInAttesa {
    param([int]$Limite)
    $url = "$($config.Supabase.Url)/rest/v1/vendite_esterne?stato=eq.in_attesa&order=creato_il.asc&limit=$Limite"
    return @(Invoke-RestMethod -Uri $url -Headers $supabaseHeaders -Method Get)
}

function Set-VenditaScritta {
    param([string]$Id, [int]$IdIscrizione, [int]$IdUtente)
    $corpo = @{
        stato                 = "scritto"
        source_iscrizione_id  = $IdIscrizione
        source_utente_id      = $IdUtente
        errore                = $null
        processato_il         = (Get-Date).ToString("o")
    } | ConvertTo-Json
    Invoke-RestMethod -Uri "$($config.Supabase.Url)/rest/v1/vendite_esterne?id=eq.$Id" `
        -Headers $supabaseHeaders -Method Patch -Body ([System.Text.Encoding]::UTF8.GetBytes($corpo)) | Out-Null
}

function Set-VenditaInErrore {
    param([string]$Id, [string]$Motivo)
    # Il motivo puo' contenere l'errore SQL per intero: troncato, altrimenti
    # un messaggio anomalo potrebbe superare la lunghezza che PostgREST
    # accetta in un singolo campo della richiesta.
    $motivoTroncato = if ($Motivo.Length -gt 2000) { $Motivo.Substring(0, 2000) } else { $Motivo }
    $corpo = @{
        stato         = "errore"
        errore        = $motivoTroncato
        processato_il = (Get-Date).ToString("o")
    } | ConvertTo-Json
    Invoke-RestMethod -Uri "$($config.Supabase.Url)/rest/v1/vendite_esterne?id=eq.$Id" `
        -Headers $supabaseHeaders -Method Patch -Body ([System.Text.Encoding]::UTF8.GetBytes($corpo)) | Out-Null
}

# ────────────────────────────────────────────────────────────────── dbgym

# Trova l'IDUtente in Info4U per la persona di questa vendita: prima per
# codice fiscale (il piu' affidabile), poi email, poi cellulare (colonna
# SMS, stesso campo che sync-abbonamenti.ps1 legge come "Cellulare") — nello
# stesso ordine di priorita' con cui un operatore umano li controllerebbe.
# Nessuna creazione qui: vedi il PRIMA DI SCHEDULARLO in cima al file.
function Find-IdUtente {
    param($Connessione, $Vendita)

    $candidati = @(
        @{ Colonna = "CodiceFiscale"; Valore = $Vendita.codice_fiscale },
        @{ Colonna = "Email"; Valore = $Vendita.email },
        @{ Colonna = "SMS"; Valore = $Vendita.cellulare }
    )

    foreach ($candidato in $candidati) {
        if (-not $candidato.Valore) { continue }

        $comando = $Connessione.CreateCommand()
        $comando.CommandText = "SELECT TOP (1) IDUtente FROM dbo.Utenti WHERE $($candidato.Colonna) = @Valore"
        $comando.Parameters.AddWithValue("@Valore", $candidato.Valore) | Out-Null
        $trovato = $comando.ExecuteScalar()

        if ($null -ne $trovato -and $trovato -isnot [System.DBNull]) {
            return [int]$trovato
        }
    }

    return $null
}

# INSERT in dbo.AbbonamentiIscrizione. Colonne limitate a quelle che
# sync-abbonamenti.ps1 legge gia' (quindi sappiamo per certo che esistono) e
# di cui conosciamo il valore giusto per una vendita online:
#   - ImportoListino/ImportoCategoria restano fuori: non sappiamo il prezzo
#     di listino separato da quanto e' stato davvero incassato, e scrivere
#     un numero indovinato sarebbe peggio che lasciarlo vuoto. Totale (quanto
#     e' stato pagato per davvero) e' l'unico importo che possiamo affermare.
#   - IDOperatore/IDVenditore restano NULL: non c'e' un operatore umano
#     dietro una vendita online. NomeOperatore lo dice esplicitamente, per
#     chi guarda la vendita da dentro Info4U.
function New-AbbonamentoIscrizione {
    param($Connessione, $Vendita, [int]$IdUtente)

    $comando = $Connessione.CreateCommand()
    $comando.CommandText = @"
INSERT INTO dbo.AbbonamentiIscrizione
    (IDUtente, IDDurata, DataOperazione, DataInizio, DataFine, Totale, NomeOperatore, IDClub, Bloccato, Note)
OUTPUT INSERTED.IDIscrizione
VALUES
    (@IDUtente, @IDDurata, @DataOperazione, @DataInizio, @DataFine, @Totale, @NomeOperatore, @IDClub, 0, @Note)
"@
    $comando.Parameters.AddWithValue("@IDUtente", $IdUtente) | Out-Null
    $comando.Parameters.AddWithValue("@IDDurata", [int]$Vendita.source_durata_id) | Out-Null
    $comando.Parameters.AddWithValue("@DataOperazione", [datetime]$Vendita.data_vendita) | Out-Null
    $comando.Parameters.AddWithValue("@DataInizio", $(if ($Vendita.data_inizio) { [datetime]$Vendita.data_inizio } else { [DBNull]::Value })) | Out-Null
    $comando.Parameters.AddWithValue("@DataFine", $(if ($Vendita.data_fine) { [datetime]$Vendita.data_fine } else { [DBNull]::Value })) | Out-Null
    $comando.Parameters.AddWithValue("@Totale", [double]$Vendita.totale) | Out-Null
    $comando.Parameters.AddWithValue("@NomeOperatore", "Vendita online ($($Vendita.origine))") | Out-Null
    $comando.Parameters.AddWithValue("@IDClub", [int]$config.IDClub) | Out-Null
    $comando.Parameters.AddWithValue("@Note", $(if ($Vendita.note) { [string]$Vendita.note } else { [DBNull]::Value })) | Out-Null

    return [int]$comando.ExecuteScalar()
}

# ─────────────────────────────────────────────────────────────────── run

Write-Log "Avvio scrittura vendite esterne."

try {
    $vendite = Get-VenditeInAttesa -Limite $maxRigheOgniGiro
    if ($vendite.Count -eq 0) {
        Write-Log "Nessuna vendita in attesa."
        exit 0
    }
    Write-Log "$($vendite.Count) vendite in attesa da scrivere."

    $connessioneLettura = New-Object System.Data.SqlClient.SqlConnection $connectionStringLettura
    $connessioneScrittura = New-Object System.Data.SqlClient.SqlConnection $connectionStringScrittura
    $connessioneLettura.Open()
    $connessioneScrittura.Open()

    $scritte = 0
    $inErrore = 0

    try {
        foreach ($vendita in $vendite) {
            try {
                $idUtente = Find-IdUtente -Connessione $connessioneLettura -Vendita $vendita

                if (-not $idUtente) {
                    Set-VenditaInErrore -Id $vendita.id `
                        -Motivo "Persona non trovata in Info4U (codice fiscale/email/cellulare senza corrispondenza): va creata in Info4U prima di rimettere questa riga in attesa."
                    Write-Log "Vendita $($vendita.id) ($($vendita.origine)/$($vendita.riferimento_esterno)): persona non trovata in Info4U." "WARN"
                    $inErrore++
                    continue
                }

                $idIscrizione = New-AbbonamentoIscrizione -Connessione $connessioneScrittura -Vendita $vendita -IdUtente $idUtente
                Set-VenditaScritta -Id $vendita.id -IdIscrizione $idIscrizione -IdUtente $idUtente
                Write-Log "Vendita $($vendita.id) ($($vendita.origine)/$($vendita.riferimento_esterno)): scritta come IDIscrizione $idIscrizione (IDUtente $idUtente)."
                $scritte++
            }
            catch {
                $dettaglio = $_.Exception.Message
                Set-VenditaInErrore -Id $vendita.id -Motivo $dettaglio
                Write-Log "Vendita $($vendita.id) ($($vendita.origine)/$($vendita.riferimento_esterno)): ERRORE — $dettaglio" "ERROR"
                $inErrore++
            }
        }
    }
    finally {
        $connessioneLettura.Close()
        $connessioneScrittura.Close()
    }

    Write-Log "Fine: $scritte scritte, $inErrore in errore."
}
catch {
    $corpoErrore = Get-CorpoErrore $_
    if ($corpoErrore) {
        Write-Log "ERRORE: $($_.Exception.Message) — dettaglio: $corpoErrore" "ERROR"
    } else {
        Write-Log "ERRORE: $($_.Exception.Message)" "ERROR"
    }
    exit 1
}
