// Da dove arriva una trattativa, come si legge in un colpo d'occhio.
//
// Il dato esisteva già in due posti — `opportunita.origine` e
// `form_contatti.origine` — ma da nessuna parte diventava una cosa da
// guardare: in dashboard una trattativa nata al banco e una arrivata dal
// form del sito erano due righe identiche. Sono due telefonate diverse.
// Chi è passato dal Guest Register era qui, ha già parlato con qualcuno
// della segreteria, e richiamarlo come un contatto freddo è il modo di
// sembrare disorganizzati; chi ha scritto dal sito non ha mai visto nessuno.
//
// Quattro casi contano davvero, e il quinto serve a non mentire:
//
//   sito           — il form del sito, generico o inline di pagina;
//   guest-register — il banco, cioè il registro ospiti (`walk-in`);
//   evento         — il QR di un evento: stesso form del Guest Register, aperto con
//                    ?utm_source=evento (origine 'evento', scritta dal sito);
//   phone-in       — una telefonata o un'email alla segreteria, registrata in
//                    Phone In / Email In (origine 'phone-email-in', scritta da
//                    assegnaTrattativaDaEvento in lib/trattative-server.ts);
//   agenda         — nata da un evento scritto in agenda, senza nessuna
//                    richiesta dietro (vedi trattativa_per_evento in
//                    scripts/sql/2026-09-10-evento-apre-trattativa.sql);
//   scadenza-mensile — un abbonamento Core mensile (non Flex) che scade fra
//                    15 giorni: il lead lo apre il database da solo (vedi
//                    crea_lead_scadenze_mensili in
//                    scripts/sql/2026-10-15-mensili-lead-new.sql);
//   altro          — un'origine che questo file non conosce. Non si
//                    indovina: si dice «Altro» e si riporta la stringa, così
//                    chi la vede sa che c'è un canale da instradare qui.
//
// Accanto al canale c'è il secondo attributo del lead, **cosa ha chiesto**
// (tour, richiamami, in sede…): vedi richiestaDelLead più sotto.
//
// Nessun import server-only: lo usano sia i Server Component sia i
// componenti client.

import { dataBreve, eFasciaValida, testoFascia } from '@/lib/agenda'

export type ChiaveProvenienza =
  | 'sito'
  | 'guest-register'
  | 'evento'
  | 'phone-in'
  | 'agenda'
  | 'scadenza-mensile'
  | 'altro'

export type Provenienza = {
  chiave: ChiaveProvenienza
  /** Quello che si legge nella targhetta: corto, perché sta in riga. */
  etichetta: string
  /** Classe di colore della targhetta. */
  classe: string
  /** Una riga in più nell'espansione, dove c'è spazio per spiegarsi. */
  spiegazione: string
}

/** L'origine con cui il registro ospiti marca le proprie righe. */
export const ORIGINE_BANCO = 'walk-in'

/** L'origine con cui il sito marca chi si registra dal QR di un evento. */
export const ORIGINE_EVENTO = 'evento'

/** L'origine delle trattative aperte da Phone In / Email In. */
export const ORIGINE_PHONE_IN = 'phone-email-in'

/** L'origine dei lead aperti dalla scadenza di un mensile Core non Flex. */
export const ORIGINE_SCADENZA_MENSILE = 'scadenza-mensile'

/**
 * Le origini che il sito scrive, per esteso.
 *
 * Un elenco e non «tutto ciò che non è walk-in», perché «Altro» deve restare
 * un'informazione: il giorno che nasce un canale d'ingresso nuovo — un
 * chiosco in reception, un'integrazione, un import — le sue righe devono
 * comparire marcate «Altro» e farsi notare, non travestirsi da richieste dal
 * sito. Aggiungere qui è il gesto con cui si dichiara di averle riconosciute.
 *
 *   null          — le righe più vecchie, scritte prima che il sito marcasse
 *                   l'origine;
 *   'lead-modal'  — il form generico, quello che si apre dai pulsanti di
 *                   tutto il sito;
 *   *-inline      — i form dentro una pagina (chinesis-inline,
 *                   fitness-manager-inline: vedi `origine` in lib/richieste.ts).
 */
const ORIGINI_SITO: readonly (string | null)[] = [null, 'lead-modal']

const SITO: Provenienza = {
  chiave: 'sito',
  etichetta: 'Sito web',
  classe: 'da-sito',
  spiegazione: 'Ha scritto dal sito: non l’ha ancora incontrato nessuno.',
}

const GUEST_REGISTER: Provenienza = {
  chiave: 'guest-register',
  // Il commerciale chiama questo canale "Walk-in", non "Guest Register": la
  // chiave interna resta invariata (è quella salvata ovunque, dal database
  // alle classi CSS), cambia solo l'etichetta che si legge in giro.
  etichetta: 'Walk-in',
  classe: 'da-banco',
  spiegazione: 'Registrato al banco: è già stato qui e ha parlato con la segreteria.',
}

const EVENTO: Provenienza = {
  chiave: 'evento',
  etichetta: 'Evento',
  classe: 'da-evento',
  spiegazione:
    'Si è registrato dal QR code di un evento: l’abbiamo incontrato di persona, ma non è passato dal banco. Il nome dell’evento è nella campagna.',
}

const PHONE_IN: Provenienza = {
  chiave: 'phone-in',
  etichetta: 'Phone In / Email In',
  classe: 'da-telefono',
  spiegazione: 'Ha telefonato o scritto alla segreteria: la telefonata o l’email sono registrate in agenda.',
}

const AGENDA: Provenienza = {
  chiave: 'agenda',
  // Per esteso e non «Agenda»: la targhetta deve dire che questa trattativa
  // non è arrivata da fuori — l'ha aperta qualcuno del club scrivendo un
  // evento. Con la sola parola si leggeva come un canale qualsiasi.
  etichetta: 'Creata in agenda',
  classe: 'da-agenda',
  spiegazione:
    'Non è arrivata da una richiesta: l’ha aperta qualcuno del club scrivendo un evento in agenda su questa persona.',
}

const SCADENZA_MENSILE: Provenienza = {
  chiave: 'scadenza-mensile',
  etichetta: 'Mensile in scadenza',
  classe: 'da-scadenza',
  spiegazione:
    'È già socio, con un abbonamento mensile che non si rinnova da solo: va richiamato prima che scada per proporgli un abbonamento.',
}

/**
 * Da dove viene questa trattativa.
 *
 * Si guarda l'origine della **richiesta** prima di quella della trattativa:
 * la trattativa è della persona e vive più delle sue richieste, quindi una
 * aperta al banco a maggio e ripresa da una richiesta dal sito a settembre
 * porta ancora `origine = 'walk-in'` addosso — ma la cosa che si sta per
 * lavorare è arrivata dal sito, ed è quella che deve dire come ci si
 * presenta al telefono.
 */
export function provenienzaTrattativa({
  origineRichiesta,
  origineTrattativa,
  haRichiesta,
}: {
  /** `form_contatti.origine` della richiesta che si sta guardando. */
  origineRichiesta?: string | null
  /** `opportunita.origine`: da dove è nata la trattativa. */
  origineTrattativa?: string | null
  /** false quando nessuna richiesta è agganciata: è nata in agenda. */
  haRichiesta: boolean
}): Provenienza {
  const origine = haRichiesta ? origineRichiesta : origineTrattativa

  if (origine === ORIGINE_BANCO) return GUEST_REGISTER
  if (origine === ORIGINE_EVENTO) return EVENTO
  if (!haRichiesta) {
    if (origine === ORIGINE_PHONE_IN) return PHONE_IN
    if (origine === ORIGINE_SCADENZA_MENSILE) return SCADENZA_MENSILE
    return AGENDA
  }
  // Il form generico e i form di pagina sono entrambi il sito: da quale
  // pagina è partito è un dettaglio del percorso, non un canale diverso da
  // presidiare.
  if (ORIGINI_SITO.includes(origine ?? null) || origine?.endsWith('-inline')) return SITO

  return {
    chiave: 'altro',
    etichetta: 'Altro',
    classe: 'da-altro',
    spiegazione: `Origine non riconosciuta: "${origine}". Va instradata in lib/provenienza.ts.`,
  }
}

/**
 * Da dove viene un'origine, senza sapere se dietro c'è una richiesta —
 * usata dove si guardano trattative chiuse in massa (Core Manager) e un
 * join in più solo per saperlo non vale il costo: 'walk-in' e 'agenda' sono
 * le uniche origini che trova_o_crea_opportunita e trattativa_per_evento
 * scrivono quando la richiesta manca, quindi bastano da sole a riconoscerle.
 */
export function provenienzaDiOrigine(origine: string | null | undefined): Provenienza {
  if (origine === ORIGINE_BANCO) return GUEST_REGISTER
  if (origine === ORIGINE_EVENTO) return EVENTO
  if (origine === ORIGINE_PHONE_IN) return PHONE_IN
  if (origine === 'agenda') return AGENDA
  if (origine === ORIGINE_SCADENZA_MENSILE) return SCADENZA_MENSILE
  if (ORIGINI_SITO.includes(origine ?? null) || origine?.endsWith('-inline')) return SITO

  return {
    chiave: 'altro',
    etichetta: 'Altro',
    classe: 'da-altro',
    spiegazione: `Origine non riconosciuta: "${origine}". Va instradata in lib/provenienza.ts.`,
  }
}

// ───────────────────────────────────────── cosa ha chiesto (secondo attributo)

/**
 * Cosa ha chiesto chi ha aperto il lead. Sta sulla trattativa
 * (`opportunita.richiesta`, scritto una volta quando nasce — vedi
 * scripts/sql/2026-10-15-trattativa-richiesta.sql), e per una richiesta del
 * sito si ricava dalla sua `azione` con richiestaDaAzione, la stessa regola
 * della funzione SQL richiesta_da_azione.
 */
export type ChiaveRichiesta = 'tour' | 'richiamami' | 'in_sede' | 'telefonata' | 'email' | 'messaggio'

export type RichiestaLead = { chiave: ChiaveRichiesta; etichetta: string; classe: string }

const ETICHETTE_RICHIESTA: Record<ChiaveRichiesta, string> = {
  tour: 'Tour in sede',
  richiamami: 'Richiamami',
  // Registrato al Guest Register senza prenotare: è lì adesso, e il tour si
  // fa subito.
  in_sede: 'In sede',
  telefonata: 'Telefonata',
  email: 'Email',
  // Il messaggio libero del vecchio modulo del sito, prima del Richiamami.
  messaggio: 'Messaggio',
}

export function eChiaveRichiesta(v: string | null | undefined): v is ChiaveRichiesta {
  return !!v && v in ETICHETTE_RICHIESTA
}

/** La stessa regola di richiesta_da_azione (SQL), per una richiesta del sito o del banco. */
export function richiestaDaAzione(
  azione: string | null | undefined,
  origine: string | null | undefined
): ChiaveRichiesta | null {
  if (azione === 'appuntamento') return 'tour'
  if (azione === 'richiamami') return 'richiamami'
  if (azione === 'telefonata') return 'telefonata'
  if (azione === 'messaggio') return 'messaggio'
  if (origine === ORIGINE_BANCO) return 'in_sede'
  return null
}

/**
 * L'etichetta di cosa ha chiesto, o null se non c'è (una trattativa creata in
 * agenda non ha una richiesta dietro). Per il Richiamami, se la si conosce,
 * con la fascia: «Richiamami · Sera 17–20».
 */
export function richiestaDelLead(
  richiesta: string | null | undefined,
  fascia?: string | null
): RichiestaLead | null {
  if (!eChiaveRichiesta(richiesta)) return null
  const conFascia = richiesta === 'richiamami' && eFasciaValida(fascia)
  return {
    chiave: richiesta,
    etichetta: conFascia ? `Richiamami · ${testoFascia(fascia)}` : ETICHETTE_RICHIESTA[richiesta],
    classe: `richiesta-${richiesta.replace('_', '-')}`,
  }
}

/** L'etichetta per i report: senza fascia, e «Nessuna (agenda)» quando manca. */
export function etichettaRichiestaReport(richiesta: string | null | undefined): string {
  return eChiaveRichiesta(richiesta) ? ETICHETTE_RICHIESTA[richiesta] : 'Nessuna (creata in agenda)'
}

/**
 * La riga che dice quale mensile sta scadendo: «1.5-WELCOME UNDER 35 · scade
 * il 27 ott». Null se il lead non viene da una scadenza.
 */
export function testoScadenzaMensile(
  scadenza: { abbonamento: string | null; dataFine: string | null } | null | undefined
): string | null {
  if (!scadenza) return null
  const prodotto = scadenza.abbonamento?.replace(/\s+/g, ' ').trim() || 'Abbonamento mensile'
  return scadenza.dataFine ? `${prodotto} · scade il ${dataBreve(scadenza.dataFine)}` : prodotto
}
