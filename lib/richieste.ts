// Instradamento delle richieste che arrivano dal form del sito.
//
// Il form (src/data/leadActivities.ts nel repo del sito) fa scegliere una
// sola attività, e da lì si ramifica: Abbonamento Club e Family passano dalla
// segreteria, che fissa un appuntamento o una telefonata — e finiscono in
// Agenda; tutte le altre vanno diritte al responsabile di quel corso.
//
// Qui quella ramificazione diventa un canale per responsabile: una sezione a
// testa, un permesso a testa, così ciascuno vede le proprie richieste e non
// legge i contatti degli altri.
//
// È l'unica fonte di verità dell'instradamento: aggiungere un corso sul sito
// significa aggiungere una voce qui, non toccare le pagine.
//
// Nessun import server-only: il file è usato sia dai Server Component sia dai
// componenti client.

export type Responsabile = {
  nome: string
  ruolo: string
  /** Email di servizio del responsabile, come mostrata sul sito. */
  email?: string
  /** Numero in formato leggibile e in formato per i link tel:/wa.me. */
  telefono?: string
  telefonoHref?: string
}

export type Canale = {
  /** Chiave del permesso e dell'URL: /dashboard/richieste/<chiave>. */
  chiave: string
  label: string
  /** Sottotitolo della pagina: cosa contiene questo canale. */
  descrizione: string
  /**
   * Id attività del form generico (src/data/leadActivities.ts) che finiscono
   * qui. Vuoto per i canali che si agganciano all'origine — vedi `origine`.
   */
  attivita: string[]
  /**
   * Per i form inline di pagina, che non fanno scegliere un'attività e si
   * riconoscono dal campo `origine` del payload (es. "chinesis-inline"). Un
   * canale ha o le attività o le origini, non entrambe.
   */
  origine?: string[]
  /**
   * Solo per Young School Tennis, l'unica attività con due responsabili: il
   * settore scelto nel form decide a chi va la richiesta. Un canale senza
   * questo campo prende tutte le richieste delle sue attività.
   */
  settore?: 'scuola' | 'competizione'
  responsabile: Responsabile
  /**
   * true per Club e Family: sono le richieste che passano dalla segreteria e
   * che compaiono anche in Agenda, perché hanno un appuntamento o una
   * telefonata da tenere. Le altre no: il responsabile chiama e chiude.
   */
  inAgenda?: boolean
}

export const CANALI: readonly Canale[] = [
  {
    chiave: 'richieste-club',
    label: 'Abbonamenti Club e Family',
    descrizione:
      'Le richieste che passano dalla segreteria: appuntamento in sede, telefonata o messaggio. Gli appuntamenti con un orario compaiono anche in Agenda.',
    attivita: ['club-adulti', 'family'],
    responsabile: { nome: 'Segreteria', ruolo: 'Abbonamenti Club e Family' },
    inAgenda: true,
  },
  {
    chiave: 'richieste-tennis-scuola',
    label: 'Tennis — Scuola',
    descrizione: 'Young School Tennis, richieste per il settore Scuola.',
    attivita: ['corsi-tennis'],
    settore: 'scuola',
    responsabile: {
      nome: 'Stefano Bertone',
      ruolo: 'Responsabile Settore Scuola Tennis',
      email: 's.bertone@ronchiverdi.it',
      telefono: '+39 335 320334',
      telefonoHref: '+39335320334',
    },
  },
  {
    chiave: 'richieste-tennis-competizione',
    label: 'Tennis — Competizione',
    descrizione: 'Young School Tennis, richieste per il settore Competizione.',
    attivita: ['corsi-tennis'],
    settore: 'competizione',
    responsabile: {
      nome: 'Dario Andrea',
      ruolo: 'Responsabile Settore Competizione Tennis',
      email: 'a.dario@ronchiverdi.it',
      telefono: '+39 335 7032403',
      telefonoHref: '+393357032403',
    },
  },
  {
    chiave: 'richieste-nuoto',
    label: 'Young School Nuoto',
    descrizione: 'Corsi di nuoto per bambini e ragazzi.',
    attivita: ['scuola-nuoto'],
    responsabile: {
      nome: 'Sara Tugnolo',
      ruolo: 'Responsabile Young School Nuoto',
      email: 'youngschoolnuoto@ronchiverdi.it',
      telefono: '+39 380 7522285',
      telefonoHref: '+393807522285',
    },
  },
  {
    chiave: 'richieste-triathlon',
    label: 'Young School Triathlon',
    descrizione: 'Nuoto, bici e corsa per bambini e ragazzi dai 6 ai 13 anni.',
    attivita: ['triathlon-young'],
    responsabile: {
      nome: 'Giorgio Mortara',
      ruolo: 'Responsabile Young School Triathlon',
      email: 'g.mortara@ronchiverdi.it',
      telefono: '+39 348 1541597',
      telefonoHref: '+393481541597',
    },
  },
  {
    chiave: 'richieste-summer-camp',
    label: 'Summer Camp',
    descrizione: 'Le settimane estive per bambini e ragazzi.',
    attivita: ['summer-camp'],
    responsabile: {
      nome: "Silvana D'Auria",
      ruolo: 'Responsabile Summer Camp',
      email: 'kidsvillage@ronchiverdi.it',
      telefono: '+39 349 7026694',
      telefonoHref: '+393497026694',
    },
  },
  {
    chiave: 'richieste-chinesis',
    label: 'Chinesis',
    descrizione:
      'Richieste dal form della pagina Chinesis. Non passano dall’alberatura delle attività: si riconoscono dall’origine "chinesis-inline".',
    attivita: [],
    origine: ['chinesis-inline'],
    // Nome, telefono ed email del referente non sono ancora pubblicati sulla
    // pagina Chinesis: da completare qui quando arrivano.
    responsabile: { nome: 'Centro Chinesis', ruolo: 'Referente da definire' },
  },
  {
    chiave: 'richieste-padel',
    label: 'Corsi Padel',
    descrizione: 'Corsi di gruppo e lezioni individuali per adulti.',
    attivita: ['corsi-padel'],
    responsabile: {
      nome: 'Davide Casale',
      ruolo: 'Responsabile Corsi Padel',
      telefono: '+39 339 8817507',
      telefonoHref: '+393398817507',
    },
  },
]

export function canaleDaChiave(chiave: string): Canale | undefined {
  return CANALI.find((c) => c.chiave === chiave)
}

/** Le attività che passano dalla segreteria: quelle che l'Agenda mostra. */
export const ATTIVITA_IN_AGENDA: readonly string[] = CANALI.filter((c) => c.inAgenda).flatMap(
  (c) => c.attivita
)

/**
 * Il canale a cui appartiene una richiesta. Ritorna undefined per le
 * richieste che non corrispondono a nessun canale — un'attività aggiunta sul
 * sito e non ancora instradata qui: meglio che resti fuori da tutte le
 * sezioni piuttosto che finire nella casella sbagliata di qualcuno.
 */
export function canaleDiRichiesta(riga: {
  attivita?: string | null
  settore?: string | null
  origine?: string | null
}): Canale | undefined {
  return CANALI.find((c) => {
    // I canali dei form inline si riconoscono dall'origine: quelle richieste
    // non hanno un'attività, quindi il confronto per attività non le
    // troverebbe mai.
    if (c.origine) return !!riga.origine && c.origine.includes(riga.origine)

    if (!riga.attivita || !c.attivita.includes(riga.attivita)) return false
    if (c.settore) return riga.settore === c.settore
    return true
  })
}
