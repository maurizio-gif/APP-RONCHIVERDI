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
In produzione vale `https://app-ronchiverdi.vercel.app`, e nella allowlist di
Supabase va inserito `https://app-ronchiverdi.vercel.app/auth/callback` (più
`http://localhost:3000/auth/callback` per provare gli inviti in locale).

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

## Stato

Fatto: autenticazione, invito e primo accesso, permessi granulari, guscio del
pannello, Riepilogo, Gestione utenti, log operatori (scrittura).

Fatto anche: **Timbra cartellino** — geofence sulla sede di Corso Moncalieri
466 (centro e raggio in [`lib/timbratura.ts`](lib/timbratura.ts)), turni
accoppiati entrata/uscita, ore del giorno e degli ultimi 14 giorni.

Da fare: Enquiries, Persone, Agenda con `/api/disponibilita` per gli slot che il
sito offre nel form contatti, Visite al sito, pagina di Controllo operatori.
