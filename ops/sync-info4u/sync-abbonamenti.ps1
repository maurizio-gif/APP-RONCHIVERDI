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

.PARAMETER SoloExtra
    Nomi delle sole tabelle "dati aggiuntivi" da sincronizzare (vedi $defsExtra
    piu' sotto), per esempio -SoloExtra crm_azioni,email_info4u. Con questo
    parametro lo script salta vendite, cassa, rate e modifiche: serve a provare
    una tabella nuova da sola, a mano, prima di lasciarla al task schedulato.
#>

param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot "config.json"),
    [string[]]$SoloExtra = @()
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
# Il refresh non si fa piu' tutto in un'esecuzione: ~28.000 vendite aperte a
# 500 righe al minuto sono un'ora, durante la quale il task resta occupato e
# le vendite nuove aspettano (con «non avviare una nuova istanza» il giro da 5
# minuti dopo non parte). Ogni esecuzione ne fa al massimo questi blocchi e
# ricorda su Supabase dove e' arrivata (Get-RefreshApertiInCorso): il giro
# dopo prosegue da li', e un'interruzione costa al piu' un blocco, non tutto.
# Il vecchio MaxBatchesRefreshAperti (tetto per un refresh intero in una sola
# esecuzione) non si legge piu'.
$batchesRefreshApertiPerGiro = if ($config.BatchesRefreshApertiPerGiro) { [int]$config.BatchesRefreshApertiPerGiro } else { 3 }

# Transazioni di cassa (dbo.CassaMovimenti): blocchi piu' grandi di quelli
# delle vendite perche' le righe sono piccole e lo storico e' lungo (qualche
# centinaio di migliaia). Il refresh rilegge i movimenti degli ultimi
# $refreshTransazioniGiorniIndietro giorni: serve a intercettare il metodo di
# pagamento corretto dopo un "Da definire" e i movimenti spariti da Info4U.
# Data da cui si migrano i movimenti (config: TransazioniDal, formato
# yyyy-MM-dd). Niente prima del 1 gennaio 2023: lo storico precedente non
# serve al report e non entra nel CRM.
$transazioniDal = if ($config.TransazioniDal) { [datetime]::ParseExact([string]$config.TransazioniDal, "yyyy-MM-dd", $null) } else { [datetime]"2023-01-01" }
# Piano rate (dbo.AbbonamentiPagamenti): rate con scadenza o pagamento da
# $transazioniDal in poi, piu' quelle senza data. A differenza dei movimenti
# di cassa una rata CAMBIA dopo la creazione (si paga, si corregge): oltre ai
# nuovi ID serve il refresh, e piu' frequente (6 ore) perche' un insoluto
# pagato non deve restare «insoluto» per un giorno intero.
$refreshRateOgniOre = if ($config.RefreshRateOgniOre) { [double]$config.RefreshRateOgniOre } else { 6 }
$refreshRateGiorniIndietro = if ($config.RefreshRateGiorniIndietro) { [int]$config.RefreshRateGiorniIndietro } else { 60 }
$batchSizeTransazioni = if ($config.BatchSizeTransazioni) { [int]$config.BatchSizeTransazioni } else { 1000 }
$maxBatchesTransazioni = if ($config.MaxBatchesTransazioni) { [int]$config.MaxBatchesTransazioni } else { 30 }
$refreshTransazioniOgniOre = if ($config.RefreshTransazioniOgniOre) { [double]$config.RefreshTransazioniOgniOre } else { 20 }
$refreshTransazioniGiorniIndietro = if ($config.RefreshTransazioniGiorniIndietro) { [int]$config.RefreshTransazioniGiorniIndietro } else { 60 }

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

# Il refresh delle vendite aperte in corso, se ce n'e' uno: quando e'
# iniziato e l'ultimo IDIscrizione gia' riprocessato. Riga
# "refresh_aperti_in_corso", cursore nullo = nessun refresh in corso (vedi
# scripts/sql/2026-10-14-sync-info4u-stato-cursore.sql).
function Get-RefreshApertiInCorso {
    $url = "$($config.Supabase.Url)/rest/v1/sync_info4u_stato?chiave=eq.refresh_aperti_in_corso&select=valore,cursore"
    $risposta = Invoke-RestMethod -Uri $url -Headers $supabaseHeaders -Method Get
    if ($risposta.Count -gt 0 -and $null -ne $risposta[0].cursore) {
        return @{ Inizio = [datetime]$risposta[0].valore; Cursore = [int]$risposta[0].cursore }
    }
    return $null
}

function Set-RefreshApertiInCorso {
    param([datetime]$Inizio, $Cursore)
    $corpo = @{
        chiave        = "refresh_aperti_in_corso"
        valore        = $Inizio.ToString("o")
        cursore       = $Cursore
        aggiornato_il = (Get-Date).ToString("o")
    } | ConvertTo-Json
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
            abbonamento              = Get-NomeProdotto $r.IDAbbonamento $r.Abbonamento
            categoria                = Get-CategoriaProdotto $r.IDAbbonamento
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
            venditore_nome           = Get-TestoPulito $r.NomeVenditore
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
    ai.IDOperatore, ai.NomeOperatore, ai.IDVenditore, vo.NomeOperatore AS NomeVenditore, ai.IDClub,
    ai.Bloccato, ai.Convertito, ai.RinnovoAutomatico, ai.DataDisdetta, ai.MotivoDisdetta,
    ai.IDSconto, ai.IDScontoDurata,
    ai.GGOmaggio, ai.GGFestivi, ai.GGsospensione,
    ai.DataInizioSospensione, ai.DataFineSospensione,
    ai.Note
FROM dbo.AbbonamentiIscrizione ai
INNER JOIN dbo.Utenti u ON u.IDUtente = ai.IDUtente
LEFT JOIN dbo.AbbonamentiDurata ad ON ad.IDDurata = ai.IDDurata
LEFT JOIN dbo.Abbonamenti a ON a.IDAbbonamento = ad.IDAbbonamento
-- A differenza dell'operatore, AbbonamentiIscrizione non porta gia' un nome
-- venditore risolto (solo IDVenditore, un numero): si risolve qui, contro la
-- stessa Operatori dell'operatore (IDVenditore punta alla stessa persona,
-- solo nel ruolo di chi ha fatto la vendita). Cosi' il nome si congela al
-- momento della sincronizzazione, non a una lettura futura che soffrirebbe
-- della riassegnazione dell'id nel tempo (vedi
-- scripts/sql/2026-09-24-abbonamenti-scadenze-venditore.sql).
LEFT JOIN dbo.Operatori vo ON vo.IDOperatore = ai.IDVenditore
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

# ─────────────────────────────────────────────────────────────── catalogo

# Il CRM riconosce un prodotto dal nome, ma in Info4U lo stesso nome puo'
# appartenere a prodotti diversi: «GOLD UNDER 17» sono due (643 nella
# categoria 1.13-UNDER 17, 558 nella 6-UNDER 17), «CARNET 10 INGRESSI CON
# MAESTRO» c'e' sia nel Tennis sia nel Padel. Fusi sotto un nome solo, i
# conteggi non tornano con Info4U e un gruppo si prende il fatturato di un
# altro. Qui si legge il catalogo intero (poche centinaia di righe) e, ai soli
# nomi condivisi, si aggiunge la categoria: «GOLD UNDER 17 (6-UNDER 17)». Se
# anche nome e categoria coincidono, l'ID Info4U. I nomi unici restano come
# sono, quindi la mappatura dei gruppi esistente non cambia. Vedi
# scripts/sql/2026-10-02-abbonamenti-prodotti-omonimi.sql.
function Get-CatalogoInfo4U {
    $righe = Invoke-QueryDbgym -CommandText @"
SELECT a.IDAbbonamento, a.Descrizione, cat.Descrizione AS Categoria
FROM dbo.Abbonamenti a
LEFT JOIN dbo.AbbonamentiCategorie cat ON cat.IDCategoria = a.IDCategoria
"@ -Parametri @{}

    $prodotti = foreach ($r in $righe) {
        [PSCustomObject]@{
            Id        = [int]$r.IDAbbonamento
            Nome      = Get-TestoPulito $r.Descrizione
            Categoria = Get-TestoPulito $r.Categoria
        }
    }
    $prodotti = @($prodotti | Where-Object { $_.Nome })

    $perNome = @{}
    foreach ($p in $prodotti) {
        $chiave = $p.Nome.ToUpperInvariant()
        if (-not $perNome.ContainsKey($chiave)) { $perNome[$chiave] = 0 }
        $perNome[$chiave]++
    }
    $perNomeCategoria = @{}
    foreach ($p in $prodotti) {
        $chiave = "$($p.Nome.ToUpperInvariant())|$("$($p.Categoria)".ToUpperInvariant())"
        if (-not $perNomeCategoria.ContainsKey($chiave)) { $perNomeCategoria[$chiave] = 0 }
        $perNomeCategoria[$chiave]++
    }

    $catalogo = @{}
    foreach ($p in $prodotti) {
        $nome = $p.Nome
        if ($perNome[$p.Nome.ToUpperInvariant()] -gt 1) {
            $chiave = "$($p.Nome.ToUpperInvariant())|$("$($p.Categoria)".ToUpperInvariant())"
            $nome = if ($p.Categoria -and $perNomeCategoria[$chiave] -eq 1) { "$($p.Nome) ($($p.Categoria))" } else { "$($p.Nome) (#$($p.Id))" }
        }
        $catalogo[$p.Id] = @{ nome = $nome; categoria = $p.Categoria }
    }
    return $catalogo
}

# Il nome con cui il prodotto entra nel CRM: quello del catalogo, se c'e';
# altrimenti la descrizione letta con la vendita, come prima.
function Get-NomeProdotto {
    param($IdAbbonamento, $Descrizione)
    if (-not ($IdAbbonamento -is [System.DBNull]) -and $null -ne $IdAbbonamento -and $catalogo.ContainsKey([int]$IdAbbonamento)) {
        return $catalogo[[int]$IdAbbonamento].nome
    }
    return Get-TestoPulito $Descrizione
}

function Get-CategoriaProdotto {
    param($IdAbbonamento)
    if (-not ($IdAbbonamento -is [System.DBNull]) -and $null -ne $IdAbbonamento -and $catalogo.ContainsKey([int]$IdAbbonamento)) {
        return $catalogo[[int]$IdAbbonamento].categoria
    }
    return $null
}

# Riallinea nome e categoria anche delle vendite vecchie, che il refresh
# delle vendite aperte non rilegge piu': una chiamata sola col catalogo
# intero, e la funzione su Supabase tocca solo le righe da cambiare
# (copiando la mappatura del vecchio nome sul nuovo).
function Sync-CatalogoProdotti {
    $elenco = @(foreach ($id in $catalogo.Keys) {
        [ordered]@{ id = $id; nome = $catalogo[$id].nome; categoria = $catalogo[$id].categoria }
    })
    # A blocchi: il primo giro riscrive la categoria su tutte le vendite
    # (centinaia di migliaia di righe), e una chiamata sola rischierebbe il
    # timeout di PostgREST. Dal secondo giro in poi ogni blocco non cambia
    # quasi niente ed e' immediato.
    $cambiate = 0
    for ($i = 0; $i -lt $elenco.Count; $i += 40) {
        $blocco = $elenco[$i..([Math]::Min($i + 39, $elenco.Count - 1))]
        $corpo = @{ p_catalogo = @($blocco) } | ConvertTo-Json -Depth 5 -Compress
        $cambiate += [int](Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/rpc/allinea_catalogo_info4u" `
            -Headers $supabaseHeaders -Method Post -Corpo $corpo)
    }
    Write-Log "Catalogo prodotti: $($elenco.Count) prodotti, $cambiate vendite riallineate (nome o categoria)."
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
        # In Windows PowerShell 5.1 Invoke-RestMethod restituisce un array
        # JSON come UN oggetto solo (non lo srotola): @(...) da solo ne fa un
        # array di un elemento, e [int] su quell'elemento fallisce
        # ("Impossibile convertire System.Object[] in System.Int32"). Passarlo
        # nella pipeline lo srotola davvero, riga per riga. Era il motivo per
        # cui il refresh non arrivava mai in fondo, e non veniva mai segnato.
        $pagina = @(Invoke-RestMethod -Uri "$($config.Supabase.Url)/rest/v1/abbonamenti?$filtro" -Headers $supabaseHeaders -Method Get |
            ForEach-Object { $_ })
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

# ─────────────────────────────────────────────────────── transazioni cassa

# Una riga per movimento di dbo.CassaMovimenti, di ogni tipo e senza filtri:
# cosa conta come incassato lo decide la vista incassato_mensile su Supabase
# (vedi scripts/sql/2026-10-07-transazioni-cassa.sql), non questa query.
# NomeUtente e Note non si leggono: sono dati personali o testo libero.
# LEFT JOIN su CassaTipiPagamenti: un movimento senza metodo (le cauzioni)
# resta, con metodo nullo.
$querySelectMovimenti = @"
SELECT
    cm.IdCassaMovimento,
    cm.IdUtente,
    cm.IDIscrizione,
    cm.IdServizio,
    cm.TipoServizio,
    cm.DescrizioneServizio,
    LEFT(cm.Causale, 120) AS Causale,
    cm.DataOperazione,
    cm.Importo,
    cm.IDTipoPagamento,
    tp.Descrizione AS MetodoPagamento,
    tp.MovimentaCassa,
    cm.IDCassaMovimentoStorno,
    cm.IdOperatore,
    cm.NomeOperatore,
    cm.Cassetto
FROM dbo.CassaMovimenti cm
LEFT JOIN dbo.CassaTipiPagamenti tp ON tp.IDTipoPagamento = cm.IDTipoPagamento
"@

function Get-UltimoMovimentoSincronizzato {
    $url = "$($config.Supabase.Url)/rest/v1/transazioni?select=source_movimento_id&order=source_movimento_id.desc&limit=1"
    $risposta = Invoke-RestMethod -Uri $url -Headers $supabaseHeaders -Method Get
    if ($risposta.Count -gt 0) { return [int]$risposta[0].source_movimento_id }
    return 0
}

function Get-UltimoRefreshTransazioni {
    $url = "$($config.Supabase.Url)/rest/v1/sync_info4u_stato?chiave=eq.refresh_transazioni&select=valore"
    $risposta = Invoke-RestMethod -Uri $url -Headers $supabaseHeaders -Method Get
    if ($risposta.Count -gt 0) { return [datetime]$risposta[0].valore }
    return $null
}

function Set-UltimoRefreshTransazioni {
    param([datetime]$Quando)
    $corpo = @{ chiave = "refresh_transazioni"; valore = $Quando.ToString("o") } | ConvertTo-Json
    $headers = $supabaseHeaders.Clone()
    $headers["Prefer"] = "resolution=merge-duplicates"
    Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/sync_info4u_stato?on_conflict=chiave" `
        -Headers $headers -Method Post -Corpo $corpo | Out-Null
}

function Get-MovimentiDaSincronizzare {
    param([int]$LastId, [int]$Top)

    $comandoText = ($querySelectMovimenti -replace '^SELECT', "SELECT TOP ($Top)") +
        "`nWHERE cm.IdCassaMovimento > @LastId AND cm.DataOperazione >= @Dal`nORDER BY cm.IdCassaMovimento ASC"

    return Invoke-QueryDbgym -CommandText $comandoText -Parametri @{ "@LastId" = $LastId; "@Dal" = $transazioniDal }
}

# I movimenti recenti secondo Info4U adesso, per il refresh: @LastId pagina
# solo all'interno di UN giro, come per le vendite aperte.
function Get-MovimentiRecentiDaSincronizzare {
    param([int]$LastId, [int]$Top, [datetime]$Soglia)

    $comandoText = ($querySelectMovimenti -replace '^SELECT', "SELECT TOP ($Top)") +
        "`nWHERE cm.IdCassaMovimento > @LastId AND cm.DataOperazione >= @Soglia`nORDER BY cm.IdCassaMovimento ASC"

    return Invoke-QueryDbgym -CommandText $comandoText -Parametri @{ "@LastId" = $LastId; "@Soglia" = $Soglia }
}

function Send-TransazioniUpsert {
    param([array]$Righe)

    # Dedup per sicurezza (stesso motivo di Send-AbbonamentiUpsert): PostgREST
    # rifiuta un upsert che tocca due volte la stessa chiave nello stesso
    # comando.
    $visti = @{}
    $transazioni = foreach ($r in $Righe) {
        $idMovimento = [int]$r.IdCassaMovimento
        if ($visti.ContainsKey($idMovimento)) { continue }
        $visti[$idMovimento] = $true

        [ordered]@{
            source_movimento_id        = $idMovimento
            source_utente_id           = if ($r.IdUtente -is [System.DBNull]) { $null } else { [int]$r.IdUtente }
            source_iscrizione_id       = if ($r.IDIscrizione -is [System.DBNull]) { $null } else { [int]$r.IDIscrizione }
            source_servizio_id         = if ($r.IdServizio -is [System.DBNull]) { $null } else { [int]$r.IdServizio }
            tipo_servizio              = Get-TestoPulito $r.TipoServizio
            descrizione_servizio       = Get-TestoPulito $r.DescrizioneServizio
            causale                    = Get-TestoPulito $r.Causale
            data_operazione            = Get-IstantePulito $r.DataOperazione
            importo                    = Get-NumeroPulito $r.Importo
            source_tipo_pagamento_id   = if ($r.IDTipoPagamento -is [System.DBNull]) { $null } else { [int]$r.IDTipoPagamento }
            metodo_pagamento           = Get-TestoPulito $r.MetodoPagamento
            movimenta_cassa            = Get-BoolPulito $r.MovimentaCassa
            source_movimento_storno_id = if ($r.IDCassaMovimentoStorno -is [System.DBNull]) { $null } else { [int]$r.IDCassaMovimentoStorno }
            operatore_id               = if ($r.IdOperatore -is [System.DBNull]) { $null } else { [int]$r.IdOperatore }
            operatore_nome             = Get-TestoPulito $r.NomeOperatore
            cassetto                   = Get-TestoPulito $r.Cassetto
            # Appena letto da una query live: esiste ancora in Info4U.
            cancellato_il              = $null
        }
    }
    if (-not $transazioni) { return }

    $url = "$($config.Supabase.Url)/rest/v1/transazioni?on_conflict=source_movimento_id"
    $corpo = $transazioni | ConvertTo-Json -Depth 5
    $headers = $supabaseHeaders.Clone()
    $headers["Prefer"] = "resolution=merge-duplicates,return=minimal"

    Invoke-SupabaseScrittura -Uri $url -Headers $headers -Method Post -Corpo $corpo | Out-Null
}

# I movimenti che Supabase ha nella finestra recente e Info4U non ha piu'
# (cancellati da un operatore dopo il sync) si segnano cancellati: stessa
# logica di Compare-CancellazioniOrigine, mai una DELETE. Solo nella
# finestra del refresh: piu' indietro si presume che non cambi piu' nulla.
function Compare-CancellazioniTransazioni {
    param([datetime]$Soglia)

    $sogliaTesto = $Soglia.ToString("yyyy-MM-dd")
    $idCandidati = [System.Collections.Generic.List[int]]::new()
    $scorrimento = 0
    do {
        $filtro = "cancellato_il=is.null&data_operazione=gte.$sogliaTesto" +
            "&select=source_movimento_id&order=source_movimento_id.asc&limit=1000&offset=$scorrimento"
        # Vedi il commento in Compare-CancellazioniOrigine: la pipeline srotola
        # l'array JSON che PowerShell 5.1 altrimenti restituisce come un
        # oggetto solo.
        $pagina = @(Invoke-RestMethod -Uri "$($config.Supabase.Url)/rest/v1/transazioni?$filtro" -Headers $supabaseHeaders -Method Get |
            ForEach-Object { $_ })
        foreach ($r in $pagina) { $idCandidati.Add([int]$r.source_movimento_id) }
        $scorrimento += 1000
    } while ($pagina.Count -eq 1000)

    if ($idCandidati.Count -eq 0) {
        Write-Log "Riconciliazione transazioni: nessun movimento recente da ricontrollare."
        return
    }

    Write-Log "Riconciliazione transazioni: $($idCandidati.Count) movimenti recenti da ricontrollare contro Info4U."

    $idCancellati = [System.Collections.Generic.List[int]]::new()
    $connessione = New-Object System.Data.SqlClient.SqlConnection $connectionString
    try {
        $connessione.Open()
        for ($i = 0; $i -lt $idCandidati.Count; $i += 1000) {
            $blocco = $idCandidati.GetRange($i, [Math]::Min(1000, $idCandidati.Count - $i))
            # Tutti [int] appena letti da Supabase: l'IN(...) per
            # concatenazione e' sicuro.
            $elenco = ($blocco -join ",")
            $comando = $connessione.CreateCommand()
            $comando.CommandText = "SELECT IdCassaMovimento FROM dbo.CassaMovimenti WHERE IdCassaMovimento IN ($elenco)"
            $lettore = $comando.ExecuteReader()
            $trovati = [System.Collections.Generic.HashSet[int]]::new()
            while ($lettore.Read()) { $trovati.Add([int]$lettore["IdCassaMovimento"]) | Out-Null }
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
        Write-Log "Riconciliazione transazioni: nessun movimento risulta cancellato in Info4U."
        return
    }

    Write-Log "Riconciliazione transazioni: $($idCancellati.Count) movimenti non trovati piu' in Info4U, li segno cancellati." "WARN"
    $elencoIdCancellati = ($idCancellati -join ",")
    $corpo = @{ cancellato_il = (Get-Date).ToString("o") } | ConvertTo-Json
    Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/transazioni?source_movimento_id=in.($elencoIdCancellati)" `
        -Headers $supabaseHeaders -Method Patch -Corpo $corpo | Out-Null
}

# Il giro intero delle transazioni: nuovi movimenti a ogni esecuzione, poi
# (ogni $refreshTransazioniOgniOre) rilettura della finestra recente e
# riconciliazione dei cancellati.
function Sync-Transazioni {
    $lastIdMovimenti = Get-UltimoMovimentoSincronizzato
    Write-Log "Transazioni, watermark di partenza: source_movimento_id > $lastIdMovimenti"

    $totale = 0
    for ($batch = 1; $batch -le $maxBatchesTransazioni; $batch++) {
        $righe = Get-MovimentiDaSincronizzare -LastId $lastIdMovimenti -Top $batchSizeTransazioni
        if ($righe.Count -eq 0) {
            Write-Log "Transazioni: nessun nuovo movimento, al passo con la sorgente."
            break
        }

        Send-TransazioniUpsert -Righe $righe

        $lastIdMovimenti = [int]$righe[$righe.Count - 1].IdCassaMovimento
        $totale += $righe.Count
        Write-Log "Transazioni, batch ${batch}: $($righe.Count) righe, watermark ora a $lastIdMovimenti."

        if ($righe.Count -lt $batchSizeTransazioni) { break }
    }
    Write-Log "Transazioni: $totale movimenti sincronizzati in questa esecuzione."

    # Il refresh solo a storico recuperato: finche' il watermark non ha
    # raggiunto la fine, le righe recenti non sono ancora nemmeno arrivate.
    if ($totale -ge ($batchSizeTransazioni * $maxBatchesTransazioni)) {
        Write-Log "Transazioni: storico ancora in corso, salto il refresh di questo giro."
        return
    }

    $ultimoRefresh = Get-UltimoRefreshTransazioni
    $orePassate = if ($ultimoRefresh) { (New-TimeSpan -Start $ultimoRefresh -End (Get-Date)).TotalHours } else { [double]::PositiveInfinity }
    if ($orePassate -lt $refreshTransazioniOgniOre) { return }

    Write-Log "Refresh transazioni: ultimo giro $(if ($ultimoRefresh) { "$([math]::Round($orePassate,1)) ore fa" } else { 'mai fatto' }) (soglia ${refreshTransazioniOgniOre}h) - riparto."

    $soglia = (Get-Date).Date.AddDays(-$refreshTransazioniGiorniIndietro)
    if ($soglia -lt $transazioniDal) { $soglia = $transazioniDal }
    $lastIdRefresh = 0
    $totaleRefresh = 0
    for ($batch = 1; $batch -le $maxBatchesTransazioni; $batch++) {
        $righe = Get-MovimentiRecentiDaSincronizzare -LastId $lastIdRefresh -Top $batchSizeTransazioni -Soglia $soglia
        if ($righe.Count -eq 0) { break }

        Send-TransazioniUpsert -Righe $righe

        $lastIdRefresh = [int]$righe[$righe.Count - 1].IdCassaMovimento
        $totaleRefresh += $righe.Count
        Write-Log "Refresh transazioni, batch ${batch}: $($righe.Count) righe."

        if ($righe.Count -lt $batchSizeTransazioni) { break }
    }
    Write-Log "Refresh transazioni: $totaleRefresh movimenti riprocessati in questa esecuzione."

    Compare-CancellazioniTransazioni -Soglia $soglia

    # Segnato solo a giro completo: se si interrompe, il prossimo riparte.
    Set-UltimoRefreshTransazioni -Quando (Get-Date)
}

# ───────────────────────────────────────────────────────────── piano rate

# Una riga per rata di dbo.AbbonamentiPagamenti. TransazioneErrore e' l'esito
# dell'addebito automatico (carta/SEPA): se la banca l'ha rifiutato c'e' il
# motivo, ed e' il dato piu' utile a chi controlla gli insoluti.
$querySelectRate = @"
SELECT
    ap.IDRata,
    ap.IDIscrizione,
    ap.IDCassaMovimento,
    ap.DataRata,
    ap.Importo,
    ap.DataPagato,
    ap.IDTipoPagamento,
    tp.Descrizione AS MetodoPagamento,
    ap.IdOperatore,
    ap.NomeOperatore,
    ap.TransazioneErrore,
    ap.TransazioneData
FROM dbo.AbbonamentiPagamenti ap
LEFT JOIN dbo.CassaTipiPagamenti tp ON tp.IDTipoPagamento = ap.IDTipoPagamento
"@

function Get-UltimaRataSincronizzata {
    $url = "$($config.Supabase.Url)/rest/v1/abbonamenti_rate?select=source_rata_id&order=source_rata_id.desc&limit=1"
    $risposta = Invoke-RestMethod -Uri $url -Headers $supabaseHeaders -Method Get
    if ($risposta.Count -gt 0) { return [int]$risposta[0].source_rata_id }
    return 0
}

function Get-UltimoRefreshRate {
    $url = "$($config.Supabase.Url)/rest/v1/sync_info4u_stato?chiave=eq.refresh_rate&select=valore"
    $risposta = Invoke-RestMethod -Uri $url -Headers $supabaseHeaders -Method Get
    if ($risposta.Count -gt 0) { return [datetime]$risposta[0].valore }
    return $null
}

function Set-UltimoRefreshRate {
    param([datetime]$Quando)
    $corpo = @{ chiave = "refresh_rate"; valore = $Quando.ToString("o") } | ConvertTo-Json
    $headers = $supabaseHeaders.Clone()
    $headers["Prefer"] = "resolution=merge-duplicates"
    Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/sync_info4u_stato?on_conflict=chiave" `
        -Headers $headers -Method Post -Corpo $corpo | Out-Null
}

# Nuove rate: ID oltre il watermark. Una rata senza nessuna data (ne' scadenza
# ne' pagamento) entra comunque: non si puo' escludere per data cio' che non
# ne ha.
function Get-RateDaSincronizzare {
    param([int]$LastId, [int]$Top)

    $comandoText = ($querySelectRate -replace '^SELECT', "SELECT TOP ($Top)") +
        "`nWHERE ap.IDRata > @LastId AND (ap.DataRata >= @Dal OR ap.DataPagato >= @Dal OR (ap.DataRata IS NULL AND ap.DataPagato IS NULL))`nORDER BY ap.IDRata ASC"

    return Invoke-QueryDbgym -CommandText $comandoText -Parametri @{ "@LastId" = $LastId; "@Dal" = $transazioniDal }
}

# Refresh: le rate recenti o future secondo Info4U adesso (scadenza o
# pagamento dalla soglia in poi). Una rata vecchia, non pagata e mai toccata
# non cambia: non serve rileggerla.
function Get-RateRecentiDaSincronizzare {
    param([int]$LastId, [int]$Top, [datetime]$Soglia)

    $comandoText = ($querySelectRate -replace '^SELECT', "SELECT TOP ($Top)") +
        "`nWHERE ap.IDRata > @LastId AND (ap.DataRata >= @Soglia OR ap.DataPagato >= @Soglia)`nORDER BY ap.IDRata ASC"

    return Invoke-QueryDbgym -CommandText $comandoText -Parametri @{ "@LastId" = $LastId; "@Soglia" = $Soglia }
}

function Send-RateUpsert {
    param([array]$Righe)

    $visti = @{}
    $rate = foreach ($r in $Righe) {
        $idRata = [int]$r.IDRata
        if ($visti.ContainsKey($idRata)) { continue }
        $visti[$idRata] = $true

        [ordered]@{
            source_rata_id           = $idRata
            source_iscrizione_id     = if ($r.IDIscrizione -is [System.DBNull]) { $null } else { [int]$r.IDIscrizione }
            source_movimento_id      = if ($r.IDCassaMovimento -is [System.DBNull]) { $null } else { [int]$r.IDCassaMovimento }
            data_rata                = Get-DataPulita $r.DataRata
            importo                  = Get-NumeroPulito $r.Importo
            data_pagato              = Get-IstantePulito $r.DataPagato
            source_tipo_pagamento_id = if ($r.IDTipoPagamento -is [System.DBNull]) { $null } else { [int]$r.IDTipoPagamento }
            metodo_pagamento         = Get-TestoPulito $r.MetodoPagamento
            operatore_id             = if ($r.IdOperatore -is [System.DBNull]) { $null } else { [int]$r.IdOperatore }
            operatore_nome           = Get-TestoPulito $r.NomeOperatore
            transazione_errore       = Get-TestoPulito $r.TransazioneErrore
            transazione_data         = Get-IstantePulito $r.TransazioneData
            # Appena letta da una query live: esiste ancora in Info4U.
            cancellato_il            = $null
        }
    }
    if (-not $rate) { return }

    $url = "$($config.Supabase.Url)/rest/v1/abbonamenti_rate?on_conflict=source_rata_id"
    $corpo = $rate | ConvertTo-Json -Depth 5
    $headers = $supabaseHeaders.Clone()
    $headers["Prefer"] = "resolution=merge-duplicates,return=minimal"

    Invoke-SupabaseScrittura -Uri $url -Headers $headers -Method Post -Corpo $corpo | Out-Null
}

# Le rate che Supabase ha con scadenza dalla soglia in poi (comprese tutte le
# future) e Info4U non ha piu': una vendita eliminata si porta via il suo
# piano rate. Segnate cancellate, mai una DELETE.
function Compare-CancellazioniRate {
    param([datetime]$Soglia)

    $sogliaTesto = $Soglia.ToString("yyyy-MM-dd")
    $idCandidati = [System.Collections.Generic.List[int]]::new()
    $scorrimento = 0
    do {
        $filtro = "cancellato_il=is.null&data_rata=gte.$sogliaTesto" +
            "&select=source_rata_id&order=source_rata_id.asc&limit=1000&offset=$scorrimento"
        $pagina = @(Invoke-RestMethod -Uri "$($config.Supabase.Url)/rest/v1/abbonamenti_rate?$filtro" -Headers $supabaseHeaders -Method Get |
            ForEach-Object { $_ })
        foreach ($r in $pagina) { $idCandidati.Add([int]$r.source_rata_id) }
        $scorrimento += 1000
    } while ($pagina.Count -eq 1000)

    if ($idCandidati.Count -eq 0) {
        Write-Log "Riconciliazione rate: nessuna rata da ricontrollare."
        return
    }

    Write-Log "Riconciliazione rate: $($idCandidati.Count) rate da ricontrollare contro Info4U."

    $idCancellati = [System.Collections.Generic.List[int]]::new()
    $connessione = New-Object System.Data.SqlClient.SqlConnection $connectionString
    try {
        $connessione.Open()
        for ($i = 0; $i -lt $idCandidati.Count; $i += 1000) {
            $blocco = $idCandidati.GetRange($i, [Math]::Min(1000, $idCandidati.Count - $i))
            $elenco = ($blocco -join ",")
            $comando = $connessione.CreateCommand()
            $comando.CommandText = "SELECT IDRata FROM dbo.AbbonamentiPagamenti WHERE IDRata IN ($elenco)"
            $lettore = $comando.ExecuteReader()
            $trovati = [System.Collections.Generic.HashSet[int]]::new()
            while ($lettore.Read()) { $trovati.Add([int]$lettore["IDRata"]) | Out-Null }
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
        Write-Log "Riconciliazione rate: nessuna rata risulta cancellata in Info4U."
        return
    }

    Write-Log "Riconciliazione rate: $($idCancellati.Count) rate non trovate piu' in Info4U, le segno cancellate." "WARN"
    $elencoIdCancellati = ($idCancellati -join ",")
    $corpo = @{ cancellato_il = (Get-Date).ToString("o") } | ConvertTo-Json
    Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/abbonamenti_rate?source_rata_id=in.($elencoIdCancellati)" `
        -Headers $supabaseHeaders -Method Patch -Corpo $corpo | Out-Null
}

# Il giro intero delle rate: nuove a ogni esecuzione, poi (ogni
# $refreshRateOgniOre) rilettura delle recenti e future e riconciliazione.
function Sync-Rate {
    $lastIdRate = Get-UltimaRataSincronizzata
    Write-Log "Rate, watermark di partenza: source_rata_id > $lastIdRate"

    $totale = 0
    for ($batch = 1; $batch -le $maxBatchesTransazioni; $batch++) {
        $righe = Get-RateDaSincronizzare -LastId $lastIdRate -Top $batchSizeTransazioni
        if ($righe.Count -eq 0) {
            Write-Log "Rate: nessuna nuova rata, al passo con la sorgente."
            break
        }

        Send-RateUpsert -Righe $righe

        $lastIdRate = [int]$righe[$righe.Count - 1].IDRata
        $totale += $righe.Count
        Write-Log "Rate, batch ${batch}: $($righe.Count) righe, watermark ora a $lastIdRate."

        if ($righe.Count -lt $batchSizeTransazioni) { break }
    }
    Write-Log "Rate: $totale rate sincronizzate in questa esecuzione."

    if ($totale -ge ($batchSizeTransazioni * $maxBatchesTransazioni)) {
        Write-Log "Rate: storico ancora in corso, salto il refresh di questo giro."
        return
    }

    $ultimoRefresh = Get-UltimoRefreshRate
    $orePassate = if ($ultimoRefresh) { (New-TimeSpan -Start $ultimoRefresh -End (Get-Date)).TotalHours } else { [double]::PositiveInfinity }
    if ($orePassate -lt $refreshRateOgniOre) { return }

    Write-Log "Refresh rate: ultimo giro $(if ($ultimoRefresh) { "$([math]::Round($orePassate,1)) ore fa" } else { 'mai fatto' }) (soglia ${refreshRateOgniOre}h) - riparto."

    $soglia = (Get-Date).Date.AddDays(-$refreshRateGiorniIndietro)
    if ($soglia -lt $transazioniDal) { $soglia = $transazioniDal }
    $lastIdRefresh = 0
    $totaleRefresh = 0
    for ($batch = 1; $batch -le $maxBatchesTransazioni; $batch++) {
        $righe = Get-RateRecentiDaSincronizzare -LastId $lastIdRefresh -Top $batchSizeTransazioni -Soglia $soglia
        if ($righe.Count -eq 0) { break }

        Send-RateUpsert -Righe $righe

        $lastIdRefresh = [int]$righe[$righe.Count - 1].IDRata
        $totaleRefresh += $righe.Count
        Write-Log "Refresh rate, batch ${batch}: $($righe.Count) righe."

        if ($righe.Count -lt $batchSizeTransazioni) { break }
    }
    Write-Log "Refresh rate: $totaleRefresh rate riprocessate in questa esecuzione."

    Compare-CancellazioniRate -Soglia $soglia

    # Segnato solo a giro completo: se si interrompe, il prossimo riparte.
    Set-UltimoRefreshRate -Quando (Get-Date)
}

# ─────────────────────────────────────────────────── modifiche abbonamenti

# Il registro delle azioni di Info4U (dbo.AppLog) scrive una riga per ogni
# modifica di un abbonamento, con operatore, socio e un testo del tipo
#   ABBONAMENTI MODIFICA: cambiata data inizio in 21/09/2026 e data fine
#   abbonamento in 06/06/2027 (precedente data inizio: 21/09/2026 - data fine:
#   20/05/2027) all'abbonamento <nome> (IDIscrizione ...)
# Da li' si ricava chi ha spostato una scadenza e quando: il dato che le
# tabelle delle sospensioni non hanno. Il registro non cambia mai a
# posteriori, quindi basta il watermark su IdLog: niente refresh, niente
# riconciliazione. Del socio si copia solo l'ID, non il nome (colonna Utente).
$querySelectModifiche = @"
SELECT
    l.IdLog,
    l.IdOperatore,
    l.NomeOperatore,
    l.IdUtente,
    l.DataOperazione,
    LEFT(l.Descrizione, 600) AS Descrizione
FROM dbo.AppLog l
"@

function Get-UltimaModificaSincronizzata {
    $url = "$($config.Supabase.Url)/rest/v1/abbonamenti_modifiche?select=source_log_id&order=source_log_id.desc&limit=1"
    $risposta = Invoke-RestMethod -Uri $url -Headers $supabaseHeaders -Method Get
    if ($risposta.Count -gt 0) { return [int]$risposta[0].source_log_id }
    return 0
}

# Solo le modifiche degli abbonamenti, dal $transazioniDal in poi. Il
# watermark su IdLog (chiave primaria) limita la lettura alle righe nuove: il
# registro ha quasi 2 milioni di righe, ma ogni giro ne guarda solo le ultime.
function Get-ModificheDaSincronizzare {
    param([int]$LastId, [int]$Top)

    $comandoText = ($querySelectModifiche -replace '^SELECT', "SELECT TOP ($Top)") +
        "`nWHERE l.IdLog > @LastId AND l.Descrizione LIKE 'ABBONAMENTI MODIFICA:%' AND l.DataOperazione >= @Dal`nORDER BY l.IdLog ASC"

    return Invoke-QueryDbgym -CommandText $comandoText -Parametri @{ "@LastId" = $LastId; "@Dal" = $transazioniDal }
}

# «21/09/2026» -> «2026-09-21», o $null.
function ConvertTo-DataIso {
    param([string]$Testo)
    if (-not $Testo) { return $null }
    try { return [datetime]::ParseExact($Testo, "dd/MM/yyyy", [System.Globalization.CultureInfo]::InvariantCulture).ToString("yyyy-MM-dd") }
    catch { return $null }
}

function Send-ModificheUpsert {
    param([array]$Righe)

    $visti = @{}
    $modifiche = foreach ($r in $Righe) {
        $idLog = [int]$r.IdLog
        if ($visti.ContainsKey($idLog)) { continue }
        $visti[$idLog] = $true

        $testo = [string]$r.Descrizione
        # Ogni pezzo e' letto da solo: un formato che ne ha meno dei soliti
        # (per esempio la sola data di inizio) lascia nulli gli altri, e la riga
        # resta non interpretata invece di falsare un calcolo.
        $inizioNuovo = [regex]::Match($testo, 'data inizio in (\d{2}/\d{2}/\d{4})').Groups[1].Value
        $fineNuova = [regex]::Match($testo, 'data fine abbonamento in (\d{2}/\d{2}/\d{4})').Groups[1].Value
        $inizioPrec = [regex]::Match($testo, 'precedente data inizio:\s*(\d{2}/\d{2}/\d{4})').Groups[1].Value
        $finePrec = [regex]::Match($testo, 'data fine:\s*(\d{2}/\d{2}/\d{4})').Groups[1].Value
        $idIscrizione = [regex]::Match($testo, 'IDIscrizione\D{0,4}(\d+)').Groups[1].Value

        $fineNuovaIso = ConvertTo-DataIso $fineNuova
        $finePrecIso = ConvertTo-DataIso $finePrec

        [ordered]@{
            source_log_id        = $idLog
            data_operazione      = Get-IstantePulito $r.DataOperazione
            operatore_id         = if ($r.IdOperatore -is [System.DBNull]) { $null } else { [int]$r.IdOperatore }
            operatore_nome       = Get-TestoPulito $r.NomeOperatore
            source_utente_id     = if ($r.IdUtente -is [System.DBNull]) { $null } else { [int]$r.IdUtente }
            source_iscrizione_id = if ($idIscrizione) { [int]$idIscrizione } else { $null }
            inizio_precedente    = ConvertTo-DataIso $inizioPrec
            fine_precedente      = $finePrecIso
            inizio_nuovo         = ConvertTo-DataIso $inizioNuovo
            fine_nuova           = $fineNuovaIso
            descrizione          = $testo
            interpretata         = [bool]($fineNuovaIso -and $finePrecIso -and $idIscrizione)
        }
    }
    if (-not $modifiche) { return }

    $url = "$($config.Supabase.Url)/rest/v1/abbonamenti_modifiche?on_conflict=source_log_id"
    $corpo = $modifiche | ConvertTo-Json -Depth 5
    $headers = $supabaseHeaders.Clone()
    $headers["Prefer"] = "resolution=merge-duplicates,return=minimal"

    Invoke-SupabaseScrittura -Uri $url -Headers $headers -Method Post -Corpo $corpo | Out-Null
}

function Sync-ModificheAbbonamenti {
    $lastId = Get-UltimaModificaSincronizzata
    Write-Log "Modifiche abbonamenti, watermark di partenza: source_log_id > $lastId"

    $totale = 0
    for ($batch = 1; $batch -le $maxBatchesTransazioni; $batch++) {
        $righe = Get-ModificheDaSincronizzare -LastId $lastId -Top $batchSizeTransazioni
        if ($righe.Count -eq 0) {
            Write-Log "Modifiche abbonamenti: nessuna nuova modifica, al passo con la sorgente."
            break
        }

        Send-ModificheUpsert -Righe $righe

        $lastId = [int]$righe[$righe.Count - 1].IdLog
        $totale += $righe.Count
        Write-Log "Modifiche abbonamenti, batch ${batch}: $($righe.Count) righe, watermark ora a $lastId."

        if ($righe.Count -lt $batchSizeTransazioni) { break }
    }
    Write-Log "Modifiche abbonamenti: $totale modifiche sincronizzate in questa esecuzione."
}

# ─────────────────────────────────────────────────────── dati aggiuntivi

# Gli altri dati di dbgym (azioni CRM dei consulenti, email, certificati,
# prenotazioni, corsi, quote, ricevute, accessi, omaggi): scripts/sql/
# 2026-10-27-dati-info4u-aggiuntivi.sql. Una sola logica per tutte le tabelle,
# guidata da $defsExtra: ogni definizione dice cosa leggere (SELECT con gli
# alias uguali ai nomi delle colonne Supabase) e come tenerlo allineato.
#
# Due modi:
#   Incrementale: watermark = MAX(chiave) letto da Supabase (come vendite e
#     cassa), a blocchi, con un tetto di blocchi per esecuzione. Se la
#     definizione ha RefreshWhere, ogni $extraRefreshOgniOre ore rilegge anche
#     le righe che possono essere cambiate dopo la creazione (un esito, una
#     rata pagata, un invio andato a buon fine).
#   Anagrafica: tabelle piccole di decodifica (tipi, esiti, operatori...),
#     riscritte per intero ogni $extraAnagraficheOgniOre ore.
#
# Una tabella che fallisce (una colonna rinominata, un errore di rete) non
# ferma le altre: l'errore si logga e a fine giro lo script esce con errore.
# Per provarne una sola: .\sync-abbonamenti.ps1 -SoloExtra crm_azioni
# (salta vendite, cassa, rate e modifiche).

$extraAttivo = if ($null -ne $config.ExtraAttivo) { [bool]$config.ExtraAttivo } else { $true }
# Niente prima di questa data (config: ExtraDal, yyyy-MM-dd): di default la
# stessa di cassa e rate.
$extraDal = if ($config.ExtraDal) { [datetime]::ParseExact([string]$config.ExtraDal, "yyyy-MM-dd", $null) } else { $transazioniDal }
$extraBatchSize = if ($config.ExtraBatchSize) { [int]$config.ExtraBatchSize } else { 1000 }
$extraMaxBatches = if ($config.ExtraMaxBatches) { [int]$config.ExtraMaxBatches } else { 10 }
$extraAnagraficheOgniOre = if ($config.ExtraAnagraficheOgniOre) { [double]$config.ExtraAnagraficheOgniOre } else { 6 }
$extraRefreshOgniOre = if ($config.ExtraRefreshOgniOre) { [double]$config.ExtraRefreshOgniOre } else { 6 }
$extraRefreshGiorniIndietro = if ($config.ExtraRefreshGiorniIndietro) { [int]$config.ExtraRefreshGiorniIndietro } else { 60 }

# Le colonne datetime di SQL Server arrivano a Supabase come istanti (timestamptz);
# quelle che sono solo una data si convertono qui in testo yyyy-MM-dd:
# CONVERT(char(10), col, 23). I flag smallint diventano boolean con CAST(.. AS bit).
function Get-SelectAccessi {
    param([string]$Alias, [string]$Origine)
    return @"
$Alias.IDAccesso AS source_accesso_id, '$Origine' AS origine, $Alias.IDUtente AS source_utente_id,
$Alias.IDFamigliaTerminale AS source_terminale_id, $Alias.Indirizzo AS indirizzo,
$Alias.IDConcentratore AS source_concentratore_id, $Alias.IDServizio AS source_servizio_id,
$Alias.DataAccesso AS data_accesso, $Alias.TipoServizio AS tipo_servizio, $Alias.TipoAccesso AS tipo_accesso,
$Alias.IDIscrizione AS source_iscrizione_id, $Alias.TipoServizioIscrizione AS tipo_servizio_iscrizione,
$Alias.IDAutomazione AS source_automazione_id
"@
}

$defsExtra = @(
    # ──────────────────────────────────── persone senza acquisti
    # Gli utenti Info4U che non hanno mai comprato (lead, walk-in, prove): le
    # vendite creano le persone, questi no. Si importano con la stessa logica
    # di deduplicazione delle vendite (Send-PersoneUpsert). Cursore su IDUtente
    # nella riga persone_senza_acquisti di sync_info4u_stato. 250 persone per
    # blocco: ognuna costa quattro chiamate a Supabase.
    @{ Nome = "persone_senza_acquisti"; Modo = "Persone"; BatchSize = 250; MaxBatches = 2 },

    # ───────────────────────────────────────────────── decodifiche (piccole)
    @{ Nome = "crm_tipi_azione"; Tabella = "crm_tipi_azione"; Modo = "Anagrafica"; ChiaveCol = "source_tipo_id"
       Select = "t.IDTipo AS source_tipo_id, t.Descrizione AS descrizione, CAST(t.Attivo AS bit) AS attivo"
       From = "dbo.AppuntamentiTipo t" },
    @{ Nome = "crm_esiti_azione"; Tabella = "crm_esiti_azione"; Modo = "Anagrafica"; ChiaveCol = "source_esito_id"
       Select = "e.IDEsito AS source_esito_id, e.Descrizione AS descrizione, CAST(e.Attivo AS bit) AS attivo"
       From = "dbo.AppuntamentiEsito e" },
    @{ Nome = "crm_stati_commerciali"; Tabella = "crm_stati_commerciali"; Modo = "Anagrafica"; ChiaveCol = "source_stato_id"
       Select = "s.IDStatoCommerciale AS source_stato_id, s.NomeStato AS nome, CAST(s.Attivo AS bit) AS attivo"
       From = "dbo.AppuntamentiStato s" },
    # Solo nome e ruolo: mai Login, Password*, Email, impronte.
    @{ Nome = "operatori_categorie_info4u"; Tabella = "operatori_categorie_info4u"; Modo = "Anagrafica"; ChiaveCol = "source_categoria_id"
       Select = "oc.IDOperatoreCategoria AS source_categoria_id, oc.Descrizione AS descrizione"
       From = "dbo.OperatoriCategorie oc" },
    @{ Nome = "operatori_info4u"; Tabella = "operatori_info4u"; Modo = "Anagrafica"; ChiaveCol = "source_operatore_id"
       Select = "o.IDOperatore AS source_operatore_id, o.NomeOperatore AS nome, o.IDOperatoreCategoria AS source_categoria_id, CAST(o.Attivo AS bit) AS attivo, CAST(o.Venditore AS bit) AS venditore, CAST(o.Istruttore AS bit) AS istruttore, CAST(o.Eliminato AS bit) AS eliminato"
       From = "dbo.Operatori o" },
    @{ Nome = "prenotazioni_catalogo"; Tabella = "prenotazioni_catalogo"; Modo = "Anagrafica"; ChiaveCol = "source_prenotazione_id"
       Select = "p.IDPrenotazione AS source_prenotazione_id, p.IDCategoriaPrenotazione AS source_categoria_id, p.Descrizione AS descrizione, CAST(p.Attivo AS bit) AS attivo, p.Costo AS costo, p.MaxPrenotazioni AS max_prenotazioni, p.DurataMinuti AS durata_minuti, p.DataInizio AS data_inizio, p.DataFine AS data_fine"
       From = "dbo.Prenotazioni p" },
    @{ Nome = "prenotazioni_lezioni"; Tabella = "prenotazioni_lezioni"; Modo = "Anagrafica"; ChiaveCol = "source_lezione_id"
       Select = "l.IDPrenotazioneLezione AS source_lezione_id, l.IDPrenotazione AS source_prenotazione_id, l.DataInizio AS data_inizio, l.DataFine AS data_fine, CONVERT(char(5), l.OraInizio, 108) AS ora_inizio, CONVERT(char(5), l.OraFine, 108) AS ora_fine, l.GGWeek AS giorni_settimana, l.IDIstruttore AS source_istruttore_id"
       From = "dbo.PrenotazioniLezioni l" },
    @{ Nome = "esiti_accesso"; Tabella = "esiti_accesso"; Modo = "Anagrafica"; ChiaveCol = "numero_esito"
       Select = "ea.NumeroEsito AS numero_esito, ea.Descrizione AS descrizione"
       From = "dbo.EsitiAccesso ea" },
    @{ Nome = "terminali_info4u"; Tabella = "terminali_info4u"; Modo = "Anagrafica"; OnConflict = "source_terminale_id,indirizzo,source_concentratore_id"
       Select = "t.IDFamigliaTerminale AS source_terminale_id, t.Indirizzo AS indirizzo, t.IDConcentratore AS source_concentratore_id, t.Descrizione AS descrizione, CAST(t.Attivo AS bit) AS attivo, CAST(t.Ingresso AS bit) AS ingresso, CAST(t.Uscita AS bit) AS uscita, t.Direzione AS direzione, t.ZonaNr AS zona_nr, t.ZonaVerso AS zona_verso"
       From = "dbo.Terminali t" },

    # ────────────────────────────────────────────── azioni CRM dei consulenti
    # La pratica commerciale (la «trattativa» di una persona): cambia di stato
    # e si chiude, e un'azione del 2024 puo' stare su una pratica aperta nel
    # 2022. Quindi non si filtra solo per data di creazione: si copiano anche
    # le pratiche toccate dal 2023 (stato, chiusura) o con almeno un'azione
    # dal 2023. Un watermark sull'ID non basterebbe (le pratiche vecchie hanno
    # ID bassi): si riscrivono tutte, a blocchi, come le tabelle di decodifica.
    @{ Nome = "crm_pratiche"; Tabella = "crm_pratiche"; Modo = "Anagrafica"; ChiaveCol = "source_pratica_id"
       Select = "c.IDAppuntamentoCategoriaUtente AS source_pratica_id, c.IDAppuntamentoCategoria AS source_categoria_id, LEFT(c.Descrizione, 200) AS descrizione, c.IDUtente AS source_utente_id, c.DataCreazione AS data_creazione, c.IDStatoCommerciale AS source_stato_id, c.DataStato AS data_stato, c.DataChiusura AS data_chiusura, c.Valore AS valore"
       From = "dbo.AppuntamentiCategorieUtenti c"
       Dal = "(c.DataCreazione >= @Dal OR c.DataStato >= @Dal OR c.DataChiusura >= @Dal OR EXISTS (SELECT 1 FROM dbo.AppuntamentiStorico a WHERE a.IDAppuntamentoCategoriaUtente = c.IDAppuntamentoCategoriaUtente AND a.DataAppuntamento >= @Dal))" },
    # L'azione: info4u non porta l'IDUtente, solo la pratica. Chi l'ha scritta
    # e' IDOperatoreAutore. ~90% sono azioni automatiche (vedi la vista
    # crm_azioni_dettaglio.automatica).
    @{ Nome = "crm_azioni"; Tabella = "crm_azioni"; Modo = "Incrementale"; ChiaveCol = "source_azione_id"; IdSql = "a.IDAppuntamento"
       Select = "a.IDAppuntamento AS source_azione_id, a.IDAppuntamentoCategoriaUtente AS source_pratica_id, a.IDOperatoreAutore AS operatore_autore_id, a.IDOperatoreDest AS operatore_dest_id, a.DataAppuntamento AS data_appuntamento, a.Tipo AS source_tipo_id, a.Esito AS source_esito_id, LEFT(a.Descrizione, 500) AS descrizione, a.DataEvasione AS data_evasione, a.IDStatoCommerciale AS source_stato_id, a.DataPresaInCarico AS data_presa_in_carico"
       From = "dbo.AppuntamentiStorico a"
       Dal = "a.DataAppuntamento >= @Dal"
       RefreshWhere = "a.DataAppuntamento >= @Soglia OR a.DataEvasione >= @Soglia OR a.DataPresaInCarico >= @Soglia" },
    # Pochi memo (~300): si riscrivono tutti.
    @{ Nome = "crm_memo"; Tabella = "crm_memo"; Modo = "Anagrafica"; ChiaveCol = "source_memo_id"
       Select = "m.IDMemo AS source_memo_id, m.IDUtente AS source_utente_id, m.IDOperatore AS operatore_id, m.Oggetto AS oggetto, LEFT(m.Descrizione, 2000) AS descrizione, m.UltimaModifica AS ultima_modifica, m.DataOperazione AS data_operazione"
       From = "dbo.Memo m"
       Dal = "m.DataOperazione >= @Dal" },

    # ───────────────────────────────────────────────────── comunicazioni
    # Senza il corpo del messaggio (Messaggio) e senza l'indirizzo del destinatario.
    @{ Nome = "email_info4u"; Tabella = "email_info4u"; Modo = "Incrementale"; ChiaveCol = "source_email_id"; IdSql = "e.IDEmail"
       Select = "e.IDEmail AS source_email_id, e.IDUtente AS source_utente_id, e.IDOperatore AS operatore_id, e.DataCreazione AS data_creazione, LEFT(e.Oggetto, 100) AS oggetto, e.Stato AS stato, e.Tipo AS tipo, e.DataInvio AS data_invio, LEFT(e.Errore, 300) AS errore, LEFT(e.MittenteNome, 100) AS mittente_nome"
       From = "dbo.Email e"
       Dal = "e.DataCreazione >= @Dal"
       RefreshWhere = "e.DataCreazione >= @Soglia OR e.DataInvio >= @Soglia" },

    # ──────────────────────────────────────────────── idoneita' e quote
    # Un certificato emesso prima del 2023 puo' essere ancora valido: conta
    # anche la scadenza.
    @{ Nome = "certificati"; Tabella = "certificati"; Modo = "Incrementale"; ChiaveCol = "source_certificato_id"; IdSql = "c.IDCertificato"
       Select = "c.IDCertificato AS source_certificato_id, c.IDUtente AS source_utente_id, LEFT(c.Descrizione, 100) AS descrizione, CONVERT(char(10), c.DataEmissione, 23) AS data_emissione, CONVERT(char(10), c.DataScadenza, 23) AS data_scadenza"
       From = "dbo.Certificati c"
       Dal = "(c.DataEmissione >= @Dal OR c.DataScadenza >= @Dal)"
       RefreshWhere = "c.DataEmissione >= @Soglia" },
    @{ Nome = "quote_associative"; Tabella = "quote_associative"; Modo = "Incrementale"; ChiaveCol = "source_quota_id"; IdSql = "q.IDQuotaAssociativa"
       Select = "q.IDQuotaAssociativa AS source_quota_id, q.IDUtente AS source_utente_id, CONVERT(char(10), q.DataInizio, 23) AS data_inizio, CONVERT(char(10), q.DataFine, 23) AS data_fine, q.Importo AS importo, q.IDAbbonamentoIscrizione AS source_iscrizione_id"
       From = "dbo.QuoteAssociative q"
       Dal = "q.DataInizio >= @Dal" },

    # ──────────────────────────────────────── prenotazioni, corsi, omaggi
    @{ Nome = "prenotazioni_iscrizioni"; Tabella = "prenotazioni_iscrizioni"; Modo = "Incrementale"; ChiaveCol = "source_piscrizione_id"; IdSql = "p.IDPIscrizione"
       Select = "p.IDPIscrizione AS source_piscrizione_id, p.IDUtente AS source_utente_id, p.IDPrenotazione AS source_prenotazione_id, p.IDOperatore AS operatore_id, p.NomeOperatore AS operatore_nome, p.DataInizio AS data_inizio, p.DataFine AS data_fine, p.Totale AS totale, p.DataOperazione AS data_operazione, p.IDPrenotazioneLezione AS source_lezione_id, p.OrigineTipo AS origine_tipo, p.OrigineID AS origine_id"
       From = "dbo.PrenotazioniIscrizione p"
       Dal = "p.DataOperazione >= @Dal"
       RefreshWhere = "p.DataOperazione >= @Soglia" },
    @{ Nome = "corsi_iscrizioni"; Tabella = "corsi_iscrizioni"; Modo = "Incrementale"; ChiaveCol = "source_iscrizione_corso_id"; IdSql = "c.IDIscrizione"
       Select = "c.IDIscrizione AS source_iscrizione_corso_id, c.IDUtente AS source_utente_id, c.IDCorso AS source_corso_id, c.IDAbbonamentoIscrizione AS source_iscrizione_id, c.IDOperatore AS operatore_id, c.DataInizio AS data_inizio, c.DataFine AS data_fine, c.Importo AS importo, c.DataOperazione AS data_operazione, CAST(c.Terminato AS bit) AS terminato, c.NrLezioni AS nr_lezioni, c.PostiOccupati AS posti_occupati, c.IDPrenotazioneIscrizione AS source_piscrizione_id"
       From = "dbo.CorsiIscrizione c"
       Dal = "c.DataOperazione >= @Dal"
       RefreshWhere = "c.DataOperazione >= @Soglia OR c.DataFine >= @Soglia" },
    # Omaggi: OmaggiUsati sale a ogni utilizzo, quindi il refresh rilegge i validi.
    @{ Nome = "omaggi_iscrizioni"; Tabella = "omaggi_iscrizioni"; Modo = "Incrementale"; ChiaveCol = "source_omaggio_iscrizione_id"; IdSql = "o.IDIscrizioniOmaggio"
       Select = "o.IDIscrizioniOmaggio AS source_omaggio_iscrizione_id, o.IDUtente AS source_utente_id, o.IDOmaggio AS source_omaggio_id, o.IDIscrizione AS source_iscrizione_id, CONVERT(char(10), o.DataInizio, 23) AS data_inizio, CONVERT(char(10), o.DataFine, 23) AS data_fine, o.OmaggiTotali AS omaggi_totali, o.OmaggiUsati AS omaggi_usati, o.IDClub AS source_club_id"
       From = "dbo.IscrizioniOmaggioGenerali o"
       Dal = "(o.DataInizio >= @Dal OR o.DataFine >= @Dal)"
       RefreshWhere = "o.DataFine >= @Soglia OR o.DataInizio >= @Soglia" },

    # ────────────────────────────────────────────────────────── ricevute
    # Senza Cliente, indirizzi, partita IVA, codice fiscale, note e codice lotteria.
    @{ Nome = "ricevute"; Tabella = "ricevute"; Modo = "Incrementale"; ChiaveCol = "source_ricevuta_id"; IdSql = "r.IDRicevuta"
       Select = "r.IDRicevuta AS source_ricevuta_id, r.IDRicevuteAzienda AS azienda_id, r.NumeroRicevuta AS numero, r.TipoRicevuta AS tipo, CONVERT(char(10), r.DataRicevuta, 23) AS data_ricevuta, CAST(r.Annullata AS bit) AS annullata, r.TipoPagamento AS tipo_pagamento, r.IDUtente AS source_utente_id, CAST(r.Acconto AS bit) AS acconto, r.IDOperatore AS operatore_id, CAST(r.Bloccata AS bit) AS bloccata, r.DataSaldo AS data_saldo, r.TipoPagamentoSaldo AS tipo_pagamento_saldo, r.FEStatoElaborazione AS fe_stato, r.FEDataElaborazione AS fe_data_elaborazione, r.FEDataScartoSDI AS fe_data_scarto_sdi, r.RTNrScontrino AS rt_nr_scontrino, r.RTDataScontrino AS rt_data_scontrino, r.RTDataAnnullo AS rt_data_annullo, r.DataOraRicevuta AS data_ora_ricevuta, CAST(r.InviataEmail AS bit) AS inviata_email"
       From = "dbo.RicevuteTestata r"
       Dal = "r.DataRicevuta >= @Dal"
       RefreshWhere = "r.DataRicevuta >= @Soglia OR r.FEDataElaborazione >= @Soglia OR r.RTDataAnnullo >= @Soglia" },
    @{ Nome = "ricevute_righe"; Tabella = "ricevute_righe"; Modo = "Incrementale"; ChiaveCol = "source_riga_id"; IdSql = "rr.IDRicevuteRiga"
       Select = "rr.IDRicevuteRiga AS source_riga_id, rr.IDRicevuta AS source_ricevuta_id, rr.Qta AS qta, LEFT(rr.Descrizione, 300) AS descrizione, rr.PrezzoUnitario AS prezzo_unitario, rr.IVA AS iva, rr.IDCassaMovimento AS source_movimento_id, rr.Tipo AS tipo, rr.IDCentroRicavo AS centro_ricavo_id, rr.IvaDescrizione AS iva_descrizione"
       From = "dbo.RicevuteRiga rr INNER JOIN dbo.RicevuteTestata r ON r.IDRicevuta = rr.IDRicevuta"
       Dal = "r.DataRicevuta >= @Dal"
       RefreshWhere = "r.DataRicevuta >= @Soglia" },

    # ────────────────────────────────────────────────────────── accessi
    # ~3,4 milioni di righe: blocchi grandi, e due watermark (storico e
    # corrente) perche' gli ID dell'archivio sono piu' bassi di quelli della
    # tabella corrente. Gli accessi non cambiano: nessun refresh. Senza Tessera,
    # Descrizione (fino a 6000 caratteri) e NomeUtente.
    @{ Nome = "accessi_storico"; Tabella = "accessi"; Modo = "Incrementale"; ChiaveCol = "source_accesso_id"; IdSql = "x.IDAccesso"
       Select = (Get-SelectAccessi -Alias "x" -Origine "S"); From = "dbo.AccessiStorico x"
       Dal = "x.DataAccesso >= @Dal"; WatermarkFiltro = "&origine=eq.S"; BatchSize = 5000 },
    @{ Nome = "accessi_corrente"; Tabella = "accessi"; Modo = "Incrementale"; ChiaveCol = "source_accesso_id"; IdSql = "x.IDAccesso"
       Select = (Get-SelectAccessi -Alias "x" -Origine "A"); From = "dbo.Accessi x"
       Dal = "x.DataAccesso >= @Dal"; WatermarkFiltro = "&origine=eq.A"; BatchSize = 5000 }
)

function Get-StatoExtra {
    param([string]$Chiave)
    $url = "$($config.Supabase.Url)/rest/v1/sync_info4u_stato?chiave=eq.$Chiave&select=valore"
    $risposta = Invoke-RestMethod -Uri $url -Headers $supabaseHeaders -Method Get
    if ($risposta.Count -gt 0) { return [datetime]$risposta[0].valore }
    return $null
}

function Set-StatoExtra {
    param([string]$Chiave, [datetime]$Quando)
    $corpo = @{ chiave = $Chiave; valore = $Quando.ToString("o") } | ConvertTo-Json
    $headers = $supabaseHeaders.Clone()
    $headers["Prefer"] = "resolution=merge-duplicates"
    Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/sync_info4u_stato?on_conflict=chiave" `
        -Headers $headers -Method Post -Corpo $corpo | Out-Null
}

# True se e' passato almeno $Ore dall'ultima volta registrata sotto $Chiave
# (o se non e' mai stata fatta).
function Test-ScadutoExtra {
    param([string]$Chiave, [double]$Ore)
    $ultimo = Get-StatoExtra $Chiave
    if (-not $ultimo) { return $true }
    return ((New-TimeSpan -Start $ultimo -End (Get-Date)).TotalHours -ge $Ore)
}

function Get-UltimoIdExtra {
    param($Def)
    $filtro = if ($Def.WatermarkFiltro) { $Def.WatermarkFiltro } else { "" }
    $url = "$($config.Supabase.Url)/rest/v1/$($Def.Tabella)?select=$($Def.ChiaveCol)&order=$($Def.ChiaveCol).desc&limit=1$filtro"
    $risposta = Invoke-RestMethod -Uri $url -Headers $supabaseHeaders -Method Get
    if ($risposta.Count -gt 0) { return [int64]$risposta[0].($Def.ChiaveCol) }
    return 0
}

# Un valore letto da dbgym nel formato che PostgREST/JSON si aspetta.
function Convert-ValoreExtra {
    param($Valore)
    if ($null -eq $Valore -or $Valore -is [System.DBNull]) { return $null }
    if ($Valore -is [datetime]) { return Get-IstantePulito $Valore }
    if ($Valore -is [string]) { return Get-TestoPulito $Valore }
    if ($Valore -is [decimal] -or $Valore -is [double] -or $Valore -is [single]) { return [double]$Valore }
    return $Valore
}

function Send-RigheExtra {
    param($Def, [array]$Righe)

    $onConflict = if ($Def.OnConflict) { $Def.OnConflict } else { $Def.ChiaveCol }
    $visti = @{}
    $corpoRighe = foreach ($r in $Righe) {
        # Dedup per sicurezza (PostgREST rifiuta un upsert che tocca due
        # volte la stessa chiave nello stesso comando).
        if ($Def.ChiaveCol) {
            $chiave = [string]$r.($Def.ChiaveCol)
            if ($visti.ContainsKey($chiave)) { continue }
            $visti[$chiave] = $true
        }
        $riga = [ordered]@{}
        foreach ($p in $r.PSObject.Properties) { $riga[$p.Name] = Convert-ValoreExtra $p.Value }
        $riga
    }
    if (-not $corpoRighe) { return }

    $url = "$($config.Supabase.Url)/rest/v1/$($Def.Tabella)?on_conflict=$onConflict"
    $corpo = $corpoRighe | ConvertTo-Json -Depth 5
    $headers = $supabaseHeaders.Clone()
    $headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    Invoke-SupabaseScrittura -Uri $url -Headers $headers -Method Post -Corpo $corpo | Out-Null
}

# Legge a blocchi da dbgym le righe con chiave > cursore che soddisfano
# $Condizione, le scrive su Supabase e restituisce quante ne ha copiate e se
# ha raggiunto la fine (un blocco piu' corto della dimensione chiesta).
function Copy-BlocchiExtra {
    param($Def, [string]$Condizione, [int64]$Cursore, [datetime]$Soglia, [int]$DimensioneBlocco, [int]$MaxBlocchi, [string]$Etichetta)

    $copiate = 0
    $allaFine = $false
    for ($blocco = 1; $blocco -le $MaxBlocchi; $blocco++) {
        $comandoText = "SELECT TOP ($DimensioneBlocco) $($Def.Select)`nFROM $($Def.From)`nWHERE $($Def.IdSql) > @LastId AND ($Condizione)`nORDER BY $($Def.IdSql) ASC"
        $righe = Invoke-QueryDbgym -CommandText $comandoText -Parametri @{ "@LastId" = $Cursore; "@Dal" = $extraDal; "@Soglia" = $Soglia }
        if ($righe.Count -eq 0) { $allaFine = $true; break }

        Send-RigheExtra -Def $Def -Righe $righe

        $Cursore = [int64]$righe[$righe.Count - 1].($Def.ChiaveCol)
        $copiate += $righe.Count
        Write-Log "$Etichetta, blocco ${blocco}: $($righe.Count) righe, cursore ora a $Cursore."

        if ($righe.Count -lt $DimensioneBlocco) { $allaFine = $true; break }
    }
    return @{ Copiate = $copiate; AllaFine = $allaFine }
}

function Get-CursorePersoneSenzaAcquisti {
    $url = "$($config.Supabase.Url)/rest/v1/sync_info4u_stato?chiave=eq.persone_senza_acquisti&select=cursore"
    $risposta = Invoke-RestMethod -Uri $url -Headers $supabaseHeaders -Method Get
    if ($risposta.Count -gt 0 -and $null -ne $risposta[0].cursore) { return [int64]$risposta[0].cursore }
    return 0
}

function Set-CursorePersoneSenzaAcquisti {
    param([int64]$Cursore)
    $corpo = @{
        chiave        = "persone_senza_acquisti"
        valore        = (Get-Date).ToString("o")
        cursore       = $Cursore
        aggiornato_il = (Get-Date).ToString("o")
    } | ConvertTo-Json
    $headers = $supabaseHeaders.Clone()
    $headers["Prefer"] = "resolution=merge-duplicates"
    Invoke-SupabaseScrittura -Uri "$($config.Supabase.Url)/rest/v1/sync_info4u_stato?on_conflict=chiave" `
        -Headers $headers -Method Post -Corpo $corpo | Out-Null
}

# Gli utenti Info4U senza nessuna vendita e con un nome (trova_o_crea_persona
# esclude quelli senza). Chi comprera' dopo ha gia' la sua scheda: la vendita
# la trova per source_utente_id. persona_id sulle righe dei dati aggiuntivi lo
# riempie il trigger persone_collega_info4u.
function Sync-PersoneSenzaAcquisti {
    param($Def)

    $dimensioneBlocco = if ($Def.BatchSize) { [int]$Def.BatchSize } else { 250 }
    $maxBlocchi = if ($Def.MaxBatches) { [int]$Def.MaxBatches } else { 2 }

    $cursore = Get-CursorePersoneSenzaAcquisti
    Write-Log "Persone senza acquisti, cursore di partenza: IDUtente > $cursore"

    $totale = 0
    for ($blocco = 1; $blocco -le $maxBlocchi; $blocco++) {
        $comandoText = @"
SELECT TOP ($dimensioneBlocco)
    u.IDUtente, u.Nome, u.Cognome, u.Email, u.Telefono_1, u.Telefono_2, u.SMS AS Cellulare,
    u.CodiceFiscale, u.Data_Nascita, u.Sesso,
    u.Indirizzo_Via, u.Indirizzo_NumeroCivico, u.Indirizzo_CAP,
    u.Indirizzo_Citta, u.Indirizzo_PV, u.Indirizzo_Stato
FROM dbo.Utenti u
WHERE u.IDUtente > @LastId
  AND LTRIM(RTRIM(ISNULL(u.Nome, ''))) <> ''
  AND NOT EXISTS (SELECT 1 FROM dbo.AbbonamentiIscrizione ai WHERE ai.IDUtente = u.IDUtente)
ORDER BY u.IDUtente ASC
"@
        $righe = Invoke-QueryDbgym -CommandText $comandoText -Parametri @{ "@LastId" = $cursore }
        if ($righe.Count -eq 0) {
            Write-Log "Persone senza acquisti: nessun nuovo utente, al passo con la sorgente."
            break
        }

        Send-PersoneUpsert -Righe $righe | Out-Null

        $cursore = [int64]$righe[$righe.Count - 1].IDUtente
        Set-CursorePersoneSenzaAcquisti $cursore
        $totale += $righe.Count
        Write-Log "Persone senza acquisti, blocco ${blocco}: $($righe.Count) persone, cursore ora a $cursore."

        if ($righe.Count -lt $dimensioneBlocco) { break }
    }
    Write-Log "Persone senza acquisti: $totale persone importate in questa esecuzione."
}

function Sync-DefExtra {
    param($Def)

    $nome = $Def.Nome
    if ($Def.Modo -eq "Persone") { Sync-PersoneSenzaAcquisti -Def $Def; return }
    $dimensioneBlocco = if ($Def.BatchSize) { [int]$Def.BatchSize } else { $extraBatchSize }
    $maxBlocchi = if ($Def.MaxBatches) { [int]$Def.MaxBatches } else { $extraMaxBatches }
    $condizioneDal = if ($Def.Dal) { $Def.Dal } else { "1=1" }
    $soglia = (Get-Date).Date.AddDays(-$extraRefreshGiorniIndietro)
    if ($soglia -lt $extraDal) { $soglia = $extraDal }

    # Tabelle piccole: si riscrivono per intero, ogni $extraAnagraficheOgniOre ore.
    if ($Def.Modo -eq "Anagrafica") {
        if (-not (Test-ScadutoExtra "extra_anagrafica_$nome" $extraAnagraficheOgniOre)) { return }

        $comandoText = "SELECT $($Def.Select)`nFROM $($Def.From)`nWHERE $condizioneDal"
        $righe = Invoke-QueryDbgym -CommandText $comandoText -Parametri @{ "@Dal" = $extraDal }
        for ($i = 0; $i -lt $righe.Count; $i += 500) {
            $fine = [math]::Min($i + 499, $righe.Count - 1)
            Send-RigheExtra -Def $Def -Righe @($righe[$i..$fine])
        }
        Set-StatoExtra "extra_anagrafica_$nome" (Get-Date)
        Write-Log "${nome}: $($righe.Count) righe riscritte."
        return
    }

    # Righe nuove: ID oltre il watermark.
    $ultimoId = Get-UltimoIdExtra $Def
    Write-Log "${nome}, watermark di partenza: $($Def.ChiaveCol) > $ultimoId"
    $esito = Copy-BlocchiExtra -Def $Def -Condizione $condizioneDal -Cursore $ultimoId -Soglia $soglia `
        -DimensioneBlocco $dimensioneBlocco -MaxBlocchi $maxBlocchi -Etichetta $nome
    Write-Log "${nome}: $($esito.Copiate) righe nuove in questa esecuzione."

    # Finche' lo storico non e' tutto dentro le righe recenti non sono nemmeno
    # arrivate: il refresh solo a giro completo.
    if (-not $esito.AllaFine) {
        Write-Log "${nome}: storico ancora in corso, salto il refresh di questo giro."
        return
    }
    if (-not $Def.RefreshWhere) { return }
    if (-not (Test-ScadutoExtra "extra_refresh_$nome" $extraRefreshOgniOre)) { return }

    Write-Log "${nome}: refresh delle righe che possono essere cambiate (dal $($soglia.ToString('yyyy-MM-dd')))."
    $condizioneRefresh = "($($Def.RefreshWhere)) AND ($condizioneDal)"
    $refresh = Copy-BlocchiExtra -Def $Def -Condizione $condizioneRefresh -Cursore 0 -Soglia $soglia `
        -DimensioneBlocco $dimensioneBlocco -MaxBlocchi $maxBlocchi -Etichetta "$nome refresh"
    Write-Log "${nome}: $($refresh.Copiate) righe riprocessate dal refresh."

    # Segnato solo a giro completo: se si interrompe, il prossimo riparte.
    if ($refresh.AllaFine) { Set-StatoExtra "extra_refresh_$nome" (Get-Date) }
}

function Sync-Extra {
    if (-not $extraAttivo) { return }

    $errori = @()
    foreach ($def in $defsExtra) {
        if ($SoloExtra.Count -gt 0 -and $SoloExtra -notcontains $def.Nome) { continue }
        try {
            Sync-DefExtra -Def $def
        }
        catch {
            $dettaglio = Get-CorpoErrore $_
            Write-Log "ERRORE su $($def.Nome): $($_.Exception.Message)$(if ($dettaglio) { " - dettaglio: $dettaglio" })" "ERROR"
            $errori += $def.Nome
        }
    }
    if ($errori.Count -gt 0) { throw "Dati aggiuntivi: errore su $($errori -join ', ')." }
}

# ─────────────────────────────────────────────────────────────────── run

Write-Log "Avvio sincronizzazione."

try {
    if ($SoloExtra.Count -gt 0) {
        Write-Log "Solo dati aggiuntivi: $($SoloExtra -join ', ')."
        Sync-Extra
        Write-Log "Fine (solo dati aggiuntivi)."
        exit 0
    }

    $catalogo = Get-CatalogoInfo4U
    Write-Log "Catalogo Info4U letto: $($catalogo.Count) prodotti."

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

    Sync-CatalogoProdotti

    # Refresh delle vendite aperte + riconciliazione cancellazioni: non a
    # ogni giro da 5 minuti (costerebbe una scansione di tutte le vendite
    # aperte ogni volta per un beneficio che cambia raramente), ma ogni
    # $refreshApertiOgniOre — il watermark che decide "e' ora?" vive su
    # Supabase (Get-UltimoRefreshAperti), non sull'orologio del task
    # schedulato, cosi' resta corretto anche se il task salta un giro o gira
    # a orari irregolari.
    #
    # Un refresh si spalma su piu' esecuzioni: ognuna fa al massimo
    # $batchesRefreshApertiPerGiro blocchi e salva il cursore dopo ciascuno
    # (Set-RefreshApertiInCorso). Se ce n'e' uno in corso si prosegue quello,
    # senza guardare la soglia di ore.
    $refreshInCorso = Get-RefreshApertiInCorso

    if (-not $refreshInCorso) {
        $ultimoRefreshAperti = Get-UltimoRefreshAperti
        $orePassate = if ($ultimoRefreshAperti) { (New-TimeSpan -Start $ultimoRefreshAperti -End (Get-Date)).TotalHours } else { [double]::PositiveInfinity }

        if ($orePassate -ge $refreshApertiOgniOre) {
            Write-Log "Refresh vendite aperte: ultimo giro $(if ($ultimoRefreshAperti) { "$([math]::Round($orePassate,1)) ore fa" } else { 'mai fatto' }) (soglia ${refreshApertiOgniOre}h) - riparto da capo."
            $refreshInCorso = @{ Inizio = (Get-Date); Cursore = 0 }
            Set-RefreshApertiInCorso -Inizio $refreshInCorso.Inizio -Cursore 0
        }
    } else {
        Write-Log "Refresh vendite aperte: in corso dal $($refreshInCorso.Inizio.ToString('yyyy-MM-dd HH:mm')), proseguo da IDIscrizione > $($refreshInCorso.Cursore)."
    }

    if ($refreshInCorso) {
        # Soglia calcolata dall'inizio del refresh, non da oggi: se il refresh
        # scavalca la mezzanotte, la finestra delle vendite "aperte" resta la
        # stessa dal primo all'ultimo blocco.
        $soglia = $refreshInCorso.Inizio.Date.AddDays(-$refreshApertiGiorniIndietro)
        $lastIdAperti = $refreshInCorso.Cursore
        $totaleRigheAperte = 0

        $refreshCompleto = $false
        for ($batch = 1; $batch -le $batchesRefreshApertiPerGiro; $batch++) {
            $righe = Get-RigheAperteDaSincronizzare -LastId $lastIdAperti -Top $batchSize -Soglia $soglia
            if ($righe.Count -eq 0) {
                $refreshCompleto = $true
                break
            }

            $mappaPersone = Send-PersoneUpsert -Righe $righe
            Send-AbbonamentiUpsert -Righe $righe -MappaPersone $mappaPersone

            $ultimaRiga = $righe[$righe.Count - 1]
            $lastIdAperti = [int]$ultimaRiga.IDIscrizione
            $totaleRigheAperte += $righe.Count
            Set-RefreshApertiInCorso -Inizio $refreshInCorso.Inizio -Cursore $lastIdAperti
            Write-Log "Refresh vendite aperte, batch ${batch}: $($righe.Count) righe, cursore ora a $lastIdAperti."

            if ($righe.Count -lt $batchSize) { $refreshCompleto = $true; break }
        }

        if ($refreshCompleto) {
            Compare-CancellazioniOrigine -Soglia $soglia

            # Segnato solo a refresh completato (incluse le eventuali
            # cancellazioni), con l'ora d'inizio: le vendite riprocessate per
            # prime sono aggiornate a quel momento, non alla fine. Poi il
            # cursore torna nullo, cioe' nessun refresh in corso.
            Set-UltimoRefreshAperti -Quando $refreshInCorso.Inizio
            Set-RefreshApertiInCorso -Inizio $refreshInCorso.Inizio -Cursore $null
            $oreDurata = (New-TimeSpan -Start $refreshInCorso.Inizio -End (Get-Date)).TotalHours
            Write-Log "Refresh vendite aperte: completato ($totaleRigheAperte righe in questa esecuzione, iniziato $([math]::Round($oreDurata,1)) ore fa)."
        } else {
            Write-Log "Refresh vendite aperte: $totaleRigheAperte righe in questa esecuzione, prosegue al prossimo giro da IDIscrizione > $lastIdAperti."
        }
    }

    Sync-Transazioni

    Sync-Rate

    Sync-ModificheAbbonamenti

    Sync-Extra
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
