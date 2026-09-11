// Il tempo che passa **mentre il club è aperto**.
//
// Serve a una misura sola, ed è la ragione per cui esiste: quanto ci si mette
// a prendere in carico una trattativa (vedi Core Manager). Sull'orologio quel
// numero non dice niente di nessuno — un lead arrivato venerdì alle 20:50 e
// preso sabato alle 8:05 risulta «11 ore», e sembra una dimenticanza quando
// invece è stata la prima cosa fatta all'apertura. Misurando solo le ore di
// apertura diventa «15 minuti», che è quello che è successo.
//
// Il club è aperto **tutti i giorni**, con due finestre diverse:
//
//   lunedì–venerdì            7:00 → 21:00   (14 ore)
//   sabato, domenica, festivi  8:00 → 19:00   (11 ore)
//
// Quindi non esistono giorni chiusi da saltare: cambia solo l'ampiezza della
// finestra. È per questo che un festivo infrasettimanale conta — sposta la
// giornata da 14 ore a 11 — mentre un festivo che cade di sabato o domenica
// non cambia nulla, e la funzione non ha bisogno di accorgersene.
//
// Nessun import server-only: lo usano sia i Server Component sia i componenti
// client.

import { giornoPiu } from './agenda'

const FUSO = 'Europe/Rome'

/** Apertura e chiusura, in ore locali. */
export const FINESTRA_SETTIMANA: readonly [number, number] = [7, 21]
export const FINESTRA_FESTIVA: readonly [number, number] = [8, 19]

/**
 * Quanti giorni al massimo si scorrono.
 *
 * Una presa in carico di due anni non deve far girare settecento iterazioni
 * per produrre un numero che a schermo dirà comunque «più di un mese». Oltre
 * il tetto la misura si tronca, ed è corretto così: la media di reattività si
 * legge sui minuti e sulle ore, e un valore fuori scala la rovinerebbe
 * qualunque cifra gli si desse.
 */
const MAX_GIORNI = 120

/**
 * Le feste civili italiane a data fissa. Il patrono di Torino — San Giovanni,
 * il 24 giugno — è incluso perché il club è a Torino e quel giorno tiene
 * l'orario festivo: se un anno non fosse così, va tolto da qui e non
 * corretto altrove.
 */
const FESTE_FISSE: readonly string[] = [
  '01-01', // Capodanno
  '01-06', // Epifania
  '04-25', // Liberazione
  '05-01', // Festa del lavoro
  '06-02', // Repubblica
  '06-24', // San Giovanni, patrono di Torino
  '08-15', // Assunzione
  '11-01', // Ognissanti
  '12-08', // Immacolata
  '12-25', // Natale
  '12-26', // Santo Stefano
]

/**
 * La domenica di Pasqua, con l'algoritmo di Meeus/Jones/Butcher.
 *
 * Serve solo per il **lunedì** successivo: la domenica ha già l'orario
 * festivo perché è domenica. Calcolata e non messa in tabella perché una
 * tabella di date scade, e scade in silenzio — l'anno dopo il conto è
 * sbagliato e nessuno se ne accorge.
 */
function pasqua(anno: number): string {
  const a = anno % 19
  const b = Math.floor(anno / 100)
  const c = anno % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mese = Math.floor((h + l - 7 * m + 114) / 31)
  const giorno = ((h + l - 7 * m + 114) % 31) + 1
  return `${anno}-${String(mese).padStart(2, '0')}-${String(giorno).padStart(2, '0')}`
}

/** Vero nei giorni con l'orario ridotto: sabato, domenica e festivi. */
export function eOrarioFestivo(giorno: string): boolean {
  // getUTCDay su una data costruita a mezzogiorno UTC: il giorno della
  // settimana di una data secca non dipende dal fuso, e passare da una data
  // locale rischierebbe di scivolare di un giorno.
  const settimana = new Date(`${giorno}T12:00:00Z`).getUTCDay()
  if (settimana === 0 || settimana === 6) return true

  if (FESTE_FISSE.includes(giorno.slice(5))) return true

  const anno = Number(giorno.slice(0, 4))
  return giorno === giornoPiu(pasqua(anno), 1) // Pasquetta
}

export function finestraDi(giorno: string): readonly [number, number] {
  return eOrarioFestivo(giorno) ? FINESTRA_FESTIVA : FINESTRA_SETTIMANA
}

/** Il giorno a Roma di un istante, in 'YYYY-MM-DD'. */
function giornoRoma(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
}

/**
 * Lo scarto dall'UTC a Roma in un certo giorno: '+01:00' o '+02:00'.
 *
 * Preso a mezzogiorno e usato anche per i confini delle 7 e delle 21: il
 * cambio d'ora in Italia avviene alle 2 di notte, quindi dentro la finestra
 * di apertura lo scarto è lo stesso di mezzogiorno in tutti i giorni
 * dell'anno — compresi i due del passaggio.
 */
function scartoRoma(giorno: string): string {
  const parti = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO,
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${giorno}T12:00:00Z`))
  const nome = parti.find((p) => p.type === 'timeZoneName')?.value
  const scarto = nome?.replace('GMT', '').trim()
  // 'GMT' secco vuol dire scarto zero, che a Roma non capita: se il browser
  // non sa dare l'offset si ripiega sull'ora solare invece di sbagliare di
  // un'ora in silenzio per mezzo anno.
  return scarto && /^[+-]\d{2}:\d{2}$/.test(scarto) ? scarto : '+01:00'
}

/** L'istante UTC in cui a Roma quel giorno segna quell'ora piena. */
function istante(giorno: string, ora: number): number {
  return Date.parse(`${giorno}T${String(ora).padStart(2, '0')}:00:00${scartoRoma(giorno)}`)
}

/**
 * I millisecondi di **apertura** fra due istanti.
 *
 * Zero è un risultato legittimo e non un errore: vuol dire che fra i due
 * momenti il club non è mai stato aperto — succede a chi prende in carico un
 * lead arrivato la notte prima che la giornata cominci.
 *
 * Null quando gli istanti non sono leggibili o sono invertiti: un tempo
 * negativo non si mostra come zero, perché zero significa «subito» e
 * nasconderebbe un dato sbagliato dentro una media.
 */
export function msLavorativi(
  daISO: string | null | undefined,
  aISO: string | null | undefined
): number | null {
  if (!daISO || !aISO) return null
  const inizio = Date.parse(daISO)
  const fine = Date.parse(aISO)
  if (!Number.isFinite(inizio) || !Number.isFinite(fine) || fine < inizio) return null

  let totale = 0
  let giorno = giornoRoma(inizio)
  const ultimo = giornoRoma(fine)

  for (let i = 0; i <= MAX_GIORNI && giorno <= ultimo; i += 1) {
    const [apre, chiude] = finestraDi(giorno)
    const da = Math.max(inizio, istante(giorno, apre))
    const a = Math.min(fine, istante(giorno, chiude))
    if (a > da) totale += a - da
    giorno = giornoPiu(giorno, 1)
  }

  return totale
}

/**
 * «45 min», «3 h 20 min», «2 giorni di apertura» — un tempo di apertura come
 * si legge.
 *
 * Sopra la giornata **non** si dice «2 giorni» e basta: un giorno di apertura
 * è 14 ore in settimana e 11 nel fine settimana, quindi «2 giorni» da solo
 * non è convertibile in niente. Si dicono le ore, che sono il dato vero, e si
 * aggiunge la lettura in giornate solo quando le ore diventano troppe per
 * essere immaginate.
 */
export function durataLavorativa(ms: number | null): string {
  if (ms === null) return '—'
  const minuti = Math.round(ms / 60000)
  if (minuti < 1) return 'subito'
  if (minuti < 60) return `${minuti} min`

  const ore = Math.floor(minuti / 60)
  const resto = minuti % 60
  if (ore < 14) return resto ? `${ore} h ${resto} min` : `${ore} h`

  // Oltre la giornata piena: le ore restano la misura, le giornate sono la
  // traduzione fra parentesi. 14 ore è la giornata lunga, ed è il divisore
  // che sottostima le giornate invece di gonfiarle.
  const giornate = Math.round((ore / 14) * 10) / 10
  return `${ore} h (≈ ${giornate.toString().replace('.', ',')} giornate)`
}
