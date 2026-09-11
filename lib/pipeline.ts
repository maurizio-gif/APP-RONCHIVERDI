// Ciclo di vita di una TRATTATIVA: stati, transizioni ed etichette stanno qui
// e non nei componenti, così valgono per ogni sezione che ne lavora una.
//
//   nuovo → in_gestione → vinto      (finale)
//                       → perso      (finale)
//   (da qualsiasi stato) → annullato  (finale, ma non è un esito)
//
// La trattativa è della persona, non della singola richiesta: tutte le
// richieste Club/Family di quella persona confluiscono nella stessa, così due
// commerciali non chiamano lo stesso cliente e non ci sono due assegnazioni da
// tenere sincronizzate. La creazione la fa il database
// (trova_o_crea_opportunita, chiamata dal trigger su form_contatti).
//
// Nessun import server-only: usato sia dai Server Component sia dai client.

export const STATI = ['nuovo', 'in_gestione', 'vinto', 'perso', 'annullato'] as const
export type StatoTrattativa = (typeof STATI)[number]

// "Da prendere in carico" e non "Nuovo": dice cosa manca, non da quanto
// tempo esiste.
export const ETICHETTE_STATO: Record<StatoTrattativa, string> = {
  nuovo: 'Da prendere in carico',
  in_gestione: 'In gestione',
  vinto: 'Vinta',
  perso: 'Persa',
  annullato: 'Annullata',
}

/**
 * Stati finali: la trattativa è chiusa e valorizza chiuso_il. "Finale" dice
 * com'è andata, non che sia scolpito — chi risponde al telefono può sempre
 * correggersi, quindi da vinta si torna in gestione o si passa a persa.
 */
export const STATI_FINALI: readonly StatoTrattativa[] = ['vinto', 'perso', 'annullato']

export function eChiusa(stato: StatoTrattativa): boolean {
  return (STATI_FINALI as readonly string[]).includes(stato)
}

/**
 * Gli stati che sono un **esito**: ci abbiamo provato, ed è finita così.
 *
 * `annullato` è finale ma non è qui, ed è tutta la differenza. Una
 * trattativa può nascere per sbaglio: un doppione, una riga finita sulla
 * persona sbagliata, una prova rimasta in giro.
 *
 * Da non confondere con le trattative che nascono da sole ed è giusto che
 * nascano — l'interesse per Club o Family spuntato al banco, l'evento messo
 * in agenda da un commerciale. Quelle sono volute: si lavorano, non si
 * annullano.
 *
 * Chiudere uno sbaglio come «persa» costava tre bugie: una sconfitta nei
 * conti di chi la teneva, un `motivo_perso` da inventare, e nella scheda
 * della persona la traccia che con lei era andata male. «Annullata» dice
 * l'unica cosa vera: questa riga non andava creata.
 *
 * Chi conta vinte e perse deve escludere le annullate, o rimette in
 * classifica proprio quello che si è tolto.
 */
export const STATI_ESITO: readonly StatoTrattativa[] = ['vinto', 'perso']

export function eEsito(stato: StatoTrattativa): boolean {
  return (STATI_ESITO as readonly string[]).includes(stato)
}

/**
 * Una trattativa annullata non è mai esistita: si nasconde dove si guarda il
 * lavoro (elenchi e conteggi) e si ritrova solo chiedendola col filtro.
 */
export function eAnnullata(stato: StatoTrattativa): boolean {
  return stato === 'annullato'
}

export function eStatoValido(v: string | null | undefined): v is StatoTrattativa {
  return !!v && (STATI as readonly string[]).includes(v)
}

/**
 * Gli stati che **chiudono** una trattativa e che quindi pretendono una nota.
 *
 * Tutte e tre, e non più le sole persa e annullata. L'unico esito che
 * produce fatturato era anche il solo a non lasciare traccia di cosa fosse:
 * «Vinta» da sola non dice che abbonamento è stato fatto né quanto vale, e a
 * sei mesi di distanza nessuno ricollega una riga di pipeline a una vendita.
 *
 * La nota finisce in tre colonne diverse perché sono tre domande diverse, e
 * tenerle separate è ciò che permette di rileggere i motivi di perdita senza
 * doverci prima filtrare via gli sbagli e le vendite.
 */
export const COLONNA_MOTIVO: Partial<Record<StatoTrattativa, string>> = {
  vinto: 'motivo_vinto',
  perso: 'motivo_perso',
  annullato: 'motivo_annullato',
}

export function chiedeMotivo(stato: StatoTrattativa): boolean {
  return stato in COLONNA_MOTIVO
}

/** Cosa si chiede di scrivere, stato per stato: la domanda giusta al momento giusto. */
export const DOMANDA_MOTIVO: Partial<Record<StatoTrattativa, string>> = {
  vinto: 'Quale abbonamento? Es. «Club Full annuale»',
  perso: 'Perché non si iscrive?',
  annullato: 'Perché non è una trattativa? Doppione, errore al banco, prova…',
}

/**
 * Lo stato che chiede anche **quanto vale il contratto**, in un campo suo.
 *
 * Solo la vinta: è l'unica chiusura che produce fatturato. E un campo
 * numerico e non un numero dentro la nota, perché è la differenza fra un
 * dato leggibile da una persona e un dato che si somma — «Club Full annuale,
 * 1.080 €» è opaco a una query, e estrarlo a posteriori con un'espressione
 * regolare dà il numero sbagliato in una quota dei casi (chi scrive «1.080»,
 * chi «1080,00», chi «€1080 rateizzato») senza che si sappia quale. Sul
 * fatturato è il tipo di errore peggiore: invisibile.
 */
export function chiedeValore(stato: StatoTrattativa): boolean {
  return stato === 'vinto'
}

/** Il tetto del campo: `numeric(10,2)` sul database (vedi la migration). */
export const VALORE_MASSIMO_EURO = 99_999_999.99

/**
 * Il valore scritto dall'operatore, normalizzato.
 *
 * Accetta la virgola come separatore decimale, che è come si scrivono i
 * numeri in italiano: un campo che rifiuta «1080,50» è un campo che si
 * compila sbagliato. I separatori di migliaia invece non si indovinano —
 * «1.080» in Italia è milleottanta, in un `Number()` è 1,08 — quindi il
 * punto si accetta solo come decimale, e chi scrive i punti delle migliaia
 * riceve un errore invece di un valore mille volte più piccolo.
 */
export function valoreDaTesto(testo: string): number | null {
  const pulito = testo.trim().replace(/[€\s]/g, '')
  if (!pulito) return null
  // Una virgola o un punto, e al massimo uno: tutto il resto è ambiguo.
  if (!/^\d+([.,]\d{1,2})?$/.test(pulito)) return null
  const n = Number(pulito.replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0 || n > VALORE_MASSIMO_EURO) return null
  return Math.round(n * 100) / 100
}

/** «1.080,00 €» — il valore come si legge, non come si salva. */
export function euro(valore: number | null | undefined): string | null {
  if (valore === null || valore === undefined || !Number.isFinite(Number(valore))) return null
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(valore))
}

/** Il verbo del pulsante che conferma la chiusura. */
export const CONFERMA_MOTIVO: Partial<Record<StatoTrattativa, string>> = {
  vinto: 'Segna vinta',
  perso: 'Segna persa',
  annullato: 'Annulla la trattativa',
}

/** La nota già scritta su una trattativa chiusa, qualunque sia lo stato. */
export function motivoDi(t: {
  stato: StatoTrattativa
  motivo_vinto?: string | null
  motivo_perso?: string | null
  motivo_annullato?: string | null
}): string | null {
  if (t.stato === 'vinto') return t.motivo_vinto ?? null
  if (t.stato === 'perso') return t.motivo_perso ?? null
  if (t.stato === 'annullato') return t.motivo_annullato ?? null
  return null
}

/** Il percorso "buono", quello che si mostra come avanzamento: persa è un'uscita laterale. */
export const PASSI_AVANZAMENTO: readonly StatoTrattativa[] = ['nuovo', 'in_gestione', 'vinto']

/**
 * Gli stati che compongono la **fotografia**: le righe «Nel club: 3 da
 * prendere in carico, 5 in gestione…» in dashboard e in cima a un canale.
 *
 * `annullato` non c'è, e non è una dimenticanza. Quella riga serve a una
 * domanda sola — quanto lavoro c'è e com'è andata — e le annullate non sono
 * né lavoro né risultato: «0 annullate» accanto agli altri numeri è una
 * colonna che non si guarda mai, e «7 annullate» sembra un dato quando è solo
 * il conto degli errori di inserimento.
 *
 * Restano invece fra i **filtri**, che usano STATI per intero: lì la domanda
 * è «fammele vedere», e una riga che non si può ritrovare è una riga persa.
 */
export const STATI_IN_SINTESI: readonly StatoTrattativa[] = [
  'nuovo',
  'in_gestione',
  'vinto',
  'perso',
]

export const OPZIONI_STATO = STATI.map((s) => ({ valore: s, etichetta: ETICHETTE_STATO[s] }))

export type Trattativa = {
  id: string
  creato_il: string
  stato: StatoTrattativa
  assegnato_a: string | null
  assegnato_il: string | null
  chiuso_il: string | null
  motivo_perso: string | null
  /** Quale abbonamento è stato venduto. */
  motivo_vinto?: string | null
  /** Quanto vale il contratto, in euro. Solo sulle vinte. */
  valore_euro?: number | null
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

/**
 * Chi può **annullare** una trattativa: qualsiasi commerciale, anche su una
 * che segue un collega.
 *
 * È più largo di puoAssegnare di proposito, ed è l'unico stato che sfugge a
 * quella regola. Gli altri passaggi sono giudizi sul lavoro di qualcuno —
 * dire che la trattativa di un collega è persa vuol dire archiviare la sua
 * telefonata — e restano di chi la ha in mano. Annullare invece dice che
 * quella riga non è mai stata una trattativa: è una correzione dei dati, e
 * chi si accorge di un doppione deve poterlo togliere quando lo vede, non
 * scrivere a chi ce l'ha in carico e aspettare.
 *
 * Il prezzo è che si può togliere dalla pipeline il lavoro di un altro, e per
 * questo la motivazione è obbligatoria (vedi cambiaStato): l'annullamento si
 * disfa rimettendo la trattativa In gestione, resta nel registro operatori
 * con chi l'ha fatto, e il perché è scritto accanto allo stato.
 */
export function puoAnnullare(diritti: {
  assegnatoA: string | null
  io: string | null
  sonoCommerciale: boolean
  possoRiassegnare: boolean
}): boolean {
  return diritti.sonoCommerciale || puoAssegnare(diritti)
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
  annullato: 'stato-annullato',
}

/** Il pallino del colore dello stato: sui chip dei filtri e nei conteggi. */
export const PUNTO_STATO: Record<StatoTrattativa, string> = {
  nuovo: 'punto-nuovo',
  in_gestione: 'punto-gestione',
  vinto: 'punto-vinto',
  perso: 'punto-perso',
  annullato: 'punto-annullato',
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
  // Grigio spento, non rosso: una annullata non è un problema da sistemare,
  // è una riga tolta di mezzo. Il rosso di «Persa» chiama l'occhio perché
  // una perdita senza motivo va guardata; questa no.
  annullato: 'badge-off',
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
  annullato: 'annullata: non andava creata, non conta nei risultati',
}

/** Una trattativa senza titolare è lavoro disponibile, non lavoro di altri. */
export function eDaPrendere(t: { stato: StatoTrattativa; assegnato_a: string | null }): boolean {
  return !t.assegnato_a && !eChiusa(t.stato)
}
