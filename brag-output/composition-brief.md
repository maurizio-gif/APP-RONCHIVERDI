# Brief di composizione Hyperframes: Agenda New (CRM Ronchiverdi)

## Obiettivo
Guida video **in capitoli**, in italiano, alla sezione Agenda per i consulenti commerciali e per chi gestisce il
reparto New. Deroga motivata alla durata di `/brag` (15–25 s): l'utente ha chiesto un video «completo, molto
approfondito». Voce narrante **spenta**; il testo sullo schermo e la musica portano tutto.

## Output
- Cartella composizione: `brag-output/composition/`
- Video: `brag-output/brag.mp4` (+ `brag.jpg` poster, baked come frame 0)
- Formato: landscape — 1920×1080 — 30 fps
- Durata: ~320 s

## Materiale di partenza
- Radice progetto: `/home/user/APP-RONCHIVERDI` (Next.js 14 + Supabase, in italiano)
- File letti: `README.md`, `app/globals.css`, `app/layout.tsx`, `lib/{agenda,provenienza,pipeline,eventi,attesa,richieste}.ts`,
  `lib/auth/sezioni.ts`, `app/dashboard/{page,AvvisoOpportunita,AzioniVeloci,ElencoLead,ComandiLead,Sidebar}.tsx`,
  `app/dashboard/agenda/{page,NuovaVoce,phone-email-in/page}.tsx`, `app/dashboard/agenda-test/{page,GrigliaAgenda}.tsx`,
  `app/dashboard/persone/[id]/{page,NuovaAzione}.tsx`, `components/{GestioneEsito,EventiElenco,SchedaContatto}.tsx`
- Nome prodotto: **CRM Ronchiverdi** — sezione **Agenda** (gruppo «Core New»)
- Affermazione centrale (dall'utente): «dal primo contatto all'iscrizione, tutto dall'Agenda»
- Momenti UI da ricostruire: avviso «Nuova trattativa da prendere in carico»; Dashboard New (chip Lead/Azioni); calendario
  `agt-*`; vista elenco; scheda contatto (Lead + Azioni + Nuova azione + Stato); form «Aggiungi in agenda»; Phone In / Email In
- **Testo che deve comparire alla lettera** (tutto da `lib/provenienza.ts`, `lib/pipeline.ts`, `lib/eventi.ts` e dai componenti):
  - le cinque frasi delle fonti (vedi `brag-plan.md`, Capitolo 1)
  - «Nuova trattativa da prendere in carico» · «Prendi in carico» · «Apri la scheda» · «Avviso sonoro su questo browser»
  - «Riepilogo in sola lettura: l’azione si gestisce nella scheda.» · «Gestisci» · «Apre la scheda di … in una nuova scheda ↗»
  - «Non risponde, riprovo» · «Fatto ✓» · «Non si è presentato» · «Com’è andata» · «Cosa c’è da fare»
  - «Quale abbonamento? Es. «Club Full annuale»» · «Perché non si iscrive?» · «Perché non è una trattativa? Doppione, errore al banco, prova…»
  - «Un impegno da tenere: nasce da fare, e resta in agenda finché non lo chiudi.» · «Qualcosa che hai già fatto: nasce chiusa, con l’esito e la nota di com’è andata.»
  - «Chi si presenta di persona non va registrato qui: fagli scansionare il QR code del Guest Register in reception.»

## Direzione creativa
- Preset: **polished** + ritmo da explainer (`/hyperframes` → `references/types/explainer.md`)
- Direzione: guida operativa per il reparto New: calma, chiara, un collega che ti mostra lo schermo
- Angolo: un solo caso (Chiara Morandi, «Richiamami» dal sito) seguito dall'arrivo all'iscrizione; attorno, le regole
  per lavorare gli altri contatti
- Hook: scheda scura col logo, «Agenda New / Dal primo contatto all'iscrizione.»
- Finale: «Dal primo contatto all'iscrizione: tutto passa dall'Agenda.» (≥ 2 s)
- Da evitare: linguaggio SaaS generico; diapositive di punti elenco; tre card in fila; un diagramma finito buttato
  sullo schermo in un colpo; ogni scena che entra allo stesso modo; loop «respiranti» sui titoli; qualunque dato
  reale (nomi, email, numeri) — tutto è fittizio

## Identità visiva
- Sfondo `#f8f2e5` · superficie `#fdfaf3` · nero caldo `#1c1c18` · testo `#17170f`
- Accento `#8b6c14` (su scuro `#c8991f`) · stati: ok `#4a6b3a`, warn `#8a6410`, errore `#8c3320`, info `#35566b`, agenda `#6e3f6a`, telefono `#2f6662`
- Display: Cormorant Garamond (500/600/700) · interfaccia: Jost (400/500/600) — file in `assets/fonts/` (OFL, da `@fontsource`)
- Riferimenti: sidebar nera con voci Core New; targhette `tag-provenienza`; calendario `agt-*`; chip dei filtri
- Le schermate sono **frammenti ricostruiti col CSS vero** dell'app (`assets/css/app.css`, copiato da `app/globals.css`
  senza `transition`/`animation`, perché non sono ricercabili in modo deterministico)

## Storyboard
Contratto creativo = `brag-plan.md`. Riepilogo scene (durate in s):
`s00` Titolo 12 · `s01` Percorso 18 · `c1` card 3 + `s02` Fonti 33 · `c2` card 3 + `s03` Avviso 20 + `s04` Dashboard New 15 ·
`c3` card 3 + `s05` Menu 6 + `s06` Anatomia 20 + `s07` Stati 12 + `s08` In giornata 8 + `s09` Pannello 8 + `s10` Settimana 5 + `s11` Vista elenco 20 ·
`c4` card 3 + `s12` Scheda 12 + `s13` Azioni 22 + `s14` Nuova azione 15 + `s15` No-show 4 ·
`c5` card 3 + `s16` Chiudere 25 · `c6` card 3 + `s17` Aggiungi in agenda 15 + `s18` Phone In 12 · `s19` Regole 20

## Audio
- Ruolo: sottofondo caldo + effetti sparsi motivati da un gesto visibile
- Arco: attacco morbido sul titolo; livello basso e costante durante le schermate; leggero rialzo sulle schede-capitolo; campana sulla «Vinta»; dissolvenza finale
- Musica: «Happy Beats / Business Moves» (ende.app) — tracce in sequenza con dissolvenza incrociata ~4 s sui confini di capitolo; volume 0.16–0.22
- Cue musicali: preset `assets/music/cues/*.music-cues.json` come suggerimento di tempo; 1–3 aggancio forte (titolo, Vinta, ultima riga) entro ±0.15 s; mai su testi sequenziali
- Audio-reattivo: sottile (luce oro / sfondo delle schede scure); mai su testi o UI
- Momenti accoppiati al suono: avviso (bong morbido), riga che arriva (drop), clic del cursore, battitura di una nota (tick di tastiera, rarefatti), tocco su ogni scheda-capitolo, campana su «Vinta»
- Scelta esatta dei file: a Hyperframes, dopo aver visto l'animazione (guida: `assets/sfx/sfx-analysis.md`)
- File audio: copiare quelli scelti in `composition/assets/music/` e `composition/assets/sfx/`

## Istruzioni per Hyperframes
Usare `/hyperframes` (contratto, `explainer.md`, `format.md`, `motion.md`, `sound.md`) e `/hyperframes-cli`. Le quattro skill di dominio
citate da `/brag` sono state ritirate e fuse in queste due. **Non** entrare nell'intervista iniziale di `/hyperframes` né nel suo
flusso promo: `/brag` ha già deciso angolo, storyboard e tono.

Requisiti:
- Mostrare UI ricostruita dal CSS reale, con dati fittizi.
- Testo leggibile: reading text ≥ 28 px **efficaci** (il controllo conta la scala GSAP, non lo `zoom` CSS); le schermate si inquadrano con la camera (scala ≥ ~2.2 sui frammenti da 860 px).
- Ogni riga che va letta resta ferma 0.5 s + 0.3 s a parola; l'ultima riga ≥ 2 s.
- Una scena = una sub-composizione; stili/markup/script dentro `<template>`; `@font-face` in ogni file che usa Jost o Cormorant.
- Cursore simulato (clic, battitura) per mostrare i gesti; niente anelli di clic né rimbalzi sull'UI.
- `npx hyperframes check` è il cancello unico prima del render; nessun errore.
- Creazione e render restano locali.

## Esito della realizzazione (aggiornamento a fine lavoro)
- Durata finale **6:41 (400,8 s)**, 26 scene (20 scene + 6 schede-capitolo da 3,4 s), 1920×1080 a 30 fps. La finestra «15–25 s» del skill non vale per una guida: la durata è una scelta esplicita dell'utente («video completo, molto approfondito»).
- Niente voce narrante: i sottotitoli in italiano portano la spiegazione (la voce è solo con `--voice`).
- Colori del calendario: seguono lo **stato** dell'evento (oro = da fare, rosso = in ritardo, verde = fatta), come nell'app.
- Musica: cinque tratti con dissolvenza incrociata di 4 s sulle schede 2, 3, 4, 5; le tracce sono normalizzate a −21 LUFS con ffmpeg (`loudnorm`) e poi messe a volume 1,0; effetti Kenney a 0,45–0,62.
- **Non realizzati**: audio-reattivo (luce che segue la musica) e aggancio al beat. Il montaggio resta guidato dai gesti e dalla lettura dei sottotitoli.
- Il costruttore delle scene è in `build/` (`node build/build.mjs` rigenera `composition/`; `build/chk.sh` riassume `hyperframes check`).
