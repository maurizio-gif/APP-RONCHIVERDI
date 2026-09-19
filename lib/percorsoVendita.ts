// Il percorso di chi ha appena comprato: cosa è successo nel CRM nei giorni
// prima della vendita — una richiesta dal sito, una trattativa, un'azione
// della segreteria (task, appuntamento, visita in sede). Non è una tabella
// nuova: è un calcolo su cose che il CRM già scrive (form_contatti,
// opportunita, task), ricomposto sul momento — vedi
// lib/percorsoVendita-server.ts per il come.
//
// Stessa idea (e stesso nome delle funzioni) del percorso dei contratti in
// APP-ATHLON: **il riepilogo prima, il dettaglio dopo**. Chi verifica una
// vendita non vuole leggere una cronologia intera: vuole sapere in una frase
// se questa persona è arrivata da sola o se qualcuno l'ha lavorata, e aprire
// il dettaglio solo quando quella frase dice qualcosa di interessante.
//
// Nessun import server-only: usato sia da Server Component sia da client.

/**
 * Quanti giorni prima della vendita si guarda.
 *
 * Più indietro non è più un percorso d'acquisizione, è la storia della
 * persona — che si legge nella sua scheda, dove non c'è una finestra.
 */
export const FINESTRA_PERCORSO_GIORNI = 30

export const GENERI = [
  { chiave: 'richiesta', etichetta: 'Richiesta dal sito' },
  { chiave: 'trattativa', etichetta: 'Trattativa' },
  { chiave: 'desk', etichetta: 'Segreteria' },
] as const
export type GenereTappa = (typeof GENERI)[number]['chiave']

/** Un momento del percorso: una cosa sola successa una volta sola. */
export type Tappa = {
  /** Univoca nell'elenco: serve solo come key di React. */
  chiave: string
  genere: GenereTappa
  /** Quando, ISO. */
  momento: string
  /** Cosa è successo, in poche parole. */
  titolo: string
  /** Il contorno, se c'è. */
  dettaglio: string | null
}

/** Il percorso completo, come lo restituisce il calcolo. */
export type Percorso = {
  tappe: Tappa[]
  /** Il momento su cui la finestra è ancorata: la vendita. */
  fine: string
}

export type Riepilogo = {
  /** Quante tappe in tutto. */
  quante: number
  /** Per genere, solo i generi presenti, nell'ordine di GENERI. */
  perGenere: { genere: GenereTappa; quante: number }[]
  /** In quanti giorni diversi si è fatta viva la persona: dice l'insistenza meglio del totale. */
  giorniAttivi: number
  /** La prima tappa della finestra, e quanti giorni prima della vendita è successa. */
  prima: { tappa: Tappa; giorniPrima: number } | null
  /** L'ultima prima della vendita. */
  ultima: { tappa: Tappa; giorniPrima: number } | null
  /**
   * Vero se in mezzo c'è almeno un'azione della segreteria (genere `desk`).
   *
   * È la sola cosa, fra tutte quelle nel riepilogo, che cambia una lettura:
   * una richiesta dal sito senza nessun seguito dice che il sito ha portato
   * il contatto, ma non che qualcuno l'abbia lavorato. Un task, un
   * appuntamento, una visita in sede sì.
   */
  lavorato: boolean
}

/** Quanti giorni separano due momenti, troncati e non arrotondati. */
export function giorniFra(dopo: string, prima: string): number {
  return Math.max(0, Math.floor((Date.parse(dopo) - Date.parse(prima)) / 86400000))
}

/** «il giorno stesso», «1 giorno prima», «12 giorni prima»: il singolare esiste. */
export function giorniPrimaInParole(giorni: number): string {
  if (giorni === 0) return 'il giorno stesso'
  return giorni === 1 ? '1 giorno prima' : `${giorni} giorni prima`
}

/**
 * Il riepilogo che si legge prima di aprire il dettaglio: quanto si è fatta
 * viva la persona, in quanti giorni diversi, quanto ci ha messo dal primo
 * segnale alla vendita, e soprattutto se qualcuno l'ha lavorata o è arrivata
 * da sola.
 */
export function riassumi(percorso: Percorso): Riepilogo {
  const { tappe, fine } = percorso

  const conteggi = new Map<GenereTappa, number>()
  const giorni = new Set<string>()
  for (const t of tappe) {
    conteggi.set(t.genere, (conteggi.get(t.genere) ?? 0) + 1)
    giorni.add(t.momento.slice(0, 10))
  }

  // Le tappe arrivano dalla più recente (vedi percorsoDiPersona): la prima in
  // ordine di tempo è l'ultima dell'array.
  const piuVecchia = tappe.length > 0 ? tappe[tappe.length - 1] : null
  const piuRecente = tappe.length > 0 ? tappe[0] : null

  return {
    quante: tappe.length,
    perGenere: GENERI.map((g) => ({ genere: g.chiave, quante: conteggi.get(g.chiave) ?? 0 })).filter(
      (r) => r.quante > 0
    ),
    giorniAttivi: giorni.size,
    prima: piuVecchia ? { tappa: piuVecchia, giorniPrima: giorniFra(fine, piuVecchia.momento) } : null,
    ultima: piuRecente ? { tappa: piuRecente, giorniPrima: giorniFra(fine, piuRecente.momento) } : null,
    lavorato: tappe.some((t) => t.genere === 'desk'),
  }
}

/**
 * Il riepilogo in una frase, quella che si legge senza aprire niente.
 */
export function inUnaFrase(r: Riepilogo): string {
  if (r.quante === 0) return `Nessuna traccia nei ${FINESTRA_PERCORSO_GIORNI} giorni prima dell’acquisto.`

  const pezzi: string[] = []
  pezzi.push(r.quante === 1 ? '1 tappa' : `${r.quante} tappe`)
  pezzi.push(r.giorniAttivi === 1 ? 'in 1 giorno' : `in ${r.giorniAttivi} giorni diversi`)

  if (r.prima) {
    pezzi.push(
      r.prima.giorniPrima === 0
        ? 'tutto il giorno stesso dell’acquisto'
        : `il primo segnale ${giorniPrimaInParole(r.prima.giorniPrima)}`
    )
  }

  // L'ultima cosa della frase, ed è quella che si va a cercare: senza un
  // tocco della segreteria, questa vendita l'ha portata il sito da sola.
  pezzi.push(r.lavorato ? 'con almeno un contatto della segreteria' : 'senza nessun contatto della segreteria')

  return `${pezzi.join(', ')}.`
}

/**
 * A che punto cade una data (di calendario, "YYYY-MM-DD") rispetto alla
 * finestra dei 30 giorni prima di una vendita — per classificare tante
 * vendite insieme (report, grafico) senza ricostruire il percorso di
 * ciascuna una per volta. Stessa regola di `riassumi().lavorato`, ridotta a
 * una sola data invece che a un elenco di tappe.
 */
export function eLavorata(dataVendita: string, dateAzioniDesk: string[]): boolean {
  const fino = new Date(dataVendita).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
  const dopo = new Date(
    Date.parse(dataVendita) - FINESTRA_PERCORSO_GIORNI * 86400000
  ).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
  return dateAzioniDesk.some((d) => d >= dopo && d <= fino)
}
