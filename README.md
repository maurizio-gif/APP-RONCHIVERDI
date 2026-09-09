# CRM Ronchiverdi

Pannello di gestione del Ronchiverdi Sport Club: le richieste che arrivano dal
sito, l'agenda degli appuntamenti, la timbratura del cartellino.

Il nome con cui l'app si salva sulla Home — **CRM Ronchiverdi** — vive in tre
punti che vanno cambiati insieme: `name` e `short_name` in `app/manifest.ts`
(Android) e `appleWebApp.title` in `app/layout.tsx` (iOS).

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

Perché l'invito e il recupero password funzionino, `NEXT_PUBLIC_SITE_URL` deve
essere configurata su Vercel **e** comparire fra i Redirect URLs in Supabase
Auth → URL Configuration: altrimenti l'email parte con un link che non porta al
pannello.

Il pannello in produzione vive su **`https://crm.ronchiverdi.it`**, il dominio
personalizzato — non sull'alias `*.vercel.app`, che essendo coperto dalla
Vercel Authentication chiederebbe prima il login a Vercel (vedi «Accesso
dall'esterno»). Nella allowlist di Supabase va quindi
`https://crm.ronchiverdi.it/auth/callback`, più
`http://localhost:3000/auth/callback` per provare invito e recupero in locale.

Che sia già configurato così si vede dai log di Supabase (Auth logs): le
chiamate a `/verify` — l'endpoint che i link nelle email colpiscono — hanno
come referer `https://crm.ronchiverdi.it/auth/callback`. Se quell'indirizzo non
fosse in allowlist, GoTrue scarterebbe il `redirect_to` e manderebbe al Site
URL, cioè alla radice: il percorso `/auth/callback` non comparirebbe.

## Password dimenticata

Dalla pagina di login, sotto il pulsante Accedi, **«Password dimenticata?»**
porta a `/recupera-password`: si scrive l'indirizzo e arriva un'email col link
per sceglierne una nuova. Il link passa da `/auth/callback` e finisce su
`/imposta-password`, la stessa strada dell'invito — perché è la stessa cosa:
una sessione temporanea che serve solo a scrivere una password.

Due scelte che non si vedono ma contano:

- **La risposta è la stessa se l'indirizzo esiste e se non esiste.** Dire
  «questo indirizzo non è abilitato» trasformerebbe la pagina in uno strumento
  per scoprire chi lavora al club: la si interroga con una lista di indirizzi e
  si guarda quale risponde diverso. L'email parte solo a chi è davvero in
  `staff_users`, ma la pagina mostra «Controlla la posta» in ogni caso — anche
  quando Supabase restituisce un errore.
- **Il tentativo resta nel registro** anche quando l'indirizzo non è abilitato
  (`recupero_non_autorizzato` in Controllo operatori): la pagina non lo dice a
  chi ha provato, ma è esattamente il segnale che si vuole poter vedere.

Il limite di invio di Supabase è l'unico errore distinto («aspetta qualche
minuto»): senza spiegarlo si finisce per premere il pulsante cinque volte, che
è proprio ciò che lo fa scattare.

Come l'invito, richiede `NEXT_PUBLIC_SITE_URL` configurata **e** presente fra i
Redirect URLs in Supabase Auth → URL Configuration. Se manca, la pagina lo dice
e non manda niente: meglio nessuna email che un link che non porta al pannello,
a una persona che è già in difficoltà.

`/imposta-password` è il capolinea di entrambe le strade e adatta il testo: chi
arriva dall'invito legge «Imposta la password», chi arriva dal recupero — e ha
già nome e cognome in `staff_users` — legge «Scegli una password nuova».

## Accesso dall'esterno

Il progetto ha la Vercel Authentication attiva in modalità
`all_except_custom_domains`: **ogni** indirizzo `*.vercel.app` chiede prima il
login a Vercel, quindi da lì il pannello è raggiungibile solo da chi è nel team
R2D — la segreteria no, nemmeno con le credenziali giuste.

Il dominio personalizzato è escluso dalla protezione, ed è la strada che è
stata presa: la segreteria entra da **`https://crm.ronchiverdi.it`**, dove fa
da guardia il login del pannello. Gli indirizzi `*.vercel.app` restano
protetti, e va bene così: tengono fuori i motori di ricerca e i curiosi dai
deploy di anteprima.

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

## Dashboard

Il Riepilogo risponde a due domande, non fa da cruscotto:

**Le tue trattative.** Una sezione sola: i quattro riquadri sono i **tuoi**
numeri — da prendere in carico, che segui tu, vinte da te, perse da te — e gli
elenchi sotto sono il loro dettaglio, con i comandi per prenderle in carico,
riassegnarle o cambiarne lo stato (lo stesso componente della sezione Club e
Family, non una copia). Il totale del club sta in una riga sotto i riquadri.

Prima i riquadri contavano tutto il club e sopra c'era un elenco separato delle
proprie: con un commerciale solo al lavoro i numeri coincidevano e la pagina
sembrava ripetersi. «Da prendere in carico» era perfino lo stesso insieme detto
due volte — prendere in carico sposta lo stato da `nuovo` a `in_gestione`,
quindi il riquadro e l'elenco erano un numero e la sua lista. Il riquadro conta
ora le trattative **senza titolare**, che è ciò che si può davvero prendere.

**Gli impegni di oggi**, cioè arretrati e giornata in corso. Le voci future
stanno in agenda: qui servirebbero solo a far sembrare la giornata più piena di
com'è. Chi vede cosa non è la stessa regola per tutti:

- gli **appuntamenti** — in sede e telefonici — si vedono **tutti**, anche
  quelli dei colleghi e quelli prenotati dal sito (che non hanno assegnatario).
  Il club è uno: chi è al banco deve sapere chi arriva stamattina, o si scopre
  la persona in portineria;
- le **cose da fare** solo le proprie: un task è un promemoria personale, e
  l'elenco di tutti sarebbe illeggibile e per lo più roba d'altri;
- email e WhatsApp non compaiono mai: si registrano già chiusi, quindi non sono
  mai «da fare».

Ogni impegno si **gestisce sul posto**: «Gestisci» apre lo stesso pannello di
chiusura dell'Agenda e delle richieste (eseguita, fallita, riprogrammata,
annullata) con il collegamento alla scheda del contatto. Prima chiudere una
telefonata appena fatta costava tre passaggi — aprire l'agenda, ritrovare la
riga, aprire il pannello — per un gesto che si ripete venti volte al giorno.

## Avviso di una trattativa da prendere in carico

Una richiesta Club o Family che arriva alle 15 crea una trattativa **senza
titolare**, e finché qualcuno non riapre il Riepilogo nessuno se ne accorge: il
numero nel riquadro c'era già, quello che mancava era che si facesse sentire.

Su qualunque pagina del pannello compare un riquadro in basso a destra con
nome, attività, recapiti e la frase che la persona ha scritto — che è ciò che
decide come si apre la telefonata — più **Prendi in carico** e **Apri la
scheda**. Insieme al riquadro suona un avviso di due note.

**Solo per i commerciali**, e solo con la sezione Club e Family: prendere in
carico richiede il diritto commerciale (`puoAssegnare` in
[`lib/pipeline.ts`](lib/pipeline.ts)), e avvisare chi non può agire sarebbe
rumore. Il filtro è lato server, in `puoRicevereAvvisoOpportunita`.

Tre scelte che vale la pena conoscere:

- **Non è bloccante**, al contrario dell'avviso dei messaggi interni: quello è
  una comunicazione da confermare, questo un'occasione da cogliere — e chi è al
  telefono con un socio non deve trovarsi la pagina murata.
- **Il primo giro di polling è muto.** Stabilisce il punto di partenza: senza,
  aprire il pannello con sei trattative libere da ieri suonerebbe come se
  fossero appena arrivate, e un avviso che urla per cose vecchie è il modo più
  rapido di farlo spegnere per sempre. Suonano solo quelle comparse dopo.
- **Una liberata di nuovo suona di nuovo.** Gli id noti si riscrivono a ogni
  giro sull'elenco corrente, quindi una trattativa presa in carico e poi
  lasciata torna a essere una novità legittima.

Il suono è generato con WebAudio in [`useAvvisoSonoro.ts`](app/dashboard/useAvvisoSonoro.ts),
non è un file audio: non c'è un asset binario da versionare, e un tono
costruito lì si tiene breve e discreto — in segreteria ci sono i soci davanti
al banco. I browser bloccano l'audio finché non c'è stata un'interazione, così
l'`AudioContext` si crea al primo clic o tasto premuto; se non è pronto il
riquadro compare comunque, perché il suono è l'accessorio e l'avviso visivo è
la sostanza.

L'interruttore del suono sta **dentro il riquadro** (con un «prova»), non nelle
impostazioni: chi vuole zittirlo lo vuole zittire nel momento in cui gli ha
dato fastidio, non dopo aver cercato dove si fa. La scelta resta su quel
browser.

## Eventi di agenda: programma o registra

Un evento è una voce della tabella `task`. Due regole lo governano, e valgono
in tutti i punti in cui se ne crea uno — l'Agenda, il pannello Eventi delle
richieste, la chiusura con esito. Stanno in
[`lib/eventi.ts`](lib/eventi.ts), scritte una volta sola: prima erano due
copie, nella creazione a mano e nella programmazione dei seguiti, e alla
prima divergenza una avrebbe accettato quello che l'altra rifiutava.

### Il contatto è obbligatorio

Ogni evento è agganciato a qualcosa: `entita` + `entita_id`.

- `form_contatti` — la richiesta dal sito da cui l'evento nasce;
- `persona` — il contatto in anagrafica, per gli eventi creati a mano.

Un evento senza contatto non compare nella scheda di nessuno e in agenda è un
titolo senza il perché: si ritrovava solo per caso, scorrendo il giorno
giusto. Il form dell'Agenda ora chiede il contatto (con un campo di ricerca
sopra la tendina) e la Server Action rifiuta un evento che non ce l'ha.

Il collegamento è `persona` e non `opportunita` di proposito: la trattativa è
della persona e si chiude e riapre nel tempo, mentre la persona resta —
agganciare gli eventi all'opportunità aperta oggi li lascerebbe orfani alla
prossima.

Un vantaggio che ne segue: l'elenco dell'agenda mostra **per chi** è una voce,
e il pannello Eventi di una richiesta trova anche gli eventi creati a mano
dall'agenda per quella persona.

### Se il contatto non c'è, si crea dall'agenda

Al telefono o al banco arriva qualcuno che non ha mai compilato un form.
Prima l'appuntamento non si poteva fissare: il contatto era obbligatorio, e
l'anagrafica si popolava solo dalle richieste del sito — l'unico modo era
mandare quella persona sul sito a scrivere una richiesta per farsi esistere.

Nel form dell'Agenda il contatto ha due strade dichiarate, *Dall'elenco* e
*Nuovo contatto*. Il contatto nuovo chiede il nome e almeno un recapito —
email o cellulare, che sono le chiavi con cui il database riconosce la persona
quando torna — e quello che era stato scritto nella ricerca si porta dietro
nei campi: chi ha cercato «Mario Rossi» senza trovarlo non lo riscrive.

Chi si crea così nasce con `fonte = 'inserimento_manuale'` e in anagrafica
porta la targhetta **Inserito a mano** (`FONTE_MANUALE` e `eInseritoAMano` in
[`lib/persone.ts`](lib/persone.ts)). Non è un dettaglio da archivio: è quello
che spiega una scheda con zero richieste in un elenco che si popola dalle
richieste del sito — altrimenti si legge come una riga rotta — e distingue chi
è arrivato per telefono da chi ha scritto.

La riga la scrive `trova_o_crea_persona`, la stessa funzione che usa il
trigger delle richieste dal sito: la deduplicazione resta del database, e non
c'è una seconda regola che al primo numero scritto in modo diverso
divergerebbe da quella. Ne segue che un contatto «nuovo» che in anagrafica
c'era già — stessa email, stesso numero anche scritto in un altro modo — non
crea un doppione: la voce va sulla riga che c'era, e il form lo dice invece di
farlo di nascosto. La fonte in quel caso non cambia: chi è nato da una
richiesta dal sito non diventa «inserito a mano» perché lo si è ritrovato
scrivendone l'email qui.

L'evento si valida **prima** di toccare l'anagrafica (`preparaEvento` in
[`lib/eventi.ts`](lib/eventi.ts)): un titolo dimenticato deve far fallire il
salvataggio senza lasciare dietro di sé un contatto che nessuno ha chiesto.

Vedi [`scripts/sql/2026-09-09-contatto-inserito-a-mano.sql`](scripts/sql/2026-09-09-contatto-inserito-a-mano.sql),
che non cambia lo schema: scrive nel commento della colonna il vocabolario
completo di `fonte`.

### Programma o registra

- **Programma** — un impegno futuro: nasce «da fare» e qualcuno lo chiuderà.
  Un momento già passato viene rifiutato, con l'invito a usare *Registra*.
- **Registra** — qualcosa che è già avvenuto e che si sta solo annotando (una
  telefonata appena fatta): nasce chiusa, con l'esito (*eseguita* o *fallita*)
  e la nota obbligatoria di com'è andata.

Prima la differenza la indovinava il sistema dalla data (`eGiaAvvenuto` in
[`lib/agenda.ts`](lib/agenda.ts)): una telefonata registrata a fine giornata
restava «da fare» se l'operatore la datava al giorno dopo per sbaglio, e un
impegno fissato per stamattina alle 9 nasceva già chiuso. Ora lo dice chi
scrive. La regola implicita sopravvive solo per i seguiti creati chiudendo una
voce, dove non c'è un interruttore da mostrare.

### Email e WhatsApp si registrano soltanto

Un'email o un messaggio WhatsApp non è un impegno che si prende: lo si scrive
e lo si manda, dura il tempo di scriverlo. Programmarlo per domani crea una
voce «da fare» che nessuno chiuderà — l'email la si manda mentre si pensa di
mandarla, e la voce resta aperta a fare rumore in agenda.

Quindi `email` e `whatsapp` (`TIPI_SOLO_REGISTRATI`) non compaiono nella
tendina quando si programma, e scegliendoli il modo passa a *Registra* e
l'altro pulsante sparisce. Il vincolo è anche lato server, così vale per i
seguiti programmati chiudendo una voce — dove il modo non è nemmeno
dichiarato.

### Nessun impegno automatico sopra un appuntamento

Il trigger `impegno_per_richiesta_ripetuta` crea un promemoria in agenda
quando una persona già seguita riscrive: `trova_o_crea_opportunita` riusa la
trattativa aperta senza cambiare niente, e chi la segue non se ne accorgerebbe.

Ma se quella richiesta prenota un appuntamento o una telefonata, in agenda ci
finisce da sola (`voceDaContatto`): il promemoria era un secondo evento,
datato oggi, per una cosa già in calendario alla settimana prossima — due
righe per un solo fatto, e quella di troppo diceva anche la data sbagliata.

Ora il trigger si ferma su quelle richieste e resta dov'è utile: sui
«messaggio», che altrimenti non lascerebbero traccia nell'agenda di nessuno.
Vedi `scripts/sql/2026-09-08-eventi-collegati.sql`.

## Trattative ed eventi (Club e Family)

**Abbonamento Club e Family** (`/dashboard/richieste/richieste-club`) è l'unico
canale che passa dalla segreteria, e l'unico dove esiste una **trattativa**: la
richiesta è un modulo compilato, la trattativa è la persona che si sta
seguendo. La creazione la fa il database (`trova_o_crea_opportunita`, dal
trigger su `form_contatti`), quindi tre richieste della stessa persona
confluiscono in una trattativa sola — due commerciali non chiamano lo stesso
socio e non ci sono due assegnazioni da tenere sincronizzate.

Ogni riga dell'elenco mostra tre cose e apre tre pannelli indipendenti:

- il blocco **Trattativa** sempre in vista: stato (`Da prendere in carico`,
  `In gestione`, `Vinta`, `Persa`), chi la segue, e i comandi per prenderla in
  carico, riassegnarla o cambiarne lo stato — chi la chiude come persa deve
  scrivere il perché;
- **Dettagli** — i dati del modulo, i recapiti cliccabili, l'esito;
- **Gestione** — chiudere la richiesta con un esito (lo stesso pannello
  dell'Agenda: eseguita, fallita, riprogrammata, annullata);
- **Eventi** — il seguito della trattativa.

### Il pannello Eventi

Gli eventi sono voci di agenda (`task`) collegate alla richiesta da cui
nascono: `entita = 'form_contatti'`, `entita_id` = id della richiesta. Prima
vivevano solo in Agenda — si creavano chiudendo una richiesta con esito e poi
si perdevano di vista: per sapere se il richiamo era stato fatto bisognava
cercarlo in un calendario di tutti.

Dal pannello si può:

- **vedere** tutti gli eventi della trattativa, prima quelli da fare dal più
  vicino, poi i chiusi dal più recente. Gli eventi sono quelli di **tutte** le
  richieste di quella persona, non della sola riga aperta: la trattativa è
  della persona, e spezzare il suo seguito fra tre righe vorrebbe dire non
  trovare mai il richiamo fissato la volta prima. Un evento nato da un'altra
  richiesta lo dice in riga, così non sembra fissato su questa;
- **programmare** un evento nuovo senza chiudere la richiesta. Prima si poteva
  solo chiudendo con esito: per aggiungere una seconda telefonata a una
  trattativa aperta bisognava chiuderla e riaprirla;
- **modificare** un evento già fissato — titolo, tipo, giorno, ora, durata,
  assegnatario, note. È diverso da *Riprogrammata*, che sposta e basta
  chiedendo il perché: qui si corregge una voce sbagliata, e pretendere una
  nota riempirebbe lo storico di «corretto un errore di battitura». Stato ed
  esito non si toccano — chiudere passa solo da «Chiudi con esito»;
- **chiudere con esito** un evento, e **riaprirlo** se la chiusura era
  sbagliata.

Il conteggio sul pulsante «Eventi» sono quelli **da fare**, non il totale: a
trattativa chiusa un «3» non chiederebbe niente a nessuno.

Chiudendo un evento si può fissarne il seguito, e quel seguito eredita il
collegamento dell'evento che lo genera: il seguito di un seguito appartiene
sempre alla richiesta da cui è partito tutto, o sparirebbe da questo pannello.

I comandi vivono in [`esito-actions.ts`](app/dashboard/agenda/esito-actions.ts)
e non nelle azioni dell'Agenda perché l'autorizzazione è diversa: là serve la
sezione `agenda`, qui basta `richieste-club` — chi lavora le trattative
programma e corregge i propri seguiti anche senza avere l'Agenda.

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

## Curriculum (candidature dal sito)

La sezione **Curriculum** (`/dashboard/curriculum`, permesso `candidature`)
mostra le candidature spontanee che arrivano da *Lavora con noi* sul sito.

Sta nel gruppo Amministrazione: le assunzioni le decide la direzione, che è
anche l'unica che deve avere in mano i curriculum. Non è una richiesta dal sito
— chi si candida non è un lead, non entra in anagrafica e non apre una
trattativa — né un'operazione che il banco esegue per il socio.

Il curriculum non è nel database: sta nel bucket privato `candidature-cv`, e la
sezione lo scarica con una **URL firmata valida un minuto**, generata al
momento del click. Il bucket non è raggiungibile da un indirizzo pubblico, e
ogni download finisce in `audit_log` come ogni altro dato personale toccato dal
pannello.

Tabella e bucket li crea il repository del sito, che è chi ci scrive:
`scripts/sql/2026-09-08-candidature.sql` in **Sito-Ronchiverdi**. Qui non c'è
una copia di quella migration — due copie divergono al primo ritocco.

## Messaggi interni (con conferma di lettura e push)

La sezione **Messaggi interni** (`/dashboard/notifiche`, permesso `notifiche`)
è la comunicazione di servizio fra operatori del pannello: si scrive a uno o
più colleghi, con un allegato facoltativo, e ognuno **conferma di aver letto**.

Perché non basta il gruppo WhatsApp: qui resta la conferma con data e ora.
«Gliel'ho detto» e «l'ha letto alle 9:14» sono due cose diverse, e la seconda è
l'unica che serve quando una comunicazione di servizio non è stata eseguita.

Come si comporta:

- Chi riceve un messaggio lo trova **in evidenza su qualunque pagina apra** del
  pannello, anche se era già collegato. L'avviso è **bloccante**: finché non
  conferma la lettura non c'è modo di chiuderlo — è il punto della sezione, non
  una svista di usabilità.
- Il badge accanto alla voce di menu conta quanti restano da confermare. Il
  conteggio si aggiorna da `/api/interno/notifiche/stato` ogni trenta secondi:
  una rotta e non una Server Action, perché un'azione è un `POST` alla pagina
  aperta e finirebbe nella coda del router davanti alle navigazioni.
- In **Inviati** si vede se e quando ogni messaggio è stato letto.
- Un messaggio a più persone è **una riga per destinatario** con lo stesso
  `batch_id`: la conferma è di ciascuno, e chi legge vede a chi altro è andato.

Una riga per destinatario e non per messaggio è la scelta che regge tutto il
resto: con una riga sola servirebbe una tabella di appoggio per dire chi l'ha
letto, cioè la stessa cosa scritta in due tabelle.

Gli allegati (JPG, PNG, PDF, Word, Excel, fino a 5 MB) stanno nel bucket
privato `notifiche-allegati` e si servono con **URL firmate di cinque minuti**,
generate a ogni caricamento della pagina — come i curriculum.

### Notifiche push

«Attiva notifiche», in fondo al menu laterale, avvisa anche a pannello chiuso
con una notifica del telefono o del computer. Va attivata **su ogni dispositivo**
con cui si vogliono ricevere: la sottoscrizione è del browser, non della
persona (una riga per `endpoint` in `push_subscriptions`), così telefono e
computer convivono.

Su iPhone e iPad funziona solo dall'app salvata sulla Home (Safari → Condividi
→ Aggiungi a Home): da Safari normale il pulsante lo dice invece di fallire al
primo tentativo.

Servono due variabili d'ambiente, una coppia di chiavi VAPID:

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

`NEXT_PUBLIC_VAPID_PUBLIC_KEY` (pubblica, la legge il browser per
sottoscriversi) e `VAPID_PRIVATE_KEY` (segreta, solo lato server) — più
`VAPID_SUBJECT`, il contatto tecnico che i servizi push usano per segnalare
problemi. **La coppia non va rigenerata**: cambiarla invalida tutte le
sottoscrizioni attive, e ognuno dovrebbe riaccendere le notifiche su ogni suo
dispositivo.

Senza queste chiavi la sezione funziona comunque — badge, avviso, elenco,
conferma di lettura — solo non parte la notifica di sistema: le push sono un
extra e il loro fallimento non fa mai fallire l'invio del messaggio.

Il service worker è `public/sw.js`, minimo di proposito: solo le push, nessuna
cache offline. Una copia in cache mostrerebbe richieste e appuntamenti vecchi.

Tabelle, indici e bucket: `scripts/sql/2026-09-08-notifiche.sql`.

## Icona sulla Home

Il pannello si usa dal telefono come app installata ("Aggiungi a Home"), quindi
l'icona è un asset di prodotto, non un favicon. Il master è
`design/icona-crm.jpeg` — la tavola dell'icona così com'è disegnata, riquadro su
sfondo di presentazione — e le misure servite si rigenerano da lì:

```bash
pip install Pillow
python3 scripts/genera-icone.py
```

Lo script ritaglia il riquadro (lo sfondo della tavola, dentro la maschera
arrotondata di iOS, diventerebbe un secondo bordo) e scrive i quattro file
dichiarati in `app/manifest.ts`: `apple-touch-icon.png` 180, `icon-192.png`,
`favicon.png` 512 e `icon-maskable-512.png`, quest'ultima col contenuto al 78%
perché Android ritaglia le maskable dentro un cerchio e a piena pagina taglierebbe
la scritta "CRM".

Per cambiare icona si sostituisce il master e si rilancia lo script: i file di
`public/` non si ritoccano a mano, o la prossima rigenerazione li sovrascrive.

## Stato

Fatto: autenticazione, invito e primo accesso, permessi granulari, guscio del
pannello, Riepilogo, Gestione utenti, log operatori (scrittura).

Fatto anche: **Timbra cartellino** — geofence sulla sede di Corso Moncalieri
466 (centro e raggio in [`lib/timbratura.ts`](lib/timbratura.ts)), turni
accoppiati entrata/uscita, ore del giorno e degli ultimi 14 giorni.

Fatto anche: **Voucher visita medica** — emissione, email al socio via
SendGrid, pagina di validazione per il partner, annullamento e reinvio.

Fatto anche: **Curriculum** — le candidature spontanee da *Lavora con noi* sul
sito, con lettura dei testi liberi, stato della candidatura, nota interna e
download del CV dal bucket privato. Il permesso `candidature` va assegnato da
Gestione utenti: nessuno lo ha finché non glielo si dà.

Fatto anche: **Messaggi interni** — comunicazioni fra operatori con conferma
di lettura, avviso bloccante su qualunque pagina, allegati e notifiche push.
Come per `candidature`, il permesso `notifiche` va assegnato da Gestione
utenti: chi non l'ha non compare nemmeno fra i destinatari possibili.

Fatto anche: **Eventi della trattativa** — nella riga di una richiesta Club e
Family si vedono, si programmano, si modificano, si chiudono e si riaprono le
voci di agenda che ne sono seguite, senza passare dall'Agenda.

Fatto anche: **eventi sempre agganciati a un contatto**, con la distinzione fra
*programma* (impegno futuro) e *registra* (già avvenuto, con esito), email e
WhatsApp registrabili soltanto, e la dashboard che elenca le proprie trattative,
quelle da prendere in carico e gli impegni del giorno gestibili sul posto.

Fatto anche: **avviso sonoro e riquadro** per le trattative da prendere in
carico, solo per i commerciali.

Fatto anche: **recupero password** dal login, senza rivelare quali indirizzi
sono abilitati.

Da fare: Enquiries, Persone, Agenda con `/api/disponibilita` per gli slot che il
sito offre nel form contatti, Visite al sito, pagina di Controllo operatori.
