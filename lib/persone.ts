// Anagrafica deduplicata: la stessa persona compila più form nel tempo e qui
// ha una riga sola. La deduplicazione la fa il database
// (trova_o_crea_persona, chiamata dal trigger su form_contatti e dal form
// dell'agenda quando la segreteria crea un contatto a mano): questo file
// contiene solo ciò che serve a mostrarla, a cercarla e a chiederne una
// nuova.
//
// Nessun import server-only: usato sia dai Server Component sia dai client.

export type Persona = {
  id: string
  nome: string | null
  cognome: string | null
  email: string | null
  cellulare: string | null
  note: string | null
  /**
   * Da dove viene la riga, quando si sa: la vista dell'elenco non la porta,
   * e la pagina la carica a parte solo per i contatti inseriti a mano (vedi
   * FONTE_MANUALE).
   */
  fonte?: string | null
  richieste: number
  richieste_da_lavorare: number
  prima_richiesta: string | null
  ultima_richiesta: string | null
}

/**
 * Le fonti di una riga d'anagrafica, cioè il modo in cui quella persona è
 * finita qui dentro. È il parametro `p_fonte` di trova_o_crea_persona, che è
 * l'unica porta d'ingresso dell'anagrafica.
 *
 *  - `form_contatti` — ha scritto dal sito, ed è il caso normale: la riga
 *    nasce dal trigger sulla richiesta;
 *  - `migrazione` — importata da un elenco preesistente. Nasce `storico`:
 *    sta qui per riconoscerla se scrive, ma non ha chiesto niente;
 *  - `inserimento_manuale` — l'ha scritta la segreteria, a mano, perché
 *    serviva subito: al telefono o al banco arriva qualcuno che non ha mai
 *    compilato un form, e gli si fissa un appuntamento in agenda.
 *
 * La fonte si scrive una volta, alla creazione: `trova_o_crea_persona` la
 * completa solo se manca (coalesce) e mai la sovrascrive. Chi è nato da una
 * richiesta dal sito non diventa «inserito a mano» perché la segreteria lo
 * ha ritrovato scrivendone l'email nel form dell'agenda.
 */
export const FONTE_FORM = 'form_contatti'
export const FONTE_MIGRAZIONE = 'migrazione'
export const FONTE_MANUALE = 'inserimento_manuale'

/**
 * Vero per i contatti creati a mano dalla segreteria. È il segno che va
 * mostrato accanto al nome: un contatto con zero richieste, in un'anagrafica
 * che si popola dalle richieste del sito, altrimenti si legge come un errore
 * — e invece è qualcuno che è arrivato per telefono o di persona.
 */
export function eInseritoAMano(fonte: string | null | undefined): boolean {
  return fonte === FONTE_MANUALE
}

/** L'etichetta della targhetta accanto al nome. Una sola, e sempre la stessa. */
export const ETICHETTA_MANUALE = 'Inserito a mano'

/**
 * Nome e cognome quando ci sono, altrimenti l'email o il cellulare: una
 * persona senza nome esiste — un form compilato in fretta — e deve restare
 * riconoscibile in elenco.
 */
export function nomePersona(p: {
  nome?: string | null
  cognome?: string | null
  email?: string | null
  cellulare?: string | null
}): string {
  const nome = `${p.nome ?? ''} ${p.cognome ?? ''}`.trim()
  return nome || p.email || p.cellulare || 'Senza nome'
}

/** Iniziali per il pallino in elenco. */
export function inizialiPersona(p: { nome?: string | null; cognome?: string | null; email?: string | null }): string {
  const n = (p.nome ?? '').trim()
  const c = (p.cognome ?? '').trim()
  if (n || c) return ((n[0] ?? '') + (c[0] ?? '')).toUpperCase()
  return (p.email ?? '?').slice(0, 2).toUpperCase()
}

/**
 * Testo su cui cerca l'elenco: nome, cognome, "nome cognome" insieme —
 * altrimenti cercando "mario rossi" non si troverebbe una riga con il nome e
 * il cognome in due campi separati — email e cellulare, tutto in minuscolo.
 */
export function testoRicerca(p: {
  nome?: string | null
  cognome?: string | null
  email?: string | null
  cellulare?: string | null
}): string {
  const pulito = (v: string | null | undefined) => (v ?? '').trim()
  const n = pulito(p.nome)
  const c = pulito(p.cognome)
  return [n, c, n && c ? `${n} ${c}` : '', pulito(p.email), pulito(p.cellulare)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

// ───────────────────────────────────────────────── un contatto nuovo a mano

/** I campi che la segreteria scrive per creare un contatto sul momento. */
export type NuovoContatto = {
  nome?: string | null
  cognome?: string | null
  email?: string | null
  cellulare?: string | null
}

/** Un contatto nuovo con i campi puliti, pronto per l'anagrafica. */
export type ContattoDaCreare = {
  nome: string
  cognome: string | null
  email: string | null
  cellulare: string | null
}

/**
 * Cosa serve per creare un contatto a mano, e perché.
 *
 * **Solo il nome.** Un contatto senza nome, creato a mano, è indistinguibile
 * dal prossimo: in elenco resterebbe «Senza nome» accanto agli altri «Senza
 * nome». Chi ha davanti la persona, o ce l'ha al telefono, il nome lo sa.
 *
 * **I recapiti sono facoltativi, tutti e due.** Email e cellulare sono le
 * chiavi con cui il database riconosce la persona (vedi
 * trova_o_crea_persona), e averne almeno una è meglio — ma pretenderla
 * significherebbe non poter fissare niente a chi si presenta al banco senza
 * lasciare un numero, che è la ragione per cui questo form esiste. Chi non
 * ne ha nessuna entra comunque, e si accetta il rischio che ne dice il nome:
 * la sua riga non si può deduplicare, quindi se un domani quella persona
 * scrive dal sito nasce un secondo contatto, e i due si uniscono a mano.
 *
 * Per questo la targhetta «Inserito a mano» conta: è da lì che si riconoscono
 * le righe da ricontrollare.
 *
 * La stessa funzione la usano il form e la Server Action: il form la chiama
 * prima di partire, il server prima di scrivere, e le due risposte non
 * possono divergere.
 */
export function validaNuovoContatto(
  c: NuovoContatto
): { contatto: ContattoDaCreare } | { errore: string } {
  const pulito = (v: string | null | undefined) => (v ?? '').trim()
  const nome = pulito(c.nome)
  const cognome = pulito(c.cognome)
  const email = pulito(c.email).toLowerCase()
  const cellulare = pulito(c.cellulare)

  if (!nome) return { errore: 'Per creare un contatto serve almeno il nome.' }
  // Nessuna validazione fine dell'email: qui il rischio non è un indirizzo
  // storto — quello si corregge — ma una riga che non si riesce a
  // riconoscere. Una chiocciola basta a distinguere un indirizzo da un nome
  // scritto nel campo sbagliato.
  if (email && !email.includes('@')) {
    return { errore: 'L’email non sembra un indirizzo: manca la chiocciola.' }
  }

  return {
    contatto: {
      nome,
      cognome: cognome || null,
      email: email || null,
      cellulare: cellulare || null,
    },
  }
}

/**
 * Vero se questo contatto non porta nessuna delle due chiavi di
 * deduplicazione: il database non potrà riconoscerlo, e la sua riga va
 * scritta sapendolo (vedi creaContattoAMano).
 */
export function senzaRecapiti(c: ContattoDaCreare): boolean {
  return !c.email && !c.cellulare
}

export function dataBreve(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function dataOra(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
