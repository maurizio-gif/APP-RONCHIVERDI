# Sincronizzazione Info4U → Supabase

Uno script PowerShell, schedulato con il Task Scheduler di Windows,
**sullo stesso server dove gira SQL Server** (`SRVTEAMSYSTEM`, database
`dbgym`). Nessuna VPN: la connessione a SQL Server è locale, e lo script
parla con Supabase solo in uscita via HTTPS — lo stesso traffico che quel
server fa già per i normali aggiornamenti di Windows.

Legge le vendite (`AbbonamentiIscrizione`) — membership, campi, visite
mediche, shop, daily pass, omaggi, carnet, senza filtrare per tipo — e le
scrive su due tabelle Supabase: `persone` (anagrafica, riusando quella già
usata dal resto del CRM) e `abbonamenti` (una riga per vendita).

È **idempotente**: rieseguirlo non crea duplicati. Non tiene uno stato
locale — il punto da cui riprendere (`source_iscrizione_id` più alto già
scritto) lo rilegge da Supabase a ogni avvio, quindi si può interrompere,
spostare su un'altra macchina o rieseguire a mano senza rischi.

## 1. Prima di tutto: la migration su Supabase

Esegui `scripts/sql/2026-09-17-sync-info4u-abbonamenti.sql` nel SQL Editor
del progetto Supabase, **prima** di lanciare lo script per la prima volta.
Crea la tabella `abbonamenti` e aggiunge a `persone` le colonne che oggi non
abbiamo (codice fiscale, nascita, indirizzo, telefono secondario,
`source_utente_id`).

## 2. L'utente SQL di sola lettura

Se non l'hai già fatto (vedi lo scambio con ChatGPT che hai incollato),
sul server, connesso come amministratore in SQL Server Management Studio:

```sql
USE master;
CREATE LOGIN n8n_sync_ro WITH PASSWORD = 'una password forte';
USE dbgym;
CREATE USER n8n_sync_ro FOR LOGIN n8n_sync_ro;
ALTER ROLE db_datareader ADD MEMBER n8n_sync_ro;
```

Il nome è rimasto `n8n_sync_ro` per continuità con quello che avevi già
preparato, anche se qui n8n non c'entra più — lo script gira da solo.

## 3. Copiare questa cartella sul server

Copia l'intera cartella `ops/sync-info4u/` su `SRVTEAMSYSTEM`, per esempio
in `C:\Scripts\sync-info4u\`.

## 4. Configurare

Nella cartella copiata, duplica `config.example.json` in `config.json` e
riempilo:

```json
{
  "SqlServer": {
    "Server": "localhost",
    "Port": 1433,
    "Database": "dbgym",
    "User": "n8n_sync_ro",
    "Password": "la password di prima"
  },
  "Supabase": {
    "Url": "https://upoiasekisojikbzsymq.supabase.co",
    "ServiceRoleKey": "la service role key del progetto Ronchiverdi"
  },
  "BatchSize": 500,
  "MaxBatchesPerRun": 20,
  "RefreshApertiOgniOre": 20,
  "RefreshApertiGiorniIndietro": 400,
  "MaxBatchesRefreshAperti": 50
}
```

Le ultime tre chiavi sono per il refresh periodico delle vendite ancora
aperte (vedi sotto, "Cosa fa, in breve") — tutte opzionali, lo script usa
questi stessi valori come default se le ometti.

La service role key la trovi in `.env.local` di questo progetto
(`SUPABASE_SERVICE_ROLE_KEY`). **Non committare mai `config.json`** — è già
escluso da `.gitignore`, ma se lo copi altrove ricordalo: chi lo legge ha
accesso completo al database.

Su `SRVTEAMSYSTEM` limita anche i permessi NTFS della cartella a chi
gestisce il server e all'account che esegue il task.

## 5. Primo giro, a mano

Prima di schedulare qualunque cosa, prova a lanciarlo tu stesso da una
finestra PowerShell aperta come amministratore:

```powershell
cd C:\Scripts\sync-info4u
.\sync-abbonamenti.ps1
```

La prima volta non c'è ancora nulla su Supabase, quindi riparte da 0 e
sincronizza **tutto lo storico** — con ~193.000 righe in `dbgym` (il numero
che avevi visto tu), a 500 righe per batch e 20 batch per esecuzione fa
10.000 righe a giro: servono più esecuzioni per arrivare in fondo.
Lancialo a mano un po' di volte finché il log (`sync.log`, nella stessa
cartella) non dice "Nessuna nuova riga: sincronizzazione al passo con la
sorgente" — a quel punto lo storico è tutto dentro e si può schedulare.

Controlla anche su Supabase che `persone` e `abbonamenti` si stiano
popolando come ti aspetti, prima di proseguire.

## 6. Schedulare

Apri **Utilità di pianificazione** (Task Scheduler):

1. Crea attività (non "Crea attività di base", quella semplificata nasconde
   opzioni utili).
2. Generale: nome tipo "Sync Info4U → Supabase", **Esegui indipendentemente
   dalla connessione dell'utente**, utente con i permessi per leggere la
   cartella dello script.
3. Trigger: ogni 5 minuti (o quello che preferite — si può stringere in
   seguito).
4. Azione → Avvia un programma:
   - Programma: `powershell.exe`
   - Argomenti: `-NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\sync-info4u\sync-abbonamenti.ps1"`
5. Impostazioni: **non avviare una nuova istanza se ne è già in
   esecuzione una** — importante, altrimenti due esecuzioni sovrapposte
   potrebbero leggere lo stesso watermark e duplicare lavoro (non dati,
   grazie all'upsert, ma inutile carico).

Da qui in poi il log (`sync.log`) è il primo posto dove guardare se qualcosa
non torna: ogni riga dice quante vendite ha processato, a che
`source_iscrizione_id` è arrivato, e — se capita — quale persona era già in
anagrafica con la stessa email o lo stesso cellulare di un utente Info4U (in
quel caso lo script aggancia quella esistente invece di duplicarla).

## Cosa fa, in breve

- Legge `MAX(source_iscrizione_id)` da `abbonamenti` su Supabase.
- Interroga `dbgym` per le vendite con `IDIscrizione` più alto di quello, a
  blocchi.
- Per ogni vendita: upsert della persona (per `source_utente_id`, con
  fallback su email/cellulare se quella persona esiste già da un lead del
  sito) e poi upsert della vendita (per `source_iscrizione_id`).
- Si ferma da solo quando non trova più righe nuove, o dopo
  `MaxBatchesPerRun` blocchi in una singola esecuzione (per non far girare
  un'esecuzione all'infinito se lo storico da recuperare è enorme — il giro
  dopo riparte da dove si è fermato).
- Ogni `RefreshApertiOgniOre` ore (default 20 — il watermark di quando è
  stato fatto l'ultimo giro vive su Supabase, tabella `sync_info4u_stato`,
  non sull'orologio del task schedulato): rilegge da Info4U **tutte** le
  vendite ancora "aperte" in quel momento (`DataFine` nulla o non più
  vecchia di `RefreshApertiGiorniIndietro` giorni, default 400) e le
  riscrive — non solo quelle nuove. Serve a intercettare le modifiche a
  vendite già sincronizzate: una sospensione concessa dopo il primo sync
  sposta `DataFine` in avanti in Info4U, ma il watermark su `IDIscrizione`
  da solo non se ne accorgerebbe mai (non ripassa su un ID già sotto il
  watermark). Stesso discorso per una disdetta o una correzione tardiva.
- Nello stesso giro, confronta gli ID delle vendite che secondo Supabase
  risultano ancora aperte con quelli che Info4U restituisce davvero in quel
  momento: quelli che non ci sono più (un operatore li ha cancellati in
  Info4U dopo che il sync li aveva già scritti) vengono segnati
  `cancellato_il` — mai una `DELETE`, resta lo storico di cosa è stato
  sincronizzato e poi ritirato. `abbonamenti_attivi_al()` (vedi
  `2026-09-21-abbonamenti-attivi.sql`) le esclude già dal conteggio; le
  altre viste di reportistica (vendite mensili/giornaliere...) per ora no —
  vedi la nota in `2026-09-21-abbonamenti-cancellati.sql`.

## Cosa NON fa (ancora)

- Non fa nessuna automazione sui rinnovi o sulle scadenze.

## Scrittura verso Info4U: vendite da un front-end esterno

Tutto quanto sopra è a senso unico, Info4U → Supabase. Se invece si vuole
vendere abbonamenti con un front-end esterno (un negozio online costruito da
noi o da terzi, non Info4U) e far sì che, a pagamento avvenuto, la vendita
compaia come vendita vera in Info4U — non solo su Supabase — serve anche il
percorso inverso. Il pezzo che lo fa è **`scrivi-vendite.ps1`**, da mettere
accanto a `sync-abbonamenti.ps1` sullo stesso `SRVTEAMSYSTEM`.

Il giro completo, in quattro passi:

1. Il front-end esterno, a pagamento confermato, chiama `POST
   /api/vendite-esterne` di questo pannello (vedi
   `app/api/vendite-esterne/route.ts`) con un header `x-rv-shared-secret`
   (la stessa stringa di `VENDITE_ESTERNE_SHARED_SECRET`, mai esposta al
   browser) e il corpo della vendita — anagrafica, `source_durata_id` (**l'id
   vero della durata/prodotto in Info4U**, vedi il limite sotto), `totale`,
   `riferimento_esterno` (l'id dell'ordine lato loro, per l'idempotenza).
2. Quella richiesta scrive UNA riga su `vendite_esterne` (Supabase), con
   `stato = 'in_attesa'`. La route non tocca mai Info4U direttamente.
3. `scrivi-vendite.ps1`, schedulato con lo stesso meccanismo di
   `sync-abbonamenti.ps1` (Task Scheduler, "non avviare una nuova istanza se
   ne è già in esecuzione una"), legge le righe `in_attesa`, trova la
   persona in `dbo.Utenti` (per codice fiscale, poi email, poi cellulare) e
   crea la vendita in `dbo.AbbonamentiIscrizione`. Segna la riga `scritto`
   (con l'`IDIscrizione` assegnato) o `errore` (col motivo, senza ritentare
   da sola).
4. Da lì la vendita rientra per la strada normale: al giro successivo
   `sync-abbonamenti.ps1` la ritrova in Info4U come farebbe con una vendita
   fatta al banco, e popola `persone`/`abbonamenti` — chiudendo anche
   un'eventuale trattativa aperta, come per qualunque altra vendita (vedi
   "Collegamento alle trattative" sotto).

### Setup, in aggiunta a quanto sopra

1. Migration `scripts/sql/2026-09-21-vendite-esterne.sql` sul SQL Editor di
   Supabase (crea `vendite_esterne`; RLS attiva senza policy, ci scrivono
   solo la route con la service role key e questo script).
2. `VENDITE_ESTERNE_SHARED_SECRET` su Vercel (Project Settings → Environment
   Variables): una stringa lunga e casuale, es. `openssl rand -hex 32`.
   Comunicala solo al sistema esterno che vende gli abbonamenti.
3. **Un secondo login SQL, di sola scrittura**, distinto da `n8n_sync_ro`:
   questo script non deve avere gli stessi permessi ampi (`db_datareader`)
   del sync in lettura, gli basta poter inserire in una tabella sola.

   ```sql
   USE master;
   CREATE LOGIN n8n_sync_rw WITH PASSWORD = 'un'altra password forte';
   USE dbgym;
   CREATE USER n8n_sync_rw FOR LOGIN n8n_sync_rw;
   GRANT INSERT ON dbo.AbbonamentiIscrizione TO n8n_sync_rw;
   ```
4. Nel `config.json` (lo stesso file di `sync-abbonamenti.ps1`), il blocco
   `SqlServerScrittura` con quelle credenziali, più `IDClub` — l'id del club
   Info4U a cui assegnare le vendite online (vedi `config.example.json`).
5. Un secondo Task Scheduler per `scrivi-vendite.ps1`, stessa impostazione
   di non sovrapporre le esecuzioni. Il suo log è `scrivi-vendite.log`,
   nella stessa cartella.

### Limiti noti — da risolvere prima di andare in produzione sul serio

- **Non crea persone nuove in Info4U.** Se chi compra sul front-end esterno
  non esiste ancora in `dbo.Utenti` (codice fiscale/email/cellulare senza
  corrispondenza), la riga finisce `errore` invece di un `INSERT` alla
  cieca: non conosciamo tutti i vincoli di quella tabella (campi
  obbligatori, iscrizione a un club, numero tessera...) per rischiare
  un'anagrafica creata a metà. Va creata a mano in Info4U, poi la riga si
  rimette a `in_attesa`.
- **Il front-end deve già conoscere l'`IDDurata` vero di Info4U** del
  prodotto che vende: oggi non esiste una sincronizzazione in lettura del
  catalogo (`Abbonamenti`/`AbbonamentiDurata`) verso Supabase che gliela
  offra, quindi la mappatura prodotto-esterno → `IDDurata` è manuale.
  Costruire quel catalogo in sola lettura (stesso pattern di
  `sync-abbonamenti.ps1`, ma su `Abbonamenti`/`AbbonamentiDurata` invece che
  su `AbbonamentiIscrizione`) è il prossimo passo naturale, non ancora
  fatto.
- **L'elenco colonne scritte in `AbbonamentiIscrizione` non è verificato
  contro lo schema reale.** Viene da quello che `sync-abbonamenti.ps1`
  legge già (quindi sappiamo che quelle colonne esistono), ma una colonna
  NOT NULL senza DEFAULT che il sync in lettura non seleziona non la
  vedremmo comunque. Prima di schedulare `scrivi-vendite.ps1` sul serio,
  verificalo con SSMS — o meglio, prova un `INSERT` a mano dentro una
  transazione e fai `ROLLBACK`.
- `ImportoListino`/`ImportoCategoria` restano `NULL`: non sappiamo il
  prezzo di listino separato da quanto è stato davvero incassato
  (`Totale`), e un numero indovinato sarebbe peggio di un vuoto.

## Collegamento alle trattative

Ogni riga che questo script scrive in `abbonamenti` chiude da sola, come
**vinta**, la trattativa Club/Family ancora aperta della stessa persona (se
c'è) — con nome del prodotto e valore incassato come nota, e la data della
vendita stessa come data di chiusura. Non è nello script: è un trigger sul
lato Supabase, `abbonamenti_chiude_trattativa`
(`scripts/sql/2026-09-18-abbonamento-venduto-chiude-la-trattativa.sql`), che
scatta a ogni insert indipendentemente da come la riga ci arriva. I dettagli
e perché non tocca le vendite più vecchie di una trattativa aperta oggi
stanno nei commenti di quella migration.
