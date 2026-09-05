# Pannello Ronchiverdi

Pannello di gestione del Ronchiverdi Sport Club: le richieste che arrivano dal
sito, l'agenda degli appuntamenti, la timbratura del cartellino.

Next.js 14 (App Router) + Supabase, in deploy su Vercel. Stessa impostazione
del CRM del Tennis Club Ambrosiano, di cui questo pannello riprende i pattern —
autorizzazione da tabella, permessi per sezione, log operatori — con lo stile
grafico del sito Ronchiverdi.

## Database

Usa lo **stesso progetto Supabase del sito** (`upoiasekisojikbzsymq`): le
enquiries del pannello sono direttamente le righe che `/api/lead` scrive in
`form_contatti`, e le visite sono le `sessioni` che `/api/track` registra. Non
c'è nessuna sincronizzazione da mantenere fra due database.

Migration in `scripts/sql/`, da eseguire in ordine dal SQL Editor di Supabase.

## Avvio in locale

```bash
npm install
cp .env.local.example .env.local   # e riempi le chiavi da Supabase
npm run dev
```

## Primo accesso

Il pannello si autorizza dalla tabella `staff_users`, quindi il primo
amministratore va inserito a mano — vedi la coda di
`scripts/sql/2026-09-02-staff-e-audit.sql`. Serve anche l'utente corrispondente
in Supabase Auth (Authentication → Users). Da lì in avanti gli inviti si fanno
da **Gestione utenti**, che manda l'email con il link per scegliere la password.

Perché l'invito funzioni, `NEXT_PUBLIC_SITE_URL` deve essere configurata su
Vercel **e** comparire fra i Redirect URLs in Supabase Auth → URL
Configuration: altrimenti l'email parte con un link che non porta al pannello.
L'URL di produzione **non** è `app-ronchiverdi.vercel.app`: quel dominio
risponde 404 e non appartiene a questo progetto. Il progetto vive sul team
Vercel R2D e l'alias generato porta il suffisso del team:
`https://app-ronchiverdi-r2d.vercel.app`. Nella allowlist di Supabase va quindi
`https://app-ronchiverdi-r2d.vercel.app/auth/callback` (più
`http://localhost:3000/auth/callback` per provare gli inviti in locale), e le
due voci vanno aggiornate quando arriva il dominio personalizzato.

## Accesso dall'esterno

Il progetto ha la Vercel Authentication attiva in modalità
`all_except_custom_domains`: **ogni** indirizzo `*.vercel.app` chiede prima il
login a Vercel, quindi oggi il pannello è raggiungibile solo da chi è nel team
R2D — la segreteria no, nemmeno con le credenziali giuste. Un dominio
personalizzato è escluso dalla protezione, quindi collegarne uno (es.
`app.ronchiverdi.it`) risolve; l'alternativa è disattivare la Vercel
Authentication e lasciare che il login del pannello faccia da solo la guardia.
Sono due decisioni diverse: la prima tiene fuori i motori di ricerca e i
curiosi dagli indirizzi di preview, la seconda espone anche quelli.

## Permessi

Due livelli, entrambi in `staff_users`:

- **sezioni_consentite** — quali voci di menu vede la persona. Le chiavi sono
  definite una volta sola in [`lib/auth/sezioni.ts`](lib/auth/sezioni.ts).
- **puo_invitare** / **puo_cancellare** — amministrare il pannello, cancellare
  record. Controllati lato server nelle Server Action, non solo nascondendo i
  comandi nell'interfaccia.

Una sezione marcata `inArrivo` in `sezioni.ts` è un permesso già assegnabile il
cui modulo non è ancora costruito: appare nel menu disattivata, così nessuno
finisce su una pagina che non esiste.

## Voucher visita medica (partnership Chiron)

Gli abbonamenti sopra i €1.000 includono la visita medico-sportiva. Il diritto
viaggia su un **voucher monouso**: un codice numerico di otto cifre che il
socio detta al telefono al centro medico, e che si consuma nel momento in cui
la visita viene prenotata.

- **Emissione** — `/dashboard/voucher`, sezione `voucher`. Per ora il trigger
  è manuale: la segreteria inserisce il socio e il codice parte subito per
  email. Quando arriverà l'estrazione notturna dal gestionale scriverà sulla
  stessa tabella, e il form resterà per i casi fuori flusso.
- **Validazione** — `/dashboard/validazione`, sezione `validazione-voucher`:
  una cella e un pulsante. Al centro medico si creano account del pannello
  con **quella sola sezione** (casella «Accesso esterno» al momento
  dell'invito). La bruciatura scrive timestamp e operatore sul database del
  Club, e manda al socio la notifica di utilizzo: nessun uso può avvenire a
  sua insaputa.

  La sezione è marcata `esterna` in `sezioni.ts`: chi ha soltanto sezioni
  esterne non è della segreteria, quindi non vede il Riepilogo — che parla di
  trattative, richieste e impegni — e viene mandato direttamente alla sua
  pagina. Il controllo è nel Server Component, non solo nel menu.
- **Email** — SendGrid, chiamato via `fetch` da `lib/email.ts` dentro la
  funzione Vercel della Server Action. I testi stanno tutti in
  `lib/voucher-email.ts` perché sono comunicazioni concordate con il partner.
  Se l'invio fallisce il voucher esiste comunque e l'elenco lo segna «email
  non partita», con il pulsante per rimandarla.

Il certificato **non passa da qui**: arriva dal socio alla casella dedicata
(`EMAIL_CERTIFICATI`), citata in tutte le email. Nessun dato sanitario entra
nel database, e nessun dato del socio viene trasmesso al partner: è il socio
a presentarsi con il codice.

La tabella (`scripts/sql/2026-09-05-voucher.sql`) non parla di medicina: la
colonna `tipo` distingue il benefit, così lo stesso motore serve il prossimo
— merchandising, ingressi omaggio — senza una tabella nuova.

## Stato

Fatto: autenticazione, invito e primo accesso, permessi granulari, guscio del
pannello, Riepilogo, Gestione utenti, log operatori (scrittura).

Fatto anche: **Timbra cartellino** — geofence sulla sede di Corso Moncalieri
466 (centro e raggio in [`lib/timbratura.ts`](lib/timbratura.ts)), turni
accoppiati entrata/uscita, ore del giorno e degli ultimi 14 giorni.

Fatto anche: **Voucher visita medica** — emissione, email al socio via
SendGrid, pagina di validazione per il partner, annullamento e reinvio.

Da fare: Enquiries, Persone, Agenda con `/api/disponibilita` per gli slot che il
sito offre nel form contatti, Visite al sito, pagina di Controllo operatori.
