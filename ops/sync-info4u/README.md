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
anagrafica con la stessa email o lo stesso cellulare di un utente Info4U. In
quel caso lo script NON tocca mai quella persona se non è a sua volta
`fonte = 'info4u'` (cioè se è nata da un lead del sito, dal Guest Register o
da un inserimento a mano): crea invece una scheda separata per l'utente
Info4U, senza il campo in conflitto, con un puntatore
(`conflitto_con_persona_id`/`conflitto_campo`, vedi
scripts/sql/2026-09-22-persone-conflitto-info4u.sql) a chi possiede davvero
quel recapito — la scheda di entrambe lo segnala in
/dashboard/persone/[id] con un link, ed è uno staff a decidere se sono la
stessa persona.

## Cosa fa, in breve

- Legge `MAX(source_iscrizione_id)` da `abbonamenti` su Supabase.
- Interroga `dbgym` per le vendite con `IDIscrizione` più alto di quello, a
  blocchi.
- Per ogni vendita: upsert della persona (per `source_utente_id`; se quella
  persona non esiste ancora ed email/cellulare risultano già di un contatto
  di un'altra fonte, quel contatto non si tocca — vedi sopra) e poi upsert
  della vendita (per `source_iscrizione_id`).
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
