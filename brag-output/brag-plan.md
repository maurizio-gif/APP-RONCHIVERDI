# Piano: Agenda New — guida per i consulenti commerciali

> **Deroga alla regola «15–25 secondi».** `/brag` nasce per video-lancio brevissimi. Qui l'utente ha chiesto
> esplicitamente «un video completo, molto approfondito, di guida»: è la ragione che la skill richiede per
> sforare. Il video è quindi una guida **in capitoli**, ~5 min 20 s. Restano valide tutte le altre leggi:
> leggibile (ogni riga ha il tempo di lettura), specifico (solo testi e comportamenti del CRM), mostra la cosa
> vera (schermate ricostruite dal CSS reale dell'app).
> **Voce narrante: spenta** (non è stato richiesto `--voice`): il video si regge su testi grandi in italiano e musica.

## Che cos'è l'app?
CRM Ronchiverdi, il pannello del Ronchiverdi Sport Club: i contatti nuovi arrivano dal sito, dal Guest Register
e dalle altre fonti, diventano **lead «Da prendere in carico»**, e i commerciali li portano a **Vinta** lavorando
dall'**Agenda**.

## L'angolo
Un **caso lavorato dall'inizio alla fine**, come chiede un buon tutorial: una persona (fittizia) che scrive
«Richiamami» dal sito, e che la guida segue passo passo — avviso, presa in carico, agenda, telefonate a vuoto,
visita in sede, iscrizione. Attorno al caso, le regole che servono per lavorare *tutti gli altri* contatti.
Tono: un collega esperto che ti mostra lo schermo. Niente slogan.

## Hook (primi 12 s)
Scheda scura con il logo del club: **«Agenda New»** (Cormorant) e, sotto, in oro, **«Dal primo contatto
all’iscrizione.»** Poi la riga di perimetro: *«Solo persone nuove. I rinnovi hanno la loro sezione: Rinnovi Core.»*

## Capitoli (il centro del video)
1. **Da dove arrivano** — le 5 fonti, ognuna con la sua targhetta reale: Sito web, Walk-in (Guest Register),
   Evento, Phone In / Email In, Creata in agenda; più il secondo attributo, *cosa ha chiesto*.
2. **Prendere in carico** — l'avviso in basso a destra, «Prendi in carico», la Dashboard New (chip dei lead e
   delle azioni, «In carico a», «Stato»).
3. **L'Agenda** — il calendario (giorno/settimana, filtri, tre stati, «in giornata», Richiamami con fascia, pannello
   di sola lettura + «Gestisci») e la **vista elenco** (Arretrati/Oggi/Prossimi 30 giorni/Fatte, Senza assegnatario).
4. **Lavorare un lead dalla scheda** — Lead, Azioni, «Non risponde, riprovo», «Fatto ✓», «Nuova azione», «Non si è presentato».
5. **Chiudere** — Vinta (abbonamento + valore), Persa, Annullata (solo errori), correggibili.
6. **Quando il lead non è arrivato da solo** — «Aggiungi in agenda» (Programma/Registra, nuovo contatto),
   Phone In / Email In, QR del Guest Register.
7. **Le regole del reparto New** — cinque righe, ognuna con il pezzo di interfaccia che la fa rispettare.

## Flusso d'uso mostrato (domanda 9 della rubrica)
Entrata → *avviso o Dashboard New* → azione chiave → *Prendi in carico → apre la sua voce in Agenda → scheda →
telefonata → «Non risponde, riprovo» → telefonata riuscita → «Nuova azione: Visita in sede» → «Fatto ✓»* →
risultato → *Stato: Vinta, «Club Full annuale», 1080 €*.

## Tono
- Preset: **polished** (con ritmo da *explainer*)
- Direzione creativa: *guida operativa per il reparto New: calma, chiara, un collega che ti mostra lo schermo*
- Interpretazione: tenute lunghe sulle schermate, una cosa per volta, transizioni morbide (blur swap su un unico
  palcoscenico, schede-capitolo scure a ritmare). Nessuna battuta: l'umorismo qui sarebbe fuori posto.

## Formato: landscape — 1920×1080 — 30 fps
## Durata: ~320 s (5:20)

## Identità visiva (dal progetto — `app/globals.css`, `app/layout.tsx`)
- Sfondo: `#f8f2e5` (crema dorata) · superfici `#fdfaf3` · nero caldo `#1c1c18` (sidebar, schede-capitolo)
- Accento: `#8b6c14` (bronzo) · sul nero `#c8991f` (oro)
- Testo: `#17170f` · smorzato `#3d3d33` · su scuro `#f6efde`
- Stati reali: ok `#4a6b3a`, warn `#8a6410`, errore `#8c3320`, info `#35566b`, agenda `#6e3f6a`, telefono `#2f6662`
- Font display: **Cormorant Garamond** · font interfaccia: **Jost** (gli stessi del sito, OFL, da `@fontsource`)
- Elemento visivo forte: le **targhette** (provenienza, richiesta, stato) e il calendario `agt-*` ricostruiti con il CSS vero

## Dati fittizi (nessun dato reale sullo schermo)
Contatti: Chiara Morandi, Luca Ferri, Sara Bellini, Marco Villa, Paola Conti — recapiti inventati su `example.it`
e numeri `340 123 4567`. Operatori: Elena B. (tu), Marco T., Sofia L. Nessun nome del personale reale.

## Share copy (bozza)
La guida per il reparto New di Ronchiverdi: dal primo contatto all'iscrizione, tutto dall'Agenda.

## Audio
- Ruolo: **sottofondo caldo** + effetti sparsi sulle azioni visibili (clic, battitura, avviso)
- Musica: 3–4 tracce «Happy Beats / Business Moves» in sequenza con dissolvenze incrociate di ~4 s sui confini di
  capitolo, volume basso (0.16–0.22): è una guida piena di testo, la musica non deve competere con la lettura
- Trattamento: attacco morbido sul titolo; sale di poco sulle schede-capitolo; scende sotto le sezioni dense; chiude con dissolvenza
- Musica — cue: letti dai preset in `assets/music/cues/` (tempo e `strongCues`); 1–3 aggancio forte sul titolo,
  sulla «Vinta» e sull'ultima riga. Gli eventi sequenziali di **testo** NON si agganciano ai battiti (la lettura vince)
- Audio-reattivo: **sottile** — la luce oro dietro il titolo e lo sfondo delle schede-capitolo respirano con l'RMS; mai su testi o UI
- SFX: sparsi, motivati da ciò che si vede: clic del cursore, tick di tastiera quando si scrive una nota, «drop» per
  una riga/targhetta che arriva, un tocco morbido sulle schede-capitolo, un'unica campana sulla «Vinta»
- Regola di sobrietà: nessun tono sintetico; nessun effetto su ogni transizione; mai sopra la musica più di 3–6 dB

## Storyboard

### s00 — Titolo — 12 s
Scheda scura, logo del club (`public/logo-ronchiverdi-sport.png`), «Agenda New», «Dal primo contatto all’iscrizione.»;
a 6 s: «La guida per i consulenti commerciali e per chi gestisce il reparto New»; a 9 s: «Solo persone nuove.
I rinnovi hanno la loro sezione: Rinnovi Core.»
Sequenziale: no. Audio: attacco della musica, un tocco morbido sul titolo. → blur swap

### s01 — Il percorso — 18 s
Una linea che cresce con un solo punto (il lead). Nomi dei passi appaiono quando vengono detti:
**Arriva · Prendi in carico · Pianifica in Agenda · Chiama e registra · Vinta**; sotto, le vere targhette di stato:
*Da prendere in carico* → *In gestione* → *Vinta* e i tre trattini di `pipeline-passi`. Riga finale:
«Dall’Agenda gestisci tutto il follow-up, fino all’iscrizione.»
Sequenziale: sì, 5 passi uno a uno, ~2.4 s ciascuno (testo: aggancio ogni 2 battiti al massimo). → blur swap

### Capitolo 1 — «Da dove arrivano» (card 3 s + s02 33 s)
Elenco **Lead** (stile `ElencoLead`) in cui arrivano cinque righe, una ogni ~5.5 s, ciascuna con **targhetta di
provenienza**, **targhetta di richiesta** e la frase che spiega la fonte (testo identico a `lib/provenienza.ts`):
- Chiara Morandi — *Sito web* · *Richiamami · Sera 17–20* — «Ha scritto dal sito: non l’ha ancora incontrato nessuno.»
- Luca Ferri — *Walk-in* · *In sede* — «Registrato al banco: è già stato qui e ha parlato con la segreteria.» + «Il Guest Register: il QR code in reception.»
- Sara Bellini — *Evento* — «Si è registrato dal QR code di un evento: l’abbiamo incontrato di persona, ma non è passato dal banco.»
- Marco Villa — *Phone In / Email In* · *Telefonata* — «Ha telefonato o scritto alla segreteria: la telefonata o l’email sono registrate in agenda.»
- Paola Conti — *Creata in agenda* — «Non è arrivata da una richiesta: l’ha aperta qualcuno del club scrivendo un evento in agenda su questa persona.»
Chiusura (5 s): le due etichette di una riga evidenziate — **«Da dove arriva»** e **«Cosa ha chiesto»** — e la frase
«Ogni arrivo è un lead «Da prendere in carico»: nessuno lo segue finché qualcuno non lo prende.»
Sequenziale: sì (righe una a una, tenute 5.5 s). Audio: «drop» morbido a riga; tocco sulla scheda-capitolo.

### Capitolo 2 — «Prendere in carico» (card 3 s + s03 20 s + s04 15 s)
- **s03 L’avviso**: pagina qualunque sfocata; in basso a destra scivola il riquadro «Nuova trattativa da prendere in
  carico» con nome, recapiti, la frase scritta («Vorrei provare il club e capire quali abbonamenti ci sono.»),
  **[Prendi in carico]** e **[Apri la scheda ↗]**, e «Avviso sonoro su questo browser». Testi: «Compare su qualunque
  pagina, con un suono di due note.» · «La frase che ha scritto decide come si apre la telefonata.» · «Non blocca la
  pagina.» Il cursore clicca *Prendi in carico* → badge *Da prendere in carico* diventa *In gestione*, «la segui tu»
  → «Poi ti porta in Agenda.»
- **s04 Dashboard New**: «Ciao Elena», sezione **Lead** con chip *Da prendere in carico 3 · Assegnate a te 1 · In
  gestione 4 · Vinte 2 · Perse 1*; una riga con le due tendine «In carico a» (Nessuno → Io) e «Stato»; sezione
  **Azioni** con *Arretrati · Oggi · Prossimi 14 giorni | Di tutti · Le mie*. Testo: «Prendere in carico è dei
  commerciali. Chi coordina la Dashboard New vede, ma non prende.»
Sequenziale: sì (chip, poi tendine). Audio: bong morbido all'avviso; clic sul pulsante; clic sulla tendina.

### Capitolo 3 — «L’Agenda» (card 3 s + s05–s11, 59 s)
- **s05 Menu (6 s)** — sidebar scura: gruppo **Core New**: *Dashboard New · Agenda · Contatti*; il cursore clicca *Agenda*.
- **s06 Anatomia (20 s)** — calendario giorno «Giovedì 22 ottobre»: ‹ Oggi › · *Giorno | Settimana* · *☰ Vista elenco* ·
  *Per operatore | Tutti insieme* · «Cerca nome o telefono»; pannello sinistro: mini-mese, «3 azioni arretrate dai giorni
  scorsi →», *Operatori* (Elena B. (tu), Marco T., Sofia L., Senza assegnatario), *Stato*, *Tipi*; legenda «N da fare · N in
  ritardo, esito da registrare · N fatte». Testi: «All’apertura vedi solo le tue azioni.» · «Spunta «Tutti» per i colleghi.» ·
  «Senza assegnatario: se il numero è rosso, c’è qualcuno da prendere.»
- **s07 Tre stati (12 s)** — tre eventi in primo piano: *Da fare* (colore del tipo, cerchio vuoto), *In ritardo* (bordo rosso,
  «Esito da registrare»), *Fatta* (spunta verde + esito). Testi: «Da fare: il colore del tipo.» · «In ritardo: l’ora è
  passata e manca l’esito.» · «Fatta: spunta verde e com’è andata.»
- **s08 In giornata (8 s)** — riga «in giornata» con chip «Richiamami · 17–20»; tabellina fasce *Mattina 9–13 ·
  Pomeriggio 13–17 · Sera 17–20*. Testo: «Il Richiamami non ha un’ora: ha una fascia.»
- **s09 Pannello (8 s)** — clic su un evento → pannello laterale «Riepilogo in sola lettura: l’azione si gestisce nella
  scheda.» con Azione, Cellulare, Interesse, Provenienza, Assegnata a, Tentativi; il piede **Gestisci — Apre la scheda
  di Chiara Morandi in una nuova scheda ↗**. Testo: «Dal calendario si guarda. Si lavora nella scheda.»
- **s10 Settimana (5 s)** — toggle *Settimana*: sette colonne, oggi evidenziato.
- **s11 Vista elenco (20 s)** — clic su *☰ Vista elenco*: «Agenda · vista elenco», pulsante *Aggiungi in agenda*, chip
  *Arretrati 2 · Oggi 5 · Prossimi 30 giorni 8 · Fatte 12* | *Di tutti · Le mie · Senza assegnatario*, ricerca «Nome,
  cognome, telefono, email», righe con badge tipo, quando, nome, telefono, «· chi», **Apri scheda ↗**. Testi: «Stessa
  agenda, in elenco.» · «Fatte: gli ultimi 14 giorni.» · «Senza assegnatario: i lead che non ha preso nessuno.»

### Capitolo 4 — «Lavorare un lead» (card 3 s + s12–s15, 53 s)
- **s12 La scheda (12 s)** — header Chiara Morandi (tel · WhatsApp · email); card **Lead** (badge *In gestione*):
  Arrivato, Da *Sito web*, Richiesta *Richiamami · Sera 17–20*, Interesse, Messaggio; «In carico a · stato».
  Testo: «Da dove arriva, cosa ha chiesto, cosa ha scritto: tutto in una scheda.»
- **s13 Azioni (22 s)** — card **Azioni**: *Da fare ora 1 — oggi o scadute*; la riga Telefonata, «Sera 17–20»,
  «è la sua fascia adesso»; il cursore scrive «Squilla a vuoto» e clicca **Non risponde, riprovo** → la riga porta
  «1 tentativo» e resta da fare; poi scrive «Vuole fare un tour sabato mattina» e clicca **Fatto ✓** → passa in *Fatte*
  come *Eseguita*. Testi: «Non risponde? Registra il tentativo: il lead resta da fare.» · «Risponde? Scrivi com’è andata e «Fatto ✓».»
- **s14 Nuova azione (15 s)** — box *Nuova azione*: Tipo *Visita in sede*, giorno sab 24, ora 10:30, A chi *Io*, «Tour in sede e
  proposta abbonamento», **Aggiungi** → compare in *In programma 1 — nei prossimi giorni*. Testi: «Subito il prossimo passo: se resta solo in testa a te, si perde.» ·
  «Email e WhatsApp si registrano soltanto: li annoti dopo averli mandati.»
- **s15 Il giorno della visita (4 s)** — riga *Visita in sede* con **Fatto ✓** e **Non si è presentato**. Testo: «Non si presenta? «Non si è presentato», poi un altro appuntamento.»

### Capitolo 5 — «Chiudere» (card 3 s + s16 25 s)
Tendina *Stato* aperta (Da prendere in carico · In gestione · Vinta · Persa · Annullata) → **Vinta** → campi «Quale
abbonamento? Es. «Club Full annuale»» e «€» → il cursore scrive «Club Full annuale», «1080» → **Salva** → badge
**Vinta**, «Chiuso … · 1.080,00 €». Poi **Persa**: «Perché non si iscrive?»; **Annullata**: «Perché non è una trattativa?
Doppione, errore al banco, prova…». Testi: «Vinta: quale abbonamento e quanto vale.» · «Persa: il perché è obbligatorio.» ·
«Annullata è per gli errori, non per le perdite.» · «Ci si può sempre correggere.»
Audio: un'unica campana morbida sulla «Vinta».

### Capitolo 6 — «Quando il lead non arriva da solo» (card 3 s + s17 15 s + s18 12 s)
- **s17 Aggiungi in agenda** — form *Nuova voce*: *Programma | Registra* con le due spiegazioni; *Dall’elenco | Nuovo contatto*
  «Basta il nome…»; banner «Aperta anche la trattativa di questo contatto, in gestione a te.» Testo: «Un evento scritto su una persona apre il suo lead.»
- **s18 Phone In / Email In** — pagina «Phone In / Email In»; riquadro «Chi si presenta di persona non va registrato qui: fagli
  scansionare il QR code del Guest Register in reception.» Testi: «Telefonata o email quando nessun commerciale c’era: Phone In / Email In.» · «Di persona: il QR code del Guest Register.»

### s19 — Le regole del reparto New — 20 s
Cinque righe grandi, una ogni ~3 s, ciascuna con il pezzo di UI vero accanto:
1. «Ogni lead nuovo ha un titolare.» — [Prendi in carico]
2. «Non risponde? Registra il tentativo.» — [Non risponde, riprovo]
3. «Dopo ogni chiamata, il prossimo passo in agenda.» — [Nuova azione]
4. «Vinta, Persa, Annullata: sempre con la nota.» — badge Vinta / Persa / Annullata
5. «Ogni mattina, guarda gli Arretrati.» — chip *Arretrati 3*
Chiusura (5 s): **«Dal primo contatto all’iscrizione: tutto passa dall’Agenda.»** (tenuta ≥ 2 s, ultima riga).

**Musica:** tracce in sequenza, dissolvenza incrociata sui confini di capitolo.
**Riepilogo audio:** sottofondo caldo sempre presente, effetti solo dove c'è un gesto da sentire, una campana per la Vinta.

## Perimetro e cosa NON c'è
- Non ci sono i **rinnovi** (Rinnovi Core, mensili in scadenza, recupero mancati rinnovi): richiesta dell'utente.
- Non ci sono i canali dei corsi (Young School, Summer Camp…): non passano dall'Agenda.
- Non si mostra niente di amministrativo (utenti, log, direzionale).

## Mappa del grounding (ogni affermazione sullo schermo → dove sta nel progetto)
| Affermazione | Fonte |
|---|---|
| Targhette e frasi delle 5 fonti | `lib/provenienza.ts` (`SITO`, `GUEST_REGISTER`, `EVENTO`, `PHONE_IN`, `AGENDA`) |
| Etichette «cosa ha chiesto» | `lib/provenienza.ts` (`ETICHETTE_RICHIESTA`) |
| Walk-in = «Guest Register», QR code in reception | `app/dashboard/agenda/phone-email-in/page.tsx`, `lib/provenienza.ts` |
| Stati lead e loro etichette | `lib/pipeline.ts` (`ETICHETTE_STATO`, `AZIONE_STATO`, `PASSI_AVANZAMENTO`) |
| Avviso: testi, pulsanti, suono, non bloccante | `app/dashboard/AvvisoOpportunita.tsx`; README «Avviso di una trattativa da prendere in carico» |
| Prendi in carico → poi si va in Agenda (non si promette «la voce esatta»: il parametro `apri` non è letto da `agenda/page.tsx`) | `AvvisoOpportunita.tsx` (`hrefAgendaTrattativa`) |
| Solo i commerciali prendono in carico; chi coordina vede | README «Dashboard», `app/dashboard/page.tsx`, `lib/pipeline.ts` (`puoAssegnare`) |
| Dashboard New: chip, tendine, azioni | `app/dashboard/page.tsx`, `ElencoLead.tsx`, `ComandiLead.tsx` |
| Menu «Core New» | `lib/auth/sezioni.ts`, `app/dashboard/Sidebar.tsx` |
| Calendario: controlli, filtri, 3 stati, in giornata, pannello sola lettura, Gestisci | `app/dashboard/agenda-test/GrigliaAgenda.tsx` |
| Fasce Mattina 9–13, Pomeriggio 13–17, Sera 17–20 | `lib/agenda.ts` (`FASCE_RICHIAMO`) |
| Vista elenco: chip, ricerca, 14 giorni di «Fatte», 30 di «Prossimi» | `app/dashboard/agenda/page.tsx` |
| Scheda: Lead, Azioni, Nuova azione, bottoni | `app/dashboard/persone/[id]/page.tsx`, `AzioniVeloci.tsx`, `NuovaAzione.tsx` |
| «Non risponde, riprovo» registra il tentativo, il lead resta da fare | `AzioniVeloci.tsx`, `components/GestioneEsito.tsx` |
| «Non si è presentato» (No-show) | `AzioniVeloci.tsx`, `lib/agenda.ts` (`etichettaEsito`) |
| Email e WhatsApp si registrano soltanto | `lib/agenda.ts` (`TIPI_SOLO_REGISTRATI`), `NuovaAzione.tsx` |
| Vinta: abbonamento + valore; Persa/Annullata: motivo | `lib/pipeline.ts` (`DOMANDA_MOTIVO`, `chiedeValore`), `ComandiLead.tsx` |
| Annullata solo per errori, correggibile | `lib/pipeline.ts`, README «La trattativa annullata» |
| Programma / Registra, nuovo contatto, banner «Aperta anche la trattativa…» | `lib/eventi.ts`, `NuovaVoce.tsx`, README «L’evento in agenda apre la trattativa» |
| Phone In / Email In | `app/dashboard/agenda/phone-email-in/page.tsx` |

## Note a fine lavoro
- Durata reale **6:41** (la guida completa richiesta dall'utente supera di molto i 15–25 s del formato breve).
- Colori del calendario: per **stato** (oro da fare, rosso in ritardo, verde fatta), non per tipo.
- «Prendi in carico» non promette la voce esatta in Agenda: nel video si dice solo che «poi ti porta in Agenda».
- Audio-reattivo e aggancio al beat non fatti; musica normalizzata a −21 LUFS.
- Nessuna voce narrante.
