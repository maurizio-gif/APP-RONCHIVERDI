// Ciclo di vita di una TRATTATIVA: stati, transizioni ed etichette stanno qui
// e non nei componenti, così valgono per ogni sezione che ne lavora una.
//
//   nuovo → in_gestione → vinto  (finale)
//                       → perso  (finale)
//
// La trattativa è della persona, non della singola richiesta: tutte le
// richieste Club/Family di quella persona confluiscono nella stessa, così due
// commerciali non chiamano lo stesso cliente e non ci sono due assegnazioni da
// tenere sincronizzate. La creazione la fa il database
// (trova_o_crea_opportunita, chiamata dal trigger su form_contatti).
//
// Nessun import server-only: usato sia dai Server Component sia dai client.

export const STATI = ['nuovo', 'in_gestione', 'vinto', 'perso'] as const
export type StatoTrattativa = (typeof STATI)[number]

// "Da prendere in carico" e non "Nuovo": dice cosa manca, non da quanto
// tempo esiste.
export const ETICHETTE_STATO: Record<StatoTrattativa, string> = {
  nuovo: 'Da prendere in carico',
  in_gestione: 'In gestione',
  vinto: 'Vinta',
  perso: 'Persa',
}

/**
 * Stati finali: la trattativa è chiusa e valorizza chiuso_il. "Finale" dice
 * com'è andata, non che sia scolpito — chi risponde al telefono può sempre
 * correggersi, quindi da vinta si torna in gestione o si passa a persa.
 */
export const STATI_FINALI: readonly StatoTrattativa[] = ['vinto', 'perso']

export function eChiusa(stato: StatoTrattativa): boolean {
  return (STATI_FINALI as readonly string[]).includes(stato)
}

export function eStatoValido(v: string | null | undefined): v is StatoTrattativa {
  return !!v && (STATI as readonly string[]).includes(v)
}

/** Il percorso "buono", quello che si mostra come avanzamento: persa è un'uscita laterale. */
export const PASSI_AVANZAMENTO: readonly StatoTrattativa[] = ['nuovo', 'in_gestione', 'vinto']

export const OPZIONI_STATO = STATI.map((s) => ({ valore: s, etichetta: ETICHETTE_STATO[s] }))

export type Trattativa = {
  id: string
  creato_il: string
  stato: StatoTrattativa
  assegnato_a: string | null
  assegnato_il: string | null
  chiuso_il: string | null
  motivo_perso: string | null
  note: string | null
  persona_id: string
  nome: string | null
  cognome: string | null
  email: string | null
  cellulare: string | null
  richieste: number
  ultima_richiesta: string | null
}

/**
 * Chi può cambiare l'assegnatario di questa trattativa.
 *
 * Tre casi, gli stessi del CRM del Tennis Club Ambrosiano:
 *  - libera (nessun assegnatario): la prende chi ha il diritto commerciale;
 *  - propria: chi la ha in mano può sempre passarla a un collega;
 *  - di un altro: solo chi ha il diritto di riassegnare.
 */
export function puoAssegnare({
  assegnatoA,
  io,
  sonoCommerciale,
  possoRiassegnare,
}: {
  assegnatoA: string | null
  io: string | null
  sonoCommerciale: boolean
  possoRiassegnare: boolean
}): boolean {
  if (possoRiassegnare) return true
  if (!assegnatoA) return sonoCommerciale
  return !!io && assegnatoA === io
}

// ─────────────────────────────────────────── come si riconosce uno stato
//
// In un pannello di lavoro lo stato va riconosciuto prima di essere letto:
// quattro righe identiche con quattro parole diverse obbligano a leggere ogni
// riga per capire quale chiede qualcosa. Da qui escono la banda di colore
// della riga e il pallino del badge, così la stessa trattativa ha lo stesso
// colore in dashboard, in elenco e dentro il suo blocco.

export const CLASSE_RIGA_STATO: Record<StatoTrattativa, string> = {
  nuovo: 'stato-nuovo',
  in_gestione: 'stato-gestione',
  vinto: 'stato-vinto',
  perso: 'stato-perso',
}

/** Il pallino del colore dello stato: sui chip dei filtri e nei conteggi. */
export const PUNTO_STATO: Record<StatoTrattativa, string> = {
  nuovo: 'punto-nuovo',
  in_gestione: 'punto-gestione',
  vinto: 'punto-vinto',
  perso: 'punto-perso',
}

/**
 * La classe del badge di stato. «In gestione» stava sull'oro dell'accento —
 * lo stesso colore dei pulsanti e dell'etichetta «Trattativa» accanto: il
 * badge si perdeva nel suo blocco. Ora ha il blu ardesia, e «Persa» il rosso
 * invece del grigio spento: una persa senza motivo registrato è una cosa da
 * sistemare, non un dettaglio da archiviare.
 */
export const CLASSE_BADGE_STATO: Record<StatoTrattativa, string> = {
  nuovo: 'badge-warn',
  in_gestione: 'badge-info',
  vinto: 'badge-ok',
  perso: 'badge-ko',
}

/**
 * Cosa chiede lo stato, in poche parole. L'etichetta dice *dov'è* la
 * trattativa; questa dice *cosa fare*, che è la domanda di chi apre la
 * pagina — e senza risposta ogni stato sembra ugualmente urgente.
 */
export const AZIONE_STATO: Record<StatoTrattativa, string> = {
  nuovo: 'nessuno la segue: prendila in carico',
  in_gestione: 'in corso: continua il seguito',
  vinto: 'chiusa: è diventata socio',
  perso: 'chiusa: non è andata',
}

/** Una trattativa senza titolare è lavoro disponibile, non lavoro di altri. */
export function eDaPrendere(t: { stato: StatoTrattativa; assegnato_a: string | null }): boolean {
  return !t.assegnato_a && !eChiusa(t.stato)
}
