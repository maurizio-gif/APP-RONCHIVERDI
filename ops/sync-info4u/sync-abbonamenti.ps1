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

# Il watermark su IDIscrizione (sopra) intercetta solo le vendite NUOVE: una
# vendita gia' sincronizzata che in Info4U riceve poi una sospensione (sposta
# DataFine in avanti), una disdetta, o una correzione, resta silenziosamente
# ferma alla versione vista la prima volta — lo script non ripassa mai su un
# IDIscrizione sotto il watermark. Il refresh periodico piu' sotto
# (Get-RigheAperteDaSincronizzare) rimedia riprocessando, ogni tot ore, tutte
# le vendite ancora "aperte" secondo Info4U in quel momento (non secondo la
# nostra copia, che potrebbe essere proprio quella non aggiornata).
$refreshApertiOgniOre = if ($config.RefreshApertiOgniOre) { [double]$config.RefreshApertiOgniOre } else { 20 }
$refreshApertiGiorniIndietro = if ($config.RefreshApertiGiorniIndietro) { [int]$config.RefreshApertiGiorniIndietro } else { 400 }
$maxBatchesRefreshAperti = if ($config.MaxBatchesRefreshAperti) { [int]$config.MaxBatchesRefreshAperti } else { 50 }

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

# Quando e' stato fatto l'ultimo refresh delle vendite aperte — a differenza
# del watermark sopra non e' un MAX() su una colonna di abbonamenti, quindi
# vive nella sua tabellina di stato (vedi 2026-09-21-sync-info4u-stato.sql),
# non sul disco locale: stesso motivo per cui il watermark principale non e'
# un file, se lo script gira su un'altra macchina non riparte da zero.
function Get-UltimoRefreshAperti {
    $url = "$($config.Supabase.Url)/rest/v1/sync_info4u_stato?chiave=eq.refresh_aperti&select=valore"
    $risposta = Invoke-RestMethod -Uri $url -Headers $supabaseHeaders -Method Get
    if ($risposta.Count -gt 0) { return [datetime]$risposta[0].valore }
    return $null
}

function Set-UltimoRefreshAperti {
    param([datetime]$Quando)
    $corpo = @{ chiave = "refresh_aperti"; valore = $Quando.ToString("o") } | ConvertTo-Json
    $headers = $supabaseHeaders.Clone()
    $headers["Prefer"] = "resolution=merge-duplicates"
    Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/sync_info4u_stato?on_conflict=chiave" `
        -Headers $headers -Method Post -Corpo $corpo | Out-Null
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

# Upsert di UNA persona. Riga per riga e non in blocco: la deduplicazione
# (passo 2 sotto) e' una lettura seguita da una scrittura, e non si puo'
# comporre in un batch senza rischiare due IDUtente nuovi con lo stesso nome,
# nello stesso batch, che si "mancano" a vicenda e finiscono su due righe
# quando dovevano finire sulla stessa (o viceversa).
#
# REGOLA: un contatto di fonte diversa da 'info4u' non si tocca MAI. Nome,
# cognome, email e cellulare sono il dato che quella persona ha dato, non un
# campo da "correggere" con quello che dice Info4U.
#
# La chiave di deduplicazione e' nome+cognome, col cellulare a disambiguare
# gli omonimi (vedi scripts/sql/2026-09-23-dedup-nome-cognome.sql) — non piu'
# email o cellulare da soli: due iscritti Info4U DIVERSI possono condividere
# un indirizzo di famiglia o un numero di casa, e usarli come chiave univoca
# fondeva le loro schede in una sola (verificato sui dati: 1.422 schede
# risultavano cosi', il 90% con periodi di abbonamento sovrapposti — cioe'
# erano soci contemporaneamente, non la stessa persona ritesserata).
#
# Quindi, per ogni IDUtente:
#   1. Si cerca PRIMA la sua eventuale riga gia' sincronizzata
#      (source_utente_id, univoco): se esiste, e' sempre quella — a
#      prescindere da nome o cellulare, che nel frattempo possono essere
#      davvero cambiati. Si aggiorna solo quella, escludendo dal corpo il
#      campo lasciato vuoto l'ultima volta per un conflitto (vedi
#      conflitto_campo) — altrimenti l'update ripeterebbe lo stesso valore
#      in conflitto e fallirebbe di nuovo, identico, ogni 5 minuti.
#   2. Se non esiste, la deduplicazione per nome+cognome/cellulare la fa
#      trova_o_crea_persona su Supabase — la STESSA funzione che usano il
#      form del sito e l'agenda della segreteria, cosi' le tre strade non
#      possono divergere silenziosamente:
#        - se la riga che restituisce e' 'info4u' (nuova, o un omonimo
#          Info4U il cui cellulare coincide), ci si scrive sopra tutto il
#          corpo, come sempre;
#        - se e' di un'altra fonte (sito, Guest Register, inserimento a
#          mano), quella riga non si tocca: si crea una scheda separata per
#          questo IDUtente, con un puntatore (conflitto_con_persona_id /
#          conflitto_campo = 'nome_cognome', vedi
#          scripts/sql/2026-09-22-persone-conflitto-info4u.sql) alla persona
#          che porta davvero quel nome — la scheda di entrambe lo segnala
#          con un link, la decisione se unirle resta a uno staff. A
#          differenza di prima non c'e' nessun campo da omettere
#          nell'inserimento: con la chiave nome+cognome due persone possono
#          avere davvero lo stesso indirizzo o lo stesso numero, quindi si
#          scrivono entrambi.
function Send-PersonaUpsert {
    param($Riga)

    # Un hashtable normale, non [ordered]: serve solo a costruire il corpo
    # JSON (l'ordine delle chiavi non conta per Supabase) e più sotto viene
    # clonato con .Clone() — metodo che su un OrderedDictionary PowerShell
    # non riesce a richiamare ("non contiene un metodo denominato 'Clone'").
    $corpoPersona = @{
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

    # Passo 1: questo IDUtente ha gia' una sua riga? In tal caso si aggiorna
    # solo quella — mai un inserimento nuovo per un IDUtente gia' noto, che
    # violerebbe l'unicita' di source_utente_id.
    $filtroUtente = "source_utente_id=eq.$([int]$Riga.IDUtente)"
    $propria = Invoke-RestMethod -Uri "$($config.Supabase.Url)/rest/v1/persone?$filtroUtente&select=id,conflitto_campo" `
        -Headers $supabaseHeaders -Method Get

    if ($propria -and $propria.Count -gt 0) {
        $corpoAggiornamento = $corpoPersona.Clone()
        if ($propria[0].conflitto_campo) {
            $corpoAggiornamento.Remove($propria[0].conflitto_campo)
        }
        $corpoJson = $corpoAggiornamento | ConvertTo-Json -Depth 5
        Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/persone?id=eq.$($propria[0].id)" `
            -Headers $supabaseHeaders -Method Patch -Corpo $corpoJson | Out-Null
        return $propria[0].id
    }

    # Passo 2: IDUtente nuovo. La deduplicazione vera e propria (nome+cognome,
    # cellulare a disambiguare gli omonimi) e' dentro trova_o_crea_persona:
    # qui si chiama solo la funzione e si guarda cosa ha restituito.
    $corpoRpc = @{
        p_nome              = $corpoPersona.nome
        p_cognome           = $corpoPersona.cognome
        p_email             = $corpoPersona.email
        p_cellulare         = $corpoPersona.cellulare
        p_fonte             = "info4u"
        p_source_utente_id  = [int]$Riga.IDUtente
    } | ConvertTo-Json

    $idTrovato = Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/rpc/trova_o_crea_persona" `
        -Headers $supabaseHeaders -Method Post -Corpo $corpoRpc

    if (-not $idTrovato) {
        # Null vuol dire una cosa sola: Nome vuoto (non dovrebbe succedere per
        # un utente Info4U, ma la funzione lo esclude per sicurezza — vedi
        # trova_o_crea_persona). Nessuna riga su cui agganciare la vendita.
        Write-Log "IDUtente $($Riga.IDUtente): trova_o_crea_persona non ha restituito un id (nome mancante), salto l'anagrafica per questa vendita." "WARN"
        return $null
    }

    $rigaTrovata = Invoke-RestMethod -Uri "$($config.Supabase.Url)/rest/v1/persone?id=eq.$idTrovato&select=id,fonte" `
        -Headers $supabaseHeaders -Method Get
    if (-not $rigaTrovata -or $rigaTrovata.Count -eq 0) {
        Write-Log "IDUtente $($Riga.IDUtente): riga $idTrovato non trovata subito dopo trova_o_crea_persona, salto l'anagrafica per questa vendita." "WARN"
        return $null
    }

    if ($rigaTrovata[0].fonte -eq "info4u") {
        # Riga di Info4U (nuova, o un omonimo Info4U il cui cellulare
        # coincide): ci si scrive sopra tutto il corpo, come sempre.
        $corpoJson = $corpoPersona | ConvertTo-Json -Depth 5
        Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/persone?id=eq.$idTrovato" `
            -Headers $supabaseHeaders -Method Patch -Corpo $corpoJson | Out-Null
        return $idTrovato
    }

    # Nome e cognome sono di un contatto nato altrove (sito, Guest Register,
    # inserimento a mano): quella riga non si tocca. Si crea una scheda
    # separata per questo IDUtente, con un puntatore a chi porta davvero
    # quel nome, cosi' la scheda di entrambe puo' segnalarlo con un link —
    # vedi persone_conflitto_con_idx.
    Write-Log "IDUtente $($Riga.IDUtente): nome e cognome gia' di un contatto non-Info4U (persona $idTrovato), creo una scheda separata invece di scriverci sopra." "WARN"

    $corpoSeparato = $corpoPersona.Clone()
    $corpoSeparato["conflitto_con_persona_id"] = $idTrovato
    $corpoSeparato["conflitto_campo"] = "nome_cognome"

    $headers = $supabaseHeaders.Clone()
    $headers["Prefer"] = "return=representation"
    $corpoSeparatoJson = @($corpoSeparato) | ConvertTo-Json -Depth 5
    $rispostaSeparata = Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/persone" `
        -Headers $headers -Method Post -Corpo $corpoSeparatoJson
    return $rispostaSeparata[0].id
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
            # Qualunque riga arrivi qui e' stata appena letta da una query
            # live su Info4U: per definizione esiste ancora la', quindi ogni
            # upsert normale azzera un'eventuale cancellato_il messo da un
            # giro precedente di Compare-CancellazioniOrigine (caso raro:
            # una vendita segnata cancellata che poi ricompare).
            cancellato_il            = $null
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

# Senza WHERE: la stessa SELECT/JOIN serve sia al giro incrementale (nuove
# vendite) sia al refresh periodico delle vendite ancora aperte (sotto) — un
# solo posto dove tenere allineato l'elenco colonne, invece di due query che
# possono scivolare fuori sincrono fra loro.
$querySelectBase = @"
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
"@

# Esegue una query su dbgym e restituisce le righe gia' convertite in
# PSCustomObject. Fattorizzata perche' sia il giro incrementale sia il
# refresh delle vendite aperte ne hanno bisogno, identica in tutto tranne il
# testo della query e i parametri.
function Invoke-QueryDbgym {
    param([string]$CommandText, [hashtable]$Parametri)

    $connessione = New-Object System.Data.SqlClient.SqlConnection $connectionString
    try {
        $connessione.Open()
        $comando = $connessione.CreateCommand()
        $comando.CommandText = $CommandText
        foreach ($nome in $Parametri.Keys) {
            $comando.Parameters.AddWithValue($nome, $Parametri[$nome]) | Out-Null
        }

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

function Get-RigheDaSincronizzare {
    param([int]$LastId, [int]$Top)

    # TOP dentro il SELECT vero, non su una sottoquery: una ORDER BY in una
    # derived table senza TOP al suo interno e' un errore in SQL Server
    # ("The ORDER BY clause is invalid in ... derived tables ... unless
    # TOP ... is also specified").
    $comandoText = ($querySelectBase -replace '^SELECT', "SELECT TOP ($Top)") +
        "`nWHERE ai.IDIscrizione > @LastId`nORDER BY ai.IDIscrizione ASC"

    return Invoke-QueryDbgym -CommandText $comandoText -Parametri @{ "@LastId" = $LastId }
}

# Rilegge le vendite ancora "aperte" (DataFine null o non troppo nel
# passato) secondo Info4U IN QUESTO MOMENTO — non secondo la copia che
# abbiamo su Supabase, che e' proprio quella potenzialmente ferma a prima di
# una sospensione/disdetta/correzione tardiva (vedi commento sul watermark
# piu' sopra). @LastId qui non e' un watermark persistente: pagina solo
# all'interno di UN giro di refresh, riparte da 0 al prossimo.
function Get-RigheAperteDaSincronizzare {
    param([int]$LastId, [int]$Top, [datetime]$Soglia)

    $comandoText = ($querySelectBase -replace '^SELECT', "SELECT TOP ($Top)") +
        "`nWHERE ai.IDIscrizione > @LastId AND (ai.DataFine IS NULL OR ai.DataFine >= @Soglia)`nORDER BY ai.IDIscrizione ASC"

    return Invoke-QueryDbgym -CommandText $comandoText -Parametri @{ "@LastId" = $LastId; "@Soglia" = $Soglia }
}

# Una vendita gia' sincronizzata puo' anche sparire del tutto da Info4U — un
# operatore la annulla/cancella dopo che il giro dei 5 minuti l'ha gia'
# scritta su Supabase. Nessuna query per IDIscrizione la ripesca piu' (non
# c'e' nessun ID nuovo da confrontare), quindi qui si fa il percorso
# inverso: si prendono gli ID che SECONDO SUPABASE risultano ancora aperti,
# e si controlla quali di quegli ID esistono ancora in Info4U — quelli che
# non ci sono piu' vengono segnati cancellato_il (mai una DELETE, vedi
# 2026-09-21-abbonamenti-cancellati.sql). Va di pari passo con il refresh
# sopra: stessa soglia, stessa cadenza, cosi' un ID che e' semplicemente
# uscito dalla finestra "aperta" per una disdetta legittima (non cancellato,
# solo chiuso prima) viene comunque aggiornato correttamente li' prima di
# arrivare qui.
function Compare-CancellazioniOrigine {
    param([datetime]$Soglia)

    $sogliaTesto = $Soglia.ToString("yyyy-MM-dd")
    $idCandidati = [System.Collections.Generic.List[int]]::new()
    $scorrimento = 0
    do {
        $filtro = "cancellato_il=is.null&or=(data_fine.is.null,data_fine.gte.$sogliaTesto)" +
            "&select=source_iscrizione_id&order=source_iscrizione_id.asc&limit=1000&offset=$scorrimento"
        $pagina = @(Invoke-RestMethod -Uri "$($config.Supabase.Url)/rest/v1/abbonamenti?$filtro" -Headers $supabaseHeaders -Method Get)
        foreach ($r in $pagina) { $idCandidati.Add([int]$r.source_iscrizione_id) }
        $scorrimento += 1000
    } while ($pagina.Count -eq 1000)

    if ($idCandidati.Count -eq 0) {
        Write-Log "Riconciliazione cancellazioni: nessuna vendita aperta da ricontrollare."
        return
    }

    Write-Log "Riconciliazione cancellazioni: $($idCandidati.Count) vendite aperte da ricontrollare contro Info4U."

    $idCancellati = [System.Collections.Generic.List[int]]::new()
    $connessione = New-Object System.Data.SqlClient.SqlConnection $connectionString
    try {
        $connessione.Open()
        for ($i = 0; $i -lt $idCandidati.Count; $i += 1000) {
            $blocco = $idCandidati.GetRange($i, [Math]::Min(1000, $idCandidati.Count - $i))
            # Sono tutti [int] appena letti da Supabase, non testo esterno:
            # costruire l'IN(...) per concatenazione qui e' sicuro.
            $elenco = ($blocco -join ",")
            $comando = $connessione.CreateCommand()
            $comando.CommandText = "SELECT IDIscrizione FROM dbo.AbbonamentiIscrizione WHERE IDIscrizione IN ($elenco)"
            $lettore = $comando.ExecuteReader()
            $trovati = [System.Collections.Generic.HashSet[int]]::new()
            while ($lettore.Read()) { $trovati.Add([int]$lettore["IDIscrizione"]) | Out-Null }
            $lettore.Close()

            foreach ($id in $blocco) {
                if (-not $trovati.Contains($id)) { $idCancellati.Add($id) }
            }
        }
    }
    finally {
        $connessione.Close()
    }

    if ($idCancellati.Count -eq 0) {
        Write-Log "Riconciliazione cancellazioni: nessuna vendita risulta cancellata in Info4U."
        return
    }

    Write-Log "Riconciliazione cancellazioni: $($idCancellati.Count) vendite non trovate piu' in Info4U, le segno cancellate." "WARN"
    $elencoIdCancellati = ($idCancellati -join ",")
    $corpo = @{ cancellato_il = (Get-Date).ToString("o") } | ConvertTo-Json
    Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/abbonamenti?source_iscrizione_id=in.($elencoIdCancellati)" `
        -Headers $supabaseHeaders -Method Patch -Corpo $corpo | Out-Null
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

    # Refresh delle vendite aperte + riconciliazione cancellazioni: non a
    # ogni giro da 5 minuti (costerebbe una scansione di tutte le vendite
    # aperte ogni volta per un beneficio che cambia raramente), ma ogni
    # $refreshApertiOgniOre — il watermark che decide "e' ora?" vive su
    # Supabase (Get-UltimoRefreshAperti), non sull'orologio del task
    # schedulato, cosi' resta corretto anche se il task salta un giro o gira
    # a orari irregolari.
    $ultimoRefreshAperti = Get-UltimoRefreshAperti
    $orePassate = if ($ultimoRefreshAperti) { (New-TimeSpan -Start $ultimoRefreshAperti -End (Get-Date)).TotalHours } else { [double]::PositiveInfinity }

    if ($orePassate -ge $refreshApertiOgniOre) {
        Write-Log "Refresh vendite aperte: ultimo giro $(if ($ultimoRefreshAperti) { "$([math]::Round($orePassate,1)) ore fa" } else { 'mai fatto' }) (soglia ${refreshApertiOgniOre}h) — riparto."

        $soglia = (Get-Date).Date.AddDays(-$refreshApertiGiorniIndietro)
        $lastIdAperti = 0
        $totaleRigheAperte = 0

        for ($batch = 1; $batch -le $maxBatchesRefreshAperti; $batch++) {
            $righe = Get-RigheAperteDaSincronizzare -LastId $lastIdAperti -Top $batchSize -Soglia $soglia
            if ($righe.Count -eq 0) {
                Write-Log "Refresh vendite aperte: nessuna riga rimasta da riprocessare."
                break
            }

            $mappaPersone = Send-PersoneUpsert -Righe $righe
            Send-AbbonamentiUpsert -Righe $righe -MappaPersone $mappaPersone

            $ultimaRiga = $righe[$righe.Count - 1]
            $lastIdAperti = [int]$ultimaRiga.IDIscrizione
            $totaleRigheAperte += $righe.Count
            Write-Log "Refresh vendite aperte, batch ${batch}: $($righe.Count) righe."

            if ($righe.Count -lt $batchSize) { break }
        }

        Write-Log "Refresh vendite aperte: $totaleRigheAperte righe riprocessate in questa esecuzione."

        Compare-CancellazioniOrigine -Soglia $soglia

        # Aggiornato solo a refresh completato (incluse le eventuali
        # cancellazioni): se lo script si interrompe a meta', il prossimo
        # giro riprova da capo invece di segnare un refresh che non c'e'
        # mai stato per intero.
        Set-UltimoRefreshAperti -Quando (Get-Date)
    }
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
