<#
.SYNOPSIS
    Bonifica le anagrafiche già fuse dalla vecchia deduplicazione per
    email/cellulare (prima di scripts/sql/2026-09-23-dedup-nome-cognome.sql):
    persone con più di un source_utente_id agganciato, che quasi sempre sono
    due iscritti Info4U diversi finiti sulla stessa scheda.

.DESCRIPTION
    Va eseguito da questo stesso server (o da uno con accesso a dbgym): è
    l'unico posto che può ancora rispondere "come si chiamava DAVVERO
    l'utente 12345 di Info4U", perché ogni giro di sync-abbonamenti.ps1
    sovrascrive nome/cognome della scheda fusa con l'ultimo utente
    sincronizzato — Supabase da sola ha perso l'identità originale.

    Per ogni persona con più di un source_utente_id:
      1. Rilegge da dbgym il Nome/Cognome/Email/Cellulare ATTUALE di ciascun
         IDUtente coinvolto (non quello che sta su Supabase, che può essere
         quello sbagliato).
      2. Raggruppa quegli IDUtente in "cluster" con la stessa regola di
         trova_persona_per_nome_e_cellulare: stesso nome+cognome e nessun
         cellulare che si contraddice = stessa persona vera; altrimenti sono
         persone diverse. Il caso comune, verificato sui dati, è un cluster
         per IDUtente (due iscritti diversi); un domani in cui due IDUtente
         risultassero davvero la stessa persona (stesso nome, stesso
         cellulare) finiscono nello stesso cluster e restano uniti.
      3. Il cluster che contiene l'IDUtente più basso TIENE la scheda
         esistente (aggiornata con i suoi dati veri, se sono cambiati). Ogni
         altro cluster ottiene una scheda NUOVA, e gli abbonamenti dei suoi
         IDUtente vengono spostati lì.

    Nessun source_utente_id viene perso: ognuno resta, sempre, agganciato
    (via abbonamenti.persona_id) alla scheda del suo cluster — quella
    esistente o una nuova. È solo la RIPARTIZIONE fra schede a cambiare.

    Di default gira in sola lettura: va passato esplicitamente -Esegui per
    scrivere davvero. Scrive comunque un report CSV di cosa farebbe (o ha
    fatto, con -Esegui): guardalo prima di rilanciare con -Esegui.

.PARAMETER ConfigPath
    Come sync-abbonamenti.ps1: di default config.json in questa cartella.

.PARAMETER Esegui
    Senza questo switch lo script è in sola lettura: legge da dbgym e da
    Supabase, scrive il report CSV, non scrive niente su Supabase.

.PARAMETER SoloPersonaId
    Limita la bonifica a una sola persona (il suo uuid), per provare lo
    script su un caso solo prima di lanciarlo su tutti i 1.422 di oggi.

.PARAMETER ReportPath
    Dove scrivere il CSV col piano (o l'esito, con -Esegui). Di default
    bonifica-fusioni-<data>.csv in questa cartella.
#>

param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot "config.json"),
    [switch]$Esegui,
    [string]$SoloPersonaId,
    [string]$ReportPath
)

$ErrorActionPreference = "Stop"
$PSDefaultParameterValues["Invoke-RestMethod:UserAgent"] = "bonifica-fusioni-ronchiverdi/1.0"
$PSDefaultParameterValues["Invoke-WebRequest:UserAgent"] = "bonifica-fusioni-ronchiverdi/1.0"

# Per leggere pagine grandi da persone_fuse_utenti (1000 righe): ConvertFrom-Json
# su Windows PowerShell 5.1 ha già mostrato più di un comportamento inaffidabile
# su array JSON di questa taglia (righe lette una alla volta, o — come capitato
# qui — l'intera pagina "trasposta" in un solo oggetto con ogni proprietà
# diventata un array di tutti i valori della pagina, invece di un oggetto per
# riga). JavaScriptSerializer non passa dagli PSObject ed è la via più diretta
# per evitare quell'ambiguità: restituisce ArrayList/Dictionary invece di
# oggetti PowerShell.
Add-Type -AssemblyName System.Web.Extensions
$serializerJson = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$serializerJson.MaxJsonLength = [int]::MaxValue
$serializerJson.RecursionLimit = 1000

if (-not $ReportPath) {
    $ReportPath = Join-Path $PSScriptRoot ("bonifica-fusioni-{0:yyyyMMdd-HHmmss}.csv" -f (Get-Date))
}

function Write-Log {
    param([string]$Messaggio, [string]$Livello = "INFO")
    $riga = "{0:yyyy-MM-dd HH:mm:ss} [{1}] {2}" -f (Get-Date), $Livello, $Messaggio
    Write-Host $riga
    Add-Content -Path (Join-Path $PSScriptRoot "bonifica-fusioni.log") -Value $riga
}

function Get-TestoPulito {
    param($Valore)
    if ($null -eq $Valore -or $Valore -is [System.DBNull]) { return $null }
    $testo = ([string]$Valore).Trim()
    if ($testo -eq "" -or $testo -eq "NULL") { return $null }
    return $testo
}

function Get-DataPulita {
    param($Valore, [string]$Formato = "yyyy-MM-dd")
    if ($null -eq $Valore -or $Valore -is [System.DBNull]) { return $null }
    return ([datetime]$Valore).ToString($Formato)
}

# Stessa normalizzazione di normalizza_nome_persona (SQL): minuscolo, spazi
# esterni via, spazi interni multipli ridotti a uno. Deve restare identica a
# quella su Supabase, altrimenti due nomi che il database considera uguali
# questo script li tratterebbe come diversi (o viceversa).
function Get-NomeNormalizzato {
    param([string]$Testo)
    $pulito = Get-TestoPulito $Testo
    if (-not $pulito) { return $null }
    return ($pulito.ToLowerInvariant() -replace '\s+', ' ').Trim()
}

# Stessa normalizzazione di normalizza_cellulare (SQL): solo cifre, via il
# prefisso internazionale, ultime 10 cifre, null se troppo corto.
function Get-CellulareNormalizzato {
    param([string]$Testo)
    $pulito = Get-TestoPulito $Testo
    if (-not $pulito) { return $null }
    $cifre = ($pulito -replace '[^0-9]', '')
    if ($cifre.Length -gt 11 -and $cifre.Substring(0, 4) -eq "0039") {
        $cifre = $cifre.Substring(4)
    }
    elseif ($cifre.Length -gt 10 -and $cifre.Substring(0, 2) -eq "39") {
        $cifre = $cifre.Substring(2)
    }
    if ($cifre.Length -lt 8) { return $null }
    # Come right(v_cifre, 10) in SQL: le ultime 10 cifre, o tutta la stringa
    # se è più corta di 10 (8 o 9 cifre) — a differenza di right(), .Substring
    # lancia un'eccezione con uno start index negativo, quindi va clampato.
    return $cifre.Substring([Math]::Max(0, $cifre.Length - 10))
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

function Invoke-SupabaseScrittura {
    param($Uri, $Headers, $Method, $Corpo)
    $corpoUtf8 = [System.Text.Encoding]::UTF8.GetBytes($Corpo)
    try {
        return Invoke-RestMethod -Uri $Uri -Headers $Headers -Method $Method -Body $corpoUtf8
    }
    catch {
        Write-Log "Scrittura Supabase fallita: $(Get-CorpoErrore $_)" "ERROR"
        throw
    }
}

if (-not (Test-Path $ConfigPath)) {
    throw "Manca il file di configurazione: $ConfigPath (lo stesso di sync-abbonamenti.ps1)."
}
$config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$connectionString = "Server=$($config.SqlServer.Server),$($config.SqlServer.Port);Database=$($config.SqlServer.Database);User Id=$($config.SqlServer.User);Password=$($config.SqlServer.Password);TrustServerCertificate=True;"
$supabaseHeaders = @{
    "apikey"        = $config.Supabase.ServiceRoleKey
    "Authorization" = "Bearer $($config.Supabase.ServiceRoleKey)"
    "Content-Type"  = "application/json"
}

if ($Esegui) {
    Write-Log "Modalità: SCRITTURA (-Esegui). Le modifiche vanno su Supabase per davvero." "WARN"
}
else {
    Write-Log "Modalità: sola lettura (default). Nessuna scrittura su Supabase: solo report in $ReportPath."
}

# ─────────────────────────────────────────── 1. i gruppi fusi, da Supabase

# Il raggruppamento lo fa il database (vista public.persone_fuse_utenti,
# vedi scripts/sql/2026-09-24-persone-fuse-utenti.sql), non piu' questo
# script: leggere tutta abbonamenti (160mila+ righe) qui per raggrupparla a
# mano era lento — centinaia di richieste — e in piu' un problema di come
# Windows PowerShell 5.1 disserializza il JSON faceva tornare pagine di una
# sola riga. La vista restituisce direttamente una riga per gruppo fuso, con
# l'elenco dei source_utente_id gia' in un unico campo array: ~1.422 righe
# invece di 160mila, un paio di richieste invece di centinaia.
#
# La paginazione qui sotto NON si fida della lunghezza del corpo JSON
# ricevuto per capire quando fermarsi: l'offset avanza sempre di
# $dimensionePagina, e il ciclo si ferma solo quando raggiunge il totale
# dichiarato da Postgres nel response header Content-Range (richiesto con
# "Prefer: count=exact") — l'unica fonte affidabile.
#
# Il corpo di ogni pagina lo disserializza JavaScriptSerializer, non
# ConvertFrom-Json: su un array JSON di 1000 righe, ConvertFrom-Json ha
# mostrato più comportamenti inaffidabili su questa versione di PowerShell —
# prima pagine di una sola riga, poi un'intera pagina "trasposta" in un solo
# oggetto con ogni proprietà diventata un array di tutti i valori della
# pagina invece di un oggetto per riga (il sintomo: "Gruppi fusi trovati: 2"
# invece di 1.422, con $personaIdOriginale che nel log risultava una lista
# di UUID invece di uno solo). JavaScriptSerializer restituisce
# ArrayList/Dictionary invece di PSObject e non ha mostrato lo stesso
# problema.
Write-Log "Leggo i gruppi fusi da Supabase (vista persone_fuse_utenti)..."

$gruppiFusi = [System.Collections.Generic.List[PSCustomObject]]::new()
$dimensionePagina = 1000
$scorrimento = 0
$totaleAtteso = -1
$headersLettura = $supabaseHeaders.Clone()
$headersLettura["Prefer"] = "count=exact"

do {
    $filtro = "select=persona_id,source_utente_ids&order=persona_id.asc&limit=$dimensionePagina&offset=$scorrimento"
    if ($SoloPersonaId) { $filtro = "persona_id=eq.$SoloPersonaId&$filtro" }
    $risposta = Invoke-WebRequest -UseBasicParsing -Uri "$($config.Supabase.Url)/rest/v1/persone_fuse_utenti?$filtro" -Headers $headersLettura -Method Get
    $pagina = @($serializerJson.DeserializeObject($risposta.Content))

    foreach ($r in $pagina) {
        $idPersona = [string]$r["persona_id"]
        $idUtenti = @($r["source_utente_ids"] | ForEach-Object { [int]$_ })
        if ($idUtenti.Count -eq 0) { continue }
        $gruppiFusi.Add([PSCustomObject]@{ PersonaId = $idPersona; IdUtenti = $idUtenti })
    }

    $contentRange = [string]$risposta.Headers["Content-Range"]
    if ($contentRange -match '/(\d+)$') {
        $totaleAtteso = [int]$Matches[1]
    }
    else {
        # Senza un Content-Range valido non c'è modo affidabile di sapere
        # quando fermarsi: meglio interrompere qui che rischiare un altro
        # giro che non termina mai.
        Write-Log "Risposta senza Content-Range valido ('$contentRange'), mi fermo qui." "ERROR"
        break
    }

    $scorrimento += $dimensionePagina
    Write-Log ("  ...{0} di {1} gruppi letti." -f [Math]::Min($scorrimento, $totaleAtteso), $totaleAtteso)
} while ($scorrimento -lt $totaleAtteso)

$totaleGruppi = $gruppiFusi.Count
Write-Log "Gruppi fusi trovati: $totaleGruppi."
if ($totaleAtteso -ge 0 -and $totaleGruppi -ne $totaleAtteso) {
    Write-Log "ATTENZIONE: Supabase dichiarava $totaleAtteso gruppi ma ne ho raccolti $totaleGruppi — controlla il log per righe saltate o duplicate." "WARN"
}

if ($totaleGruppi -eq 0) {
    Write-Log "Niente da bonificare."
    return
}

# ────────────────────────────────────────────────── 2. report + esecuzione

$report = [System.Collections.Generic.List[PSCustomObject]]::new()
$connessione = New-Object System.Data.SqlClient.SqlConnection $connectionString
$connessione.Open()

try {
    $numeroGruppo = 0
    foreach ($gruppo in $gruppiFusi) {
        $numeroGruppo++
        $personaIdOriginale = $gruppo.PersonaId
        $idUtenti = @($gruppo.IdUtenti)
        Write-Log "[$numeroGruppo/$totaleGruppi] Persona $personaIdOriginale — $($idUtenti.Count) IDUtente: $($idUtenti -join ', ')"

        # 2a. Il dato VERO di ciascun IDUtente, da dbgym — non da Supabase,
        # che per questo gruppo ha già perso l'identità di tutti tranne
        # l'ultimo sincronizzato.
        $elencoId = ($idUtenti -join ",")
        $comando = $connessione.CreateCommand()
        $comando.CommandText = @"
SELECT IDUtente, Nome, Cognome, Email, Telefono_1, Telefono_2, SMS AS Cellulare,
       CodiceFiscale, Data_Nascita, Sesso,
       Indirizzo_Via, Indirizzo_NumeroCivico, Indirizzo_CAP, Indirizzo_Citta, Indirizzo_PV, Indirizzo_Stato
FROM dbo.Utenti
WHERE IDUtente IN ($elencoId)
"@
        $lettore = $comando.ExecuteReader()
        $tabella = New-Object System.Data.DataTable
        $tabella.Load($lettore)

        $datiUtenti = @{}  # IDUtente -> dati veri
        foreach ($riga in $tabella.Rows) {
            $idUtente = [int]$riga["IDUtente"]
            $datiUtenti[$idUtente] = [PSCustomObject]@{
                IDUtente            = $idUtente
                Nome                = Get-TestoPulito $riga["Nome"]
                Cognome             = Get-TestoPulito $riga["Cognome"]
                Email               = Get-TestoPulito $riga["Email"]
                Cellulare           = Get-TestoPulito $riga["Cellulare"]
                Telefono_1          = Get-TestoPulito $riga["Telefono_1"]
                Telefono_2          = Get-TestoPulito $riga["Telefono_2"]
                CodiceFiscale       = Get-TestoPulito $riga["CodiceFiscale"]
                DataNascita         = Get-DataPulita $riga["Data_Nascita"]
                Sesso               = Get-TestoPulito $riga["Sesso"]
                IndirizzoVia        = Get-TestoPulito $riga["Indirizzo_Via"]
                IndirizzoCivico     = Get-TestoPulito $riga["Indirizzo_NumeroCivico"]
                IndirizzoCap        = Get-TestoPulito $riga["Indirizzo_CAP"]
                IndirizzoCitta      = Get-TestoPulito $riga["Indirizzo_Citta"]
                IndirizzoProvincia  = Get-TestoPulito $riga["Indirizzo_PV"]
                IndirizzoStato      = Get-TestoPulito $riga["Indirizzo_Stato"]
                NomeNorm            = Get-NomeNormalizzato $riga["Nome"]
                CognomeNorm         = Get-NomeNormalizzato $riga["Cognome"]
                CellulareNorm       = Get-CellulareNormalizzato $riga["Cellulare"]
            }
        }
        $lettore.Close()

        # Un IDUtente scomparso da dbgym nel frattempo (raro): non si può
        # recuperare il suo nome vero, resta nel suo cluster da solo con i
        # soli dati che aveva già Supabase.
        foreach ($id in $idUtenti) {
            if (-not $datiUtenti.ContainsKey($id)) {
                Write-Log "  IDUtente $id non trovato in dbgym: uso solo i dati già su Supabase (nessun aggiornamento del nome)." "WARN"
                $datiUtenti[$id] = [PSCustomObject]@{ IDUtente = $id; Nome = $null; Cognome = $null; Email = $null; Cellulare = $null; NomeNorm = $null; CognomeNorm = $null; CellulareNorm = $null }
            }
        }

        # 2b. Cluster: stessa regola di trova_persona_per_nome_e_cellulare —
        # stesso nome+cognome e nessun cellulare che si contraddice = stesso
        # cluster. O(n²) sugli IDUtente di UN gruppo (tipicamente 2-3): va
        # benissimo.
        $rimasti = [System.Collections.Generic.List[object]]::new()
        $idUtenti | Sort-Object | ForEach-Object { $rimasti.Add($datiUtenti[$_]) }
        $cluster = [System.Collections.Generic.List[System.Collections.Generic.List[object]]]::new()

        while ($rimasti.Count -gt 0) {
            $capofila = $rimasti[0]
            $rimasti.RemoveAt(0)
            $gruppoCluster = [System.Collections.Generic.List[object]]::new()
            $gruppoCluster.Add($capofila)

            $daSpostare = [System.Collections.Generic.List[object]]::new()
            foreach ($altro in $rimasti) {
                $stessoNome = $capofila.NomeNorm -and $capofila.NomeNorm -eq $altro.NomeNorm -and $capofila.CognomeNorm -eq $altro.CognomeNorm
                if (-not $stessoNome) { continue }
                $cellulareContrastante = $capofila.CellulareNorm -and $altro.CellulareNorm -and ($capofila.CellulareNorm -ne $altro.CellulareNorm)
                if ($cellulareContrastante) { continue }
                $daSpostare.Add($altro)
            }
            foreach ($m in $daSpostare) {
                $gruppoCluster.Add($m)
                $rimasti.Remove($m) | Out-Null
            }
            $cluster.Add($gruppoCluster)
        }

        Write-Log "  -> $($cluster.Count) persona/e distinta/e in questo gruppo."

        # Il cluster con l'IDUtente più basso tiene la scheda esistente.
        $clusterOrdinati = $cluster | Sort-Object { ($_ | ForEach-Object { $_.IDUtente } | Measure-Object -Minimum).Minimum }
        $idUtenteTenuto = ($clusterOrdinati[0] | Sort-Object IDUtente | Select-Object -First 1).IDUtente

        for ($i = 0; $i -lt $clusterOrdinati.Count; $i++) {
            $membriCluster = $clusterOrdinati[$i]
            $canonico = $membriCluster | Sort-Object IDUtente | Select-Object -First 1
            $idUtentiCluster = ($membriCluster | ForEach-Object { $_.IDUtente }) -join ","
            $tienePersonaEsistente = ($i -eq 0)

            $riga = [PSCustomObject]@{
                persona_id_originale   = $personaIdOriginale
                cluster_indice         = $i + 1
                cluster_totale         = $clusterOrdinati.Count
                id_utenti_cluster      = $idUtentiCluster
                id_utente_canonico     = $canonico.IDUtente
                nome_canonico          = $canonico.Nome
                cognome_canonico       = $canonico.Cognome
                email_canonico         = $canonico.Email
                cellulare_canonico     = $canonico.Cellulare
                tiene_persona_esistente = $tienePersonaEsistente
                persona_id_destinazione = $null
                esito                  = if ($Esegui) { "" } else { "solo report" }
            }

            if (-not $Esegui) {
                $riga.persona_id_destinazione = if ($tienePersonaEsistente) { $personaIdOriginale } else { "(nuova)" }
                $report.Add($riga)
                continue
            }

            try {
                if ($tienePersonaEsistente -and -not $canonico.Nome) {
                    # L'IDUtente canonico non è più in dbgym (vedi sopra): non
                    # si scrive niente sopra la scheda esistente piuttosto che
                    # azzerarne il nome buono con dati che non ci sono più.
                    $riga.persona_id_destinazione = $personaIdOriginale
                    $riga.esito = "lasciata invariata (IDUtente canonico non trovato in dbgym)"
                    $report.Add($riga)
                    continue
                }

                if ($tienePersonaEsistente) {
                    $corpoAggiornamento = @{
                        nome                = $canonico.Nome
                        cognome             = $canonico.Cognome
                        email               = $canonico.Email
                        cellulare           = $canonico.Cellulare
                        telefono_1          = $canonico.Telefono_1
                        telefono_2          = $canonico.Telefono_2
                        codice_fiscale      = $canonico.CodiceFiscale
                        data_nascita        = $canonico.DataNascita
                        sesso               = $canonico.Sesso
                        indirizzo_via       = $canonico.IndirizzoVia
                        indirizzo_civico    = $canonico.IndirizzoCivico
                        indirizzo_cap       = $canonico.IndirizzoCap
                        indirizzo_citta     = $canonico.IndirizzoCitta
                        indirizzo_provincia = $canonico.IndirizzoProvincia
                        indirizzo_stato     = $canonico.IndirizzoStato
                        source_utente_id    = $canonico.IDUtente
                    } | ConvertTo-Json
                    Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/persone?id=eq.$personaIdOriginale" `
                        -Headers $supabaseHeaders -Method Patch -Corpo $corpoAggiornamento | Out-Null
                    $riga.persona_id_destinazione = $personaIdOriginale
                    $riga.esito = "aggiornata"
                }
                else {
                    $corpoNuovaTabella = @{
                        nome                = $canonico.Nome
                        cognome             = $canonico.Cognome
                        email               = $canonico.Email
                        cellulare           = $canonico.Cellulare
                        telefono_1          = $canonico.Telefono_1
                        telefono_2          = $canonico.Telefono_2
                        codice_fiscale      = $canonico.CodiceFiscale
                        data_nascita        = $canonico.DataNascita
                        sesso               = $canonico.Sesso
                        indirizzo_via       = $canonico.IndirizzoVia
                        indirizzo_civico    = $canonico.IndirizzoCivico
                        indirizzo_cap       = $canonico.IndirizzoCap
                        indirizzo_citta     = $canonico.IndirizzoCitta
                        indirizzo_provincia = $canonico.IndirizzoProvincia
                        indirizzo_stato     = $canonico.IndirizzoStato
                        source_utente_id    = $canonico.IDUtente
                        fonte               = "info4u"
                        storico             = $false
                        note                = "Separata da bonifica-fusioni.ps1 il $(Get-Date -Format 'yyyy-MM-dd'): prima condivideva la scheda $personaIdOriginale con IDUtente $idUtenteTenuto."
                    }
                    $corpoNuova = @($corpoNuovaTabella) | ConvertTo-Json -Depth 5
                    $headers = $supabaseHeaders.Clone()
                    $headers["Prefer"] = "return=representation"
                    $nuovaRisposta = Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/persone" `
                        -Headers $headers -Method Post -Corpo $corpoNuova
                    $nuovaPersonaId = $nuovaRisposta[0].id

                    # Sposta gli abbonamenti di QUESTO cluster (e solo di
                    # questo) sulla nuova scheda — mai una DELETE, solo un
                    # persona_id diverso.
                    $filtroSourceIn = ($membriCluster | ForEach-Object { $_.IDUtente }) -join ","
                    $corpoSposta = @{ persona_id = $nuovaPersonaId } | ConvertTo-Json
                    Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/abbonamenti?persona_id=eq.$personaIdOriginale&source_utente_id=in.($filtroSourceIn)" `
                        -Headers $supabaseHeaders -Method Patch -Corpo $corpoSposta | Out-Null

                    $riga.persona_id_destinazione = $nuovaPersonaId
                    $riga.esito = "creata e abbonamenti spostati"
                }
            }
            catch {
                $riga.esito = "ERRORE: $(Get-CorpoErrore $_)"
                Write-Log "  Errore sul cluster $($i + 1) di $personaIdOriginale`: $($riga.esito)" "ERROR"
            }

            $report.Add($riga)
        }
    }
}
finally {
    $connessione.Close()
}

$report | Export-Csv -Path $ReportPath -NoTypeInformation -Encoding UTF8
Write-Log "Report scritto in $ReportPath ($($report.Count) righe)."

if (-not $Esegui) {
    Write-Log "Questo era un giro di sola lettura. Controlla il CSV, poi rilancia con -Esegui per scrivere davvero (magari prima con -SoloPersonaId su un caso solo)."
}
