// Lo stato di avanzamento della proposta di progetto 2026–2027 (Ready 2
// Digital), così come lo vede la pagina /dashboard/avanzamento.
//
// I **contenuti** stanno qui, nel codice, e non nel database: sono la
// proposta e la situazione rendicontata da Maurizio, cambiano di rado e
// quando cambiano è giusto che passino da una revisione. Nel database
// (avanzamento_aggiornamenti) finisce solo quello che le persone fanno sulla
// pagina: segnare un passo fatto, riaprirlo, scrivere una nota.
//
// Una chiave di passo, una volta usata, non si rinomina: è il collegamento
// fra questo file e le righe già scritte. Un passo che non serve più si
// toglie; le sue righe restano nel database e semplicemente non si vedono.
//
// Nessun import server-only: lo leggono sia la pagina sia il componente
// client del passo.

/** La data della situazione scritta qui sotto: i passi `fatto: true` sono fatti a questa data. */
export const SITUAZIONE_AL = '2026-10-01'

export const LINK_PROPOSTA = 'https://maurizio-gif.github.io/RONCHIVERDI-DIGITAL/proposta-commerciale.html'

export type ChiavePersona =
  | 'maurizio'
  | 'marco'
  | 'lorella'
  | 'paola'
  | 'simone'
  | 'margherita'
  | 'maria-grazia'
  | 'chiron'
  | 'referente-chiron'
  | 'referente-kb'

export type Persona = {
  nome: string
  ruolo: string
  /** Account del pannello: serve a riconoscere chi apre la pagina e mostrargli i suoi passi. */
  email?: string
  /** Fa parte del gruppo di progetto: compare in «Chi fa cosa» e nel filtro. */
  team?: boolean
  /** Una figura che ancora non c'è: finché il passo indicato non è fatto, la si dice «da nominare». */
  daNominareFinche?: string
}

export const PERSONE: Record<ChiavePersona, Persona> = {
  marco: { nome: 'Marco Rolle', ruolo: 'Club Manager', email: 'm.rolle@ronchiverdi.it', team: true },
  paola: { nome: 'Paola Zavattero', ruolo: 'CFO', email: 'paola.zavattero@gmail.com', team: true },
  lorella: {
    nome: 'Lorella Gravante',
    ruolo: 'Resp. Sviluppo Club',
    email: 'l.gravante@ronchiverdi.it',
    team: true,
  },
  simone: {
    nome: 'Simone Aggazio',
    ruolo: 'Referente digitale',
    email: 's.aggazio@ronchiverdi.it',
    team: true,
  },
  maurizio: {
    nome: 'Maurizio Taruggi',
    ruolo: 'Ready 2 Digital',
    email: 'maurizio@ready2digital.it',
    team: true,
  },
  margherita: { nome: 'Margherita e il suo team', ruolo: 'Retention e rinnovi' },
  'maria-grazia': { nome: 'Maria Grazia', ruolo: 'Amministrazione' },
  chiron: { nome: 'Chiron', ruolo: 'Centro medico partner' },
  'referente-chiron': {
    nome: 'Referente Chiron',
    ruolo: 'Responsabile interno del progetto',
    daNominareFinche: 'chiron-responsabile',
  },
  'referente-kb': {
    nome: 'Referente Knowledge Base',
    ruolo: 'Responsabile interno di termini e condizioni e Knowledge Base',
    daNominareFinche: 'kb-responsabile',
  },
}

export const PERSONE_TEAM = (Object.keys(PERSONE) as ChiavePersona[]).filter((k) => PERSONE[k].team)

export function personaDiEmail(email: string | null | undefined): ChiavePersona | null {
  const pulita = email?.trim().toLowerCase()
  if (!pulita) return null
  return (Object.keys(PERSONE) as ChiavePersona[]).find((k) => PERSONE[k].email === pulita) ?? null
}

export type Passo = {
  /** Stabile per sempre: vedi l'intestazione del file. */
  chiave: string
  titolo: string
  descrizione?: string
  responsabili: ChiavePersona[]
  con?: ChiavePersona[]
  /** Già fatto alla data SITUAZIONE_AL. Si può comunque riaprire dalla pagina. */
  fatto?: boolean
  /** Ferma il deliverable finché non è fatto. */
  bloccante?: boolean
  /** Un consiglio, non una condizione: non blocca niente. */
  consiglio?: boolean
  /** Chiavi dei passi che devono essere fatti prima. */
  dopo?: string[]
}

export type Tono = 'ok' | 'info' | 'warn' | 'error' | 'off'

/**
 * Un deliverable della proposta commerciale, con lo stesso numero, titolo,
 * descrizione, consegna prevista e priorità del preventivo: la pagina segue
 * lo schema della proposta, non uno suo.
 */
export type Deliverable = {
  numero: string
  titolo: string
  descrizione: string
  consegnaPrevista: string
  priorita: 'Critica' | 'Alta' | 'Media'
  stato: { etichetta: string; tono: Tono }
  sintesi?: string
  /** Sezioni del pannello collegate: si mostrano solo a chi ha quel permesso. */
  link?: { href: string; label: string; sezione: string }[]
  passi: Passo[]
}

const NON_RENDICONTATO = { etichetta: 'Non ancora rendicontato', tono: 'off' as const }

export const DELIVERABLE: Deliverable[] = [
  {
    numero: '01',
    titolo: 'Sito Web',
    descrizione: 'Lead generation — 8–12 pagine (espandibile in futuro) + SEO + Cal.com + form condizionali',
    consegnaPrevista: '2026-08-31',
    priorita: 'Critica',
    stato: { etichetta: 'Consegnato', tono: 'ok' },
    sintesi:
      'Realizzato da Maurizio e consegnato a Simone, che ne cura la gestione operativa. Resta un consiglio, non bloccante: aggiornarlo in modo più dinamico con tutto ciò che riguarda gli eventi.',
    passi: [
      { chiave: 'sito-realizzazione', titolo: 'Sito realizzato e online', responsabili: ['maurizio'], fatto: true },
      {
        chiave: 'sito-consegna',
        titolo: 'Consegnato a Simone per la gestione operativa',
        responsabili: ['maurizio'],
        con: ['simone'],
        fatto: true,
      },
      {
        chiave: 'sito-eventi',
        titolo: 'Aggiornare il sito in modo più dinamico con gli eventi',
        descrizione: 'Tutto ciò che riguarda gli eventi del club, tenuto aggiornato con continuità.',
        responsabili: ['simone'],
        consiglio: true,
      },
    ],
  },
  {
    numero: '02',
    titolo: 'CRM Lead',
    descrizione: 'Scadenzario, task, assegnazione per responsabile — Core + Young School',
    consegnaPrevista: '2026-08-31',
    priorita: 'Critica',
    stato: { etichetta: 'Consegnato · da rivedere', tono: 'info' },
    sintesi:
      'Gestione lead: consegnata, ma va rivista dal punto di vista grafico e funzionale; in parallelo va rianalizzata la strategia di acquisizione lead dal sito. Gestione rinnovi: allineata al file Excel di Margherita e del suo team, è pronta per essere usata — oggi, 1° ottobre, può essere il giorno in cui si comincia.',
    link: [{ href: '/dashboard/abbonamenti/rinnovi', label: 'Apri Rinnovi Core', sezione: 'rinnovi-core' }],
    passi: [
      { chiave: 'crm-lead-consegna', titolo: 'Gestione lead consegnata', responsabili: ['maurizio'], fatto: true },
      {
        chiave: 'crm-lead-revisione',
        titolo: 'Revisione grafica e funzionale della gestione lead',
        responsabili: ['maurizio'],
        con: ['lorella', 'simone'],
      },
      {
        chiave: 'crm-lead-strategia',
        titolo: 'Rianalizzare la strategia di acquisizione lead dal sito',
        descrizione: 'In parallelo alla revisione.',
        responsabili: ['lorella', 'simone'],
        con: ['maurizio'],
      },
      {
        chiave: 'rinnovi-allineamento',
        titolo: 'Gestione rinnovi allineata al file Excel di Margherita e del suo team',
        responsabili: ['maurizio'],
        fatto: true,
      },
      {
        chiave: 'rinnovi-avvio',
        titolo: 'Dal 1° ottobre i rinnovi si lavorano in Rinnovi Core',
        descrizione: 'Quando il team ha cominciato a usarlo, segnatelo qui.',
        responsabili: ['lorella'],
        con: ['margherita'],
      },
    ],
  },
  {
    numero: '03',
    titolo: 'Applicativo Gestione Voucher + Automazione Certificati Medici',
    descrizione: 'Workflow digitale voucher e alert scadenza certificati, riduzione rischio operativo',
    consegnaPrevista: '2026-08-31',
    priorita: 'Critica',
    stato: { etichetta: 'Fermo · serve un responsabile interno', tono: 'error' },
    sintesi:
      'Automazione con Chiron: lato Maurizio è tutto pronto. Per partire servono la lista scritta degli abbonamenti da includere e il testo aggiornato di Chiron con la procedura di prenotazione. Oggi la pratica rimbalza fra le parti e dall’esterno il cerchio non si può chiudere: serve una persona di Ronchiverdi che unisca tutto e la porti a termine.',
    link: [{ href: '/dashboard/voucher', label: 'Apri Voucher visita medica', sezione: 'voucher' }],
    passi: [
      { chiave: 'chiron-tecnico', titolo: 'Automazione pronta lato tecnico', responsabili: ['maurizio'], fatto: true },
      {
        chiave: 'chiron-bozze',
        titolo: 'Bozze dei testi email inviate a Paola',
        descrizione: 'Chiron le ha già viste.',
        responsabili: ['maurizio'],
        con: ['paola'],
        fatto: true,
      },
      {
        chiave: 'chiron-responsabile',
        titolo: 'Nominare il responsabile interno del progetto Chiron',
        descrizione: 'Una persona di Ronchiverdi che tenga i rapporti con Chiron e porti a termine i passi qui sotto.',
        responsabili: ['marco', 'paola'],
        bloccante: true,
      },
      {
        chiave: 'chiron-numero-visite',
        titolo: 'Rispondere a Chiron sul numero di visite previste nei prossimi 12 mesi',
        descrizione:
          'Chiron lo chiede prima di andare avanti. Corrisponde agli abbonamenti in scadenza, e il numero è già stato individuato: manca la decisione di comunicarlo.',
        responsabili: ['marco'],
        bloccante: true,
      },
      {
        chiave: 'chiron-abbonamenti',
        titolo: 'Lista scritta degli abbonamenti da includere nell’automazione',
        responsabili: ['referente-chiron'],
        dopo: ['chiron-responsabile'],
      },
      {
        chiave: 'chiron-testo',
        titolo: 'Testo aggiornato di Chiron con la procedura di prenotazione',
        responsabili: ['referente-chiron'],
        con: ['chiron'],
        dopo: ['chiron-responsabile', 'chiron-numero-visite'],
      },
      {
        chiave: 'chiron-avvio',
        titolo: 'Avvio dell’automazione',
        descrizione: 'Maurizio è pronto a partire appena arrivano lista e testo.',
        responsabili: ['maurizio'],
        dopo: ['chiron-abbonamenti', 'chiron-testo'],
      },
    ],
  },
  {
    numero: '04',
    titolo: 'Formazione ATHLETIS',
    descrizione: 'Affiancamento e implementazione — riduzione drastica tempi gestione collaboratori',
    consegnaPrevista: '2026-08-31',
    priorita: 'Alta',
    stato: { etichetta: 'In corso', tono: 'info' },
    sintesi:
      'La formazione è in corso: Maria Grazia è già in contatto con Valentina del Team Athlon Club. Il supporto viene dato quando serve.',
    passi: [
      {
        chiave: 'athletis-contatto',
        titolo: 'Maria Grazia in contatto con Valentina del Team Athlon Club',
        responsabili: ['maria-grazia'],
        fatto: true,
      },
      {
        chiave: 'athletis-supporto',
        titolo: 'Supporto quando serve',
        descrizione: 'Se c’è bisogno di un affiancamento, scrivetelo qui in una nota.',
        responsabili: ['maurizio'],
        consiglio: true,
      },
    ],
  },
  {
    numero: '05',
    titolo: 'Sincronizzazione InfoRYOU',
    descrizione: 'Data pipeline verso DB esterno — base dati che alimenta CRM, dashboard e tutte le automazioni',
    consegnaPrevista: '2026-09-30',
    priorita: 'Alta',
    stato: { etichetta: 'Consegnato', tono: 'ok' },
    sintesi:
      'I dati sono congruenti e consolidati, con un allineamento ogni 5 minuti. In Abbonamenti gli abbonamenti si raggruppano per gruppo in autonomia: la prima impostazione l’ha fatta Maurizio, ma come vanno letti e raggruppati lo decide Ronchiverdi.',
    link: [{ href: '/dashboard/abbonamenti/gruppi', label: 'Apri i gruppi abbonamento', sezione: 'abbonamenti' }],
    passi: [
      {
        chiave: 'inforyou-sync',
        titolo: 'Dati congruenti e consolidati, allineati ogni 5 minuti',
        responsabili: ['maurizio'],
        fatto: true,
      },
      {
        chiave: 'inforyou-gruppi-impostazione',
        titolo: 'Prima impostazione dei gruppi abbonamento',
        responsabili: ['maurizio'],
        fatto: true,
      },
      { chiave: 'inforyou-gruppi-screening', titolo: 'Primo screening dei gruppi', responsabili: ['simone'], fatto: true },
      {
        chiave: 'inforyou-gruppi-definizione',
        titolo: 'Sistemare i gruppi con Lorella e Maria Grazia',
        descrizione: 'Nei colloqui si decide come vanno letti e raggruppati gli abbonamenti.',
        responsabili: ['simone'],
        con: ['lorella', 'maria-grazia'],
      },
      {
        chiave: 'inforyou-gruppi-verifica',
        titolo: 'Verificare che i numeri per gruppo tornino con InfoRYOU',
        responsabili: ['simone'],
        dopo: ['inforyou-gruppi-definizione'],
      },
    ],
  },
  {
    numero: '06',
    titolo: 'Knowledge Base soci',
    descrizione: 'Sito informazioni utili per gli iscritti — FAQ, regolamenti, procedure, orari',
    consegnaPrevista: '2026-10-31',
    priorita: 'Alta',
    stato: { etichetta: 'In attesa di Ronchiverdi', tono: 'warn' },
    sintesi:
      'Maurizio ha preparato una prima bozza di termini e condizioni, che ora va revisionata dal team Ronchiverdi, con una persona interna che se ne faccia carico. Solo dopo aver fissato i termini e condizioni si comincia la Knowledge Base: Maurizio ne prepara la bozza, che va di nuovo approvata. Poi si pubblica tutto online e si creano i link alle varie procedure.',
    passi: [
      {
        chiave: 'kb-tc-bozza',
        titolo: 'Prima bozza di termini e condizioni',
        responsabili: ['maurizio'],
        fatto: true,
      },
      {
        chiave: 'kb-responsabile',
        titolo: 'Nominare la persona interna che segue termini e condizioni e Knowledge Base',
        responsabili: ['marco', 'paola'],
        bloccante: true,
      },
      {
        chiave: 'kb-tc-revisione',
        titolo: 'Revisione e approvazione di termini e condizioni',
        responsabili: ['referente-kb'],
        dopo: ['kb-responsabile'],
      },
      {
        chiave: 'kb-bozza',
        titolo: 'Bozza della Knowledge Base',
        responsabili: ['maurizio'],
        dopo: ['kb-tc-revisione'],
      },
      {
        chiave: 'kb-approvazione',
        titolo: 'Approvazione della Knowledge Base',
        responsabili: ['referente-kb'],
        dopo: ['kb-bozza'],
      },
      {
        chiave: 'kb-pubblicazione',
        titolo: 'Pubblicazione online e link alle procedure',
        responsabili: ['maurizio'],
        dopo: ['kb-approvazione'],
      },
    ],
  },
  {
    numero: '07',
    titolo: 'Automazione Tesseramenti',
    descrizione: 'Workflow digitale scadenze e rinnovi, riduzione rischio operativo e tempi',
    consegnaPrevista: '2026-10-31',
    priorita: 'Alta',
    stato: { etichetta: 'In attesa di Ronchiverdi', tono: 'warn' },
    sintesi:
      'Il catalogo delle API di CSI è già in mano a Maurizio. Per partire serve che Ronchiverdi contatti CSI per richiedere l’attivazione del servizio e farsi dare le credenziali di accesso.',
    passi: [
      {
        chiave: 'tesseramenti-catalogo-api',
        titolo: 'Catalogo API di CSI',
        responsabili: ['maurizio'],
        fatto: true,
      },
      {
        chiave: 'tesseramenti-attivazione-csi',
        titolo: 'Contattare CSI: attivazione del servizio e credenziali di accesso',
        descrizione: 'Le credenziali vanno poi passate a Maurizio.',
        responsabili: ['maria-grazia'],
        bloccante: true,
      },
      {
        chiave: 'tesseramenti-sviluppo',
        titolo: 'Sviluppo dell’automazione',
        responsabili: ['maurizio'],
        dopo: ['tesseramenti-attivazione-csi'],
      },
    ],
  },
  {
    numero: '08',
    titolo: 'Processo Gestione Lamentele',
    descrizione: 'Form + assegnazione + follow-up tracciato, storico per area',
    consegnaPrevista: '2026-12-31',
    priorita: 'Media',
    stato: NON_RENDICONTATO,
    passi: [],
  },
  {
    numero: '09',
    titolo: 'Forms Operativi Vari',
    descrizione: 'Manutenzione, pulizie, personal trainer — segnalazione strutturata e tracciamento',
    consegnaPrevista: '2026-12-31',
    priorita: 'Media',
    stato: NON_RENDICONTATO,
    passi: [],
  },
  {
    numero: '10',
    titolo: 'Dashboard BI',
    descrizione: 'Analisi dati Marketing, Commerciale e Vendite — KPI in tempo reale',
    consegnaPrevista: '2026-12-31',
    priorita: 'Alta',
    stato: { etichetta: 'Pubblicata · in affinamento', tono: 'info' },
    sintesi:
      'La dashboard è già pubblicata, con i dati live di InfoRYOU classificati, gli accessi al sito e la gestione dei new del Core. Man mano che l’adozione del CRM diventa più trasversale — rinnovi compresi, e new con più dati — la dashboard si affina ancora. Quali indici di performance e KPI servono lo deve dire Ronchiverdi: serve una richiesta scritta.',
    link: [{ href: '/dashboard/direzione', label: 'Apri la Dashboard direzionale', sezione: 'direzione' }],
    passi: [
      {
        chiave: 'bi-pubblicazione',
        titolo: 'Dashboard pubblicata: dati live InfoRYOU, accessi al sito, gestione dei new Core',
        responsabili: ['maurizio'],
        fatto: true,
      },
      {
        chiave: 'bi-kpi-richiesta',
        titolo: 'Richiesta scritta degli indici di performance e dei KPI da avere',
        descrizione: 'Quali numeri volete vedere, per chi e con quale frequenza.',
        responsabili: ['marco', 'paola', 'lorella'],
      },
      {
        chiave: 'bi-affinamento',
        titolo: 'Affinamento della dashboard sui KPI richiesti',
        descrizione: 'Cresce insieme all’adozione del CRM su rinnovi e new.',
        responsabili: ['maurizio'],
        dopo: ['bi-kpi-richiesta'],
      },
    ],
  },
]

export const PASSI: Passo[] = DELIVERABLE.flatMap((d) => d.passi)

export function trovaPasso(chiave: string): Passo | undefined {
  return PASSI.find((p) => p.chiave === chiave)
}

// ─────────────────────────────────────────── aggiornamenti e stato calcolato

export const TIPI_AGGIORNAMENTO = ['fatto', 'riaperto', 'nota'] as const
export type TipoAggiornamento = (typeof TIPI_AGGIORNAMENTO)[number]

export type Aggiornamento = {
  id: number
  created_at: string
  passo: string
  email: string
  tipo: TipoAggiornamento
  testo: string | null
}

export type StatoPasso = {
  fatto: boolean
  /** Chi e quando, se l'ha segnato qualcuno dalla pagina; null = fatto alla data della situazione. */
  fattoDa: string | null
  fattoIl: string | null
  /** Passi richiesti da `dopo` e non ancora fatti. */
  inAttesaDi: Passo[]
  aggiornamenti: Aggiornamento[]
}

/**
 * Lo stato di ogni passo: quello scritto qui, poi gli aggiornamenti in ordine
 * di tempo. Vince l'ultimo «fatto» o «riaperto»; le note non cambiano lo stato.
 */
export function calcolaStati(aggiornamenti: readonly Aggiornamento[]): Record<string, StatoPasso> {
  const stati: Record<string, StatoPasso> = {}
  for (const p of PASSI) {
    stati[p.chiave] = { fatto: !!p.fatto, fattoDa: null, fattoIl: null, inAttesaDi: [], aggiornamenti: [] }
  }
  const ordinati = [...aggiornamenti].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)
  for (const a of ordinati) {
    const s = stati[a.passo]
    if (!s) continue
    s.aggiornamenti.push(a)
    if (a.tipo === 'fatto') {
      s.fatto = true
      s.fattoDa = a.email
      s.fattoIl = a.created_at
    } else if (a.tipo === 'riaperto') {
      s.fatto = false
      s.fattoDa = null
      s.fattoIl = null
    }
  }
  for (const p of PASSI) {
    stati[p.chiave].inAttesaDi = (p.dopo ?? [])
      .map((k) => trovaPasso(k))
      .filter((d): d is Passo => !!d && !stati[d.chiave].fatto)
  }
  return stati
}

/** «Referente Chiron» resta «da nominare» finché il passo della nomina non è fatto. */
export function eDaNominare(chiave: ChiavePersona, stati: Record<string, StatoPasso>): boolean {
  const finche = PERSONE[chiave].daNominareFinche
  return !!finche && !stati[finche]?.fatto
}

/** "31 ago 2026" per una data YYYY-MM-DD. */
export function dataProposta(giorno: string): string {
  return new Date(`${giorno}T12:00:00Z`).toLocaleDateString('it-IT', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
