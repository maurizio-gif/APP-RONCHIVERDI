// Agenda condivisa: un solo calendario per gli appuntamenti che il cliente
// prenota dal sito (form_contatti, dove azione/data_scelta/ora_scelta le
// scrive lui compilando il form) e per le voci che la segreteria si fissa da
// sé (tabella task).
//
// Le due sorgenti diventano "voci" con la stessa forma, così la pagina non
// deve sapere da dove arrivano — ed è quello che permette a
// /api/disponibilita di togliere dagli orari offerti sul sito sia gli uni sia
// gli altri.
//
// Nessun import server-only qui: il file è usato sia dai Server Component sia
// dai componenti client.

export const TIPI = [
  'appuntamento_in_sede',
  'appuntamento_telefonico',
  'task',
  'email',
  'whatsapp',
] as const
export type TipoVoce = (typeof TIPI)[number]

// Il tipo si chiama "Task", non "Da fare": "Da fare" è lo stato di una voce
// (vedi ETICHETTE_STATO), e usare la stessa parola per il tipo e per lo stato
// rendeva illeggibile l'elenco — il badge del tipo e quello dello stato
// dicevano la stessa cosa per due concetti diversi.
export const ETICHETTE_TIPO: Record<TipoVoce, string> = {
  appuntamento_in_sede: 'Visita in sede',
  appuntamento_telefonico: 'Telefonata',
  task: 'Task',
  email: 'Email',
  whatsapp: 'WhatsApp',
}

export const ETICHETTE_TIPO_BREVI: Record<TipoVoce, string> = {
  appuntamento_in_sede: 'In sede',
  appuntamento_telefonico: 'Telefonata',
  task: 'Task',
  email: 'Email',
  whatsapp: 'WhatsApp',
}

export const OPZIONI_TIPO = TIPI.map((tipo) => ({ valore: tipo, etichetta: ETICHETTE_TIPO[tipo] }))

/**
 * Una classe di colore per tipologia. In elenco il tipo si riconosce dal
 * colore prima che dal testo: cinque badge tutti grigi obbligano a leggerli
 * uno per uno.
 */
export const CLASSE_TIPO: Record<TipoVoce, string> = {
  appuntamento_in_sede: 'tipo-sede',
  appuntamento_telefonico: 'tipo-telefono',
  task: 'tipo-task',
  email: 'tipo-email',
  whatsapp: 'tipo-whatsapp',
}

/**
 * I due tipi che prenotano davvero uno slot, e i soli che il sito può
 * offrire. Email, WhatsApp e le cose da fare generiche sono impegni della
 * giornata, non appuntamenti presi con qualcuno: contarli porterebbe via
 * slot senza motivo — decine di follow-up creati in blocco finirebbero tutti
 * alla stessa ora e brucerebbero quella fascia ogni giorno.
 */
export const TIPI_APPUNTAMENTO = ['appuntamento_in_sede', 'appuntamento_telefonico'] as const

export function eAppuntamentoVero(tipo: TipoVoce): boolean {
  return (TIPI_APPUNTAMENTO as readonly string[]).includes(tipo)
}

/**
 * Quanto occupa in agenda ciascun tipo quando non è indicato diversamente.
 * I 45 e i 20 minuti sono gli stessi passi con cui il form del sito offre gli
 * orari (DISPONIBILITA in src/lib/leadForm.client.js): vanno cambiati nei due
 * posti insieme, altrimenti il sito propone slot che l'agenda calcola più
 * lunghi o più corti, e la sottrazione degli occupati sbaglia i confini.
 */
export const DURATA_PREDEFINITA: Record<TipoVoce, number> = {
  appuntamento_in_sede: 45,
  appuntamento_telefonico: 20,
  task: 10,
  email: 5,
  whatsapp: 5,
}

export const STATI = ['aperto', 'completato', 'annullato'] as const
export type Stato = (typeof STATI)[number]

export const ETICHETTE_STATO: Record<Stato, string> = {
  aperto: 'Da fare',
  completato: 'Fatto',
  annullato: 'Annullato',
}

/**
 * Com'è andata una voce chiusa. È un asse diverso dallo stato: `stato` dice se
 * c'è ancora da lavorarci, l'esito dice se è andata a buon fine. Una
 * telefonata fatta e una telefonata a cui non ha risposto nessuno sono
 * entrambe chiuse, e per la segreteria non sono la stessa cosa.
 */
export const ESITI = ['eseguita', 'fallita'] as const
export type Esito = (typeof ESITI)[number]

export const ETICHETTE_ESITO: Record<Esito, string> = {
  eseguita: 'Eseguita',
  fallita: 'Fallita',
}

export function eEsitoValido(valore: string | null | undefined): valore is Esito {
  return !!valore && (ESITI as readonly string[]).includes(valore)
}

/**
 * L'etichetta da mostrare: su una voce chiusa vince l'esito, perché "Fatto" su
 * qualcosa che è andata male direbbe il falso. Senza esito (voci chiuse prima
 * che gli esiti esistessero) resta l'etichetta dello stato.
 */
export function etichettaStato(stato: Stato, esitoTipo: Esito | null): string {
  if (stato === 'completato' && esitoTipo) return ETICHETTE_ESITO[esitoTipo]
  return ETICHETTE_STATO[stato]
}

export function eTipoValido(valore: string | null | undefined): valore is TipoVoce {
  return !!valore && (TIPI as readonly string[]).includes(valore)
}

export function eStatoValido(valore: string | null | undefined): valore is Stato {
  return !!valore && (STATI as readonly string[]).includes(valore)
}

// ────────────────────────────────────────────────────────────── date e ore

/**
 * L'adesso di Roma, ricostruito come se fosse UTC. Usare l'orologio del
 * server (su Vercel è UTC) romperebbe i confronti vicino a mezzanotte e nel
 * cambio ora legale/solare: le date e le ore in agenda sono scritte dalle
 * persone, senza fuso, e vanno confrontate alla pari.
 */
function adessoRoma(): Date {
  const parti = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const numero = (tipo: string) => Number(parti.find((p) => p.type === tipo)?.value)
  return new Date(
    Date.UTC(
      numero('year'),
      numero('month') - 1,
      numero('day'),
      numero('hour'),
      numero('minute'),
      numero('second')
    )
  )
}

/** Oggi a Roma, in formato YYYY-MM-DD. */
export function oggiRoma(): string {
  const d = adessoRoma()
  return chiaveGiorno(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export function chiaveGiorno(anno: number, mese: number, giorno: number): string {
  return `${anno}-${String(mese + 1).padStart(2, '0')}-${String(giorno).padStart(2, '0')}`
}

/** Somma giorni a una data YYYY-MM-DD, restando in YYYY-MM-DD. */
export function giornoPiu(giorno: string, giorni: number): string {
  const d = new Date(`${giorno}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + giorni)
  return chiaveGiorno(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** Il lunedì della settimana che contiene il giorno dato. */
export function lunediDi(giorno: string): string {
  const d = new Date(`${giorno}T12:00:00Z`)
  // getUTCDay: 0 = domenica. In Italia la settimana comincia lunedì.
  const scarto = (d.getUTCDay() + 6) % 7
  return giornoPiu(giorno, -scarto)
}

/** "lunedì 2 settembre" — la prima lettera la alza il CSS, non questa. */
export function dataLunga(giorno: string): string {
  return new Date(`${giorno}T12:00:00Z`).toLocaleDateString('it-IT', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

/** "lun 2 set" — per la colonna Data dell'elenco, dove lo spazio è poco. */
export function dataBreve(giorno: string): string {
  return new Date(`${giorno}T12:00:00Z`).toLocaleDateString('it-IT', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

// ─────────────────────────────────────────────────────── griglia del mese
//
// Il calendario mensile ragiona su anno e mese numerici, non su date: una
// griglia si costruisce contando i giorni, e passare per oggetti Date solo
// per poi riestrarne i pezzi introduce fusi che qui non servono.

/** Il primo giorno del mese che contiene il giorno dato, in YYYY-MM-DD. */
export function primoDelMese(giorno: string): string {
  return `${giorno.slice(0, 7)}-01`
}

/** Sposta di N mesi restando sul primo del mese. Gestisce il cambio d'anno. */
export function mesePiu(giorno: string, mesi: number): string {
  const [anno, mese] = giorno.split('-').map(Number)
  const totale = anno * 12 + (mese - 1) + mesi
  return chiaveGiorno(Math.floor(totale / 12), totale % 12, 1)
}

/** Ultimo giorno del mese: il "giorno 0" del mese dopo. */
export function ultimoDelMese(giorno: string): string {
  const [anno, mese] = giorno.split('-').map(Number)
  const fine = new Date(Date.UTC(anno, mese, 0))
  return chiaveGiorno(fine.getUTCFullYear(), fine.getUTCMonth(), fine.getUTCDate())
}

/** "settembre 2026", per l'intestazione del calendario. */
export function etichettaMese(giorno: string): string {
  return new Date(`${primoDelMese(giorno)}T12:00:00Z`).toLocaleDateString('it-IT', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Le celle vuote da mettere prima del giorno 1 perché il mese cominci nella
 * colonna giusta. La settimana comincia lunedì, quindi lo scarto è
 * (giorno della settimana + 6) % 7 e non il getUTCDay() nudo.
 */
export function celleVuoteIniziali(giorno: string): number {
  const d = new Date(`${primoDelMese(giorno)}T12:00:00Z`)
  return (d.getUTCDay() + 6) % 7
}

/** Tutti i giorni del mese, in ordine, come chiavi YYYY-MM-DD. */
export function giorniDelMese(giorno: string): string[] {
  const primo = primoDelMese(giorno)
  const quanti = Number(ultimoDelMese(primo).slice(8, 10))
  return Array.from({ length: quanti }, (_, i) => giornoPiu(primo, i))
}

export const GIORNI_SETTIMANA = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'] as const

/** Le colonne `time` di Postgres arrivano come 'HH:MM:SS': i secondi non servono. */
export function normalizzaOra(ora: string | null | undefined): string | null {
  if (!ora) return null
  const pulita = String(ora).slice(0, 5)
  return /^\d{2}:\d{2}$/.test(pulita) ? pulita : null
}

/** Fine di una voce, per mostrare "09:30 - 10:00" invece della sola ora. */
export function oraFine(ora: string | null, durataMinuti: number): string | null {
  const inizio = normalizzaOra(ora)
  if (!inizio) return null
  const [ore, minuti] = inizio.split(':').map(Number)
  const totale = ore * 60 + minuti + durataMinuti
  // Una voce che sfora la mezzanotte si fermerebbe a 23:59: in agenda non
  // esistono appuntamenti che scavalcano il giorno.
  const limitato = Math.min(totale, 23 * 60 + 59)
  return `${String(Math.floor(limitato / 60)).padStart(2, '0')}:${String(limitato % 60).padStart(2, '0')}`
}

export function intervalloOrario(ora: string | null, durataMinuti: number): string | null {
  const inizio = normalizzaOra(ora)
  if (!inizio) return null
  const fine = oraFine(inizio, durataMinuti)
  return fine && fine !== inizio ? `${inizio} - ${fine}` : inizio
}

/**
 * Una voce inserita per un momento già passato, o per i prossimi 30 minuti, è
 * quasi certamente qualcosa che è già avvenuto e che si sta solo registrando
 * (una telefonata appena fatta, un'email appena scritta): si segna da sola
 * come fatta alla creazione, altrimenti resterebbe "da fare" per sempre —
 * nessuno riapre l'agenda solo per chiudere una cosa già successa.
 */
export function eGiaAvvenuto(data: string, ora: string | null): boolean {
  const [anno, mese, giorno] = data.split('-').map(Number)
  if ([anno, mese, giorno].some((n) => Number.isNaN(n))) return false

  const adesso = adessoRoma()
  const oraPulita = normalizzaOra(ora)

  if (!oraPulita) {
    // Senza orario la voce vale "tutto il giorno": è passata solo quando il
    // giorno stesso è finito, non trenta minuti dopo la sua mezzanotte.
    const inizioGiorno = Date.UTC(anno, mese - 1, giorno)
    const inizioOggi = Date.UTC(adesso.getUTCFullYear(), adesso.getUTCMonth(), adesso.getUTCDate())
    return inizioGiorno < inizioOggi
  }

  const [ore, minuti] = oraPulita.split(':').map(Number)
  const istante = Date.UTC(anno, mese - 1, giorno, ore, minuti)
  return istante <= adesso.getTime() + 30 * 60 * 1000
}

// ─────────────────────────────────────────────────────────── voci di agenda

export type OrigineVoce = 'task' | 'form_contatti'

/** Forma comune delle voci, qualunque sia la sorgente. */
export type VoceAgenda = {
  /** Unica anche mescolando le sorgenti: gli id di tabelle diverse possono coincidere. */
  chiave: string
  origine: OrigineVoce
  id: string
  tipo: TipoVoce
  titolo: string
  /** 'YYYY-MM-DD' */
  data: string
  /** 'HH:MM', oppure null = entro la giornata, senza slot. */
  ora: string | null
  durataMinuti: number
  note: string | null
  assegnatoA: string | null
  stato: Stato
  daFare: boolean
  /** Nome, email e cellulare in minuscolo: su questo cerca la ricerca. */
  ricerca: string
  /**
   * I recapiti di chi c'è dietro la voce, quando ci sono: l'elenco li mostra
   * sotto il nome, così chi deve richiamare non apre il dettaglio per
   * cercarli. Le voci della segreteria (task) non hanno una persona e li
   * lasciano a null.
   */
  email: string | null
  cellulare: string | null
  /** L'attività richiesta sul sito ("Tennis", "Nuoto"…), quando c'è. */
  attivita: string | null
  /** Com'è andata, se è già stata chiusa con un esito. */
  esitoTipo: Esito | null
  /** La nota scritta chiudendo la voce. */
  esito: string | null
}

type Riga = Record<string, any>

export function voceDaTask(riga: Riga): VoceAgenda {
  const stato: Stato = eStatoValido(riga.stato) ? riga.stato : 'aperto'
  const tipo: TipoVoce = eTipoValido(riga.tipo) ? riga.tipo : 'task'
  return {
    chiave: `task-${riga.id}`,
    origine: 'task',
    id: String(riga.id),
    tipo,
    titolo: riga.titolo || ETICHETTE_TIPO[tipo],
    data: String(riga.data).slice(0, 10),
    ora: normalizzaOra(riga.ora),
    durataMinuti:
      Number(riga.durata_minuti) > 0 ? Number(riga.durata_minuti) : DURATA_PREDEFINITA[tipo],
    note: riga.note ?? null,
    assegnatoA: riga.assegnato_a ?? null,
    stato,
    daFare: stato === 'aperto',
    ricerca: [riga.titolo, riga.note].filter(Boolean).join(' ').toLowerCase(),
    email: null,
    cellulare: null,
    attivita: null,
    esitoTipo: eEsitoValido(riga.esito_tipo) ? riga.esito_tipo : null,
    esito: riga.esito ?? null,
  }
}

/**
 * L'azione scelta nel form del sito diventa un tipo di agenda. 'messaggio'
 * non è un appuntamento: chi lascia un messaggio non ha preso un orario, e
 * infatti data_scelta e ora_scelta restano vuote.
 */
export function tipoDaAzione(azione: string | null | undefined): TipoVoce | null {
  if (azione === 'appuntamento') return 'appuntamento_in_sede'
  if (azione === 'telefonata') return 'appuntamento_telefonico'
  return null
}

/**
 * Voce di agenda da una richiesta prenotata sul sito. Ritorna null se quella
 * richiesta non è un appuntamento con data: un messaggio non occupa il
 * calendario.
 */
export function voceDaContatto(riga: Riga): VoceAgenda | null {
  const tipo = tipoDaAzione(riga.azione)
  if (!tipo || !riga.data_scelta) return null

  const nome = [riga.nome, riga.cognome].filter(Boolean).join(' ').trim()
  // Le richieste dal sito non hanno uno stato di lavorazione proprio in
  // agenda: `gestito` è il segno che la segreteria le ha già lavorate, ed è
  // quello che qui vale come "fatto".
  const stato: Stato = riga.gestito ? 'completato' : 'aperto'

  return {
    chiave: `contatto-${riga.id}`,
    origine: 'form_contatti',
    id: String(riga.id),
    tipo,
    titolo: nome || 'Richiesta dal sito',
    data: String(riga.data_scelta).slice(0, 10),
    ora: normalizzaOra(riga.ora_scelta),
    durataMinuti: DURATA_PREDEFINITA[tipo],
    // Solo il testo scritto dalla persona: l'attività ha una voce sua
    // (`attivita` qui sotto) e ripeterla dentro le note la faceva comparire
    // due volte nella stessa riga.
    note: riga.messaggio ?? null,
    assegnatoA: null,
    stato,
    daFare: stato === 'aperto',
    ricerca: [nome, riga.email, riga.cellulare, riga.attivita_label]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
    email: riga.email ?? null,
    cellulare: riga.cellulare ?? null,
    attivita: riga.attivita_label ?? null,
    esitoTipo: eEsitoValido(riga.esito_tipo) ? riga.esito_tipo : null,
    esito: riga.esito ?? null,
  }
}

/** Ordina per ora: le voci senza orario ("entro la giornata") vanno in fondo. */
export function ordinaVoci(voci: VoceAgenda[]): VoceAgenda[] {
  return [...voci].sort((a, b) => {
    if (a.ora && b.ora) return a.ora.localeCompare(b.ora)
    if (a.ora) return -1
    if (b.ora) return 1
    return a.titolo.localeCompare(b.titolo)
  })
}

/** Raggruppa per giorno, ogni giorno già ordinato. */
export function perGiorno(voci: VoceAgenda[]): Map<string, VoceAgenda[]> {
  const mappa = new Map<string, VoceAgenda[]>()
  for (const v of voci) {
    if (!mappa.has(v.data)) mappa.set(v.data, [])
    mappa.get(v.data)!.push(v)
  }
  for (const [g, lista] of mappa) mappa.set(g, ordinaVoci(lista))
  return mappa
}

// ──────────────────────────────────────────────────────────── disponibilità

export type SlotOccupato = { ora: string; durataMinuti: number }

/**
 * Gli slot occupati, giorno per giorno, a partire dalle voci di agenda: è la
 * risposta di /api/disponibilita, da cui il sito togliere gli orari che non
 * può più offrire.
 *
 * Occupano solo gli appuntamenti veri e con un'ora. Una voce annullata libera
 * il suo slot; una già completata no — quel momento è comunque stato usato.
 */
export function slotOccupati(voci: VoceAgenda[]): Record<string, SlotOccupato[]> {
  const occupati: Record<string, SlotOccupato[]> = {}
  for (const v of voci) {
    if (v.stato === 'annullato') continue
    if (!eAppuntamentoVero(v.tipo) || !v.ora) continue
    if (!occupati[v.data]) occupati[v.data] = []
    occupati[v.data].push({ ora: v.ora, durataMinuti: v.durataMinuti })
  }
  return occupati
}
