// La sezione Accessi: gli ingressi al club letti dai varchi (tornelli,
// tripodi, sbarre, porte). Qui i tipi, il calcolo del periodo e le piccole
// funzioni di presentazione; le letture dal database stanno in
// lib/accessi-server.ts. Niente import server-only: li usano anche i
// componenti dei grafici.
//
// Un varco si riconosce dalla terna terminale + indirizzo + concentratore:
// `source_terminale_id` è solo il tipo di lettore (13 o 19) e da solo non
// basta. Un passaggio conta se l'esito è 3 (abbonamento), 100 (gold card) o
// 25 (apertura forzata); gli esiti negativi sono ingressi negati. Info4U non
// dice se un passaggio è un'entrata o un'uscita, quindi i numeri per varco
// sono passaggi, e quelli «per persona» sono giorni di presenza (un ingresso
// al giorno, vedi 2026-10-29-accessi-scheda.sql).

import { chiaveGiorno, giornoPiu, lunediDi, primoDelMese, stessoGiornoMesiFa } from '@/lib/agenda'
import { variazionePercentuale } from '@/lib/pipeline'

/** Il primo giorno per cui ci sono accessi. */
export const PRIMO_GIORNO_ACCESSI = '2023-01-01'

export const ESITI_PASSAGGIO = [3, 100, 25]

export const COLORE_SENZA_GRUPPO = '#9a948a'
export const ETICHETTA_SENZA_GRUPPO = 'Senza gruppo'
/** La chiave con cui «senza gruppo» compare nelle mappe per gruppo. */
export const CHIAVE_SENZA_GRUPPO = '-'

/** I colori fra cui scegliere per un gruppo: distinguibili anche a colpo d'occhio. */
export const COLORI_GRUPPO = [
  '#8b6c14',
  '#2f6f9f',
  '#3a8a5c',
  '#b5483a',
  '#7a5aa6',
  '#c7822a',
  '#2c8a8a',
  '#a14f7d',
] as const

// ─────────────────────────────────────────────────────────────── periodo

export const PRESET = [
  { chiave: '30g', etichetta: '30 giorni' },
  { chiave: '3m', etichetta: '3 mesi' },
  { chiave: '6m', etichetta: '6 mesi' },
  { chiave: '12m', etichetta: '12 mesi' },
  { chiave: 'anno', etichetta: "Quest'anno" },
] as const

export type PresetChiave = (typeof PRESET)[number]['chiave']
export type Passo = 'day' | 'week' | 'month'

export type Periodo = {
  /** Il preset scelto, o 'personalizzato' se le date sono state scritte a mano. */
  preset: PresetChiave | 'personalizzato'
  dal: string
  al: string
  giorni: number
  /** A che grana si disegna la tendenza: giorno, settimana o mese. */
  passo: Passo
  /** Il periodo di pari durata subito prima, per i confronti; null se non ci sono dati. */
  precedente: { dal: string; al: string } | null
}

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/

function dataValida(valore: string | undefined): valore is string {
  if (!valore || !FORMATO_DATA.test(valore)) return false
  const d = new Date(`${valore}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valore
}

export function giorniFra(dal: string, al: string): number {
  const ms = new Date(`${al}T12:00:00Z`).getTime() - new Date(`${dal}T12:00:00Z`).getTime()
  return Math.round(ms / 86400000) + 1
}

function passoPer(giorni: number): Passo {
  if (giorni <= 62) return 'day'
  if (giorni <= 190) return 'week'
  return 'month'
}

function dalDelPreset(preset: PresetChiave, oggi: string): string {
  switch (preset) {
    case '30g':
      return giornoPiu(oggi, -29)
    case '3m':
      return giornoPiu(stessoGiornoMesiFa(oggi, -3), 1)
    case '6m':
      return giornoPiu(stessoGiornoMesiFa(oggi, -6), 1)
    case '12m':
      return giornoPiu(stessoGiornoMesiFa(oggi, -12), 1)
    case 'anno':
      return `${oggi.slice(0, 4)}-01-01`
  }
}

/**
 * Il periodo scelto dall'URL: `periodo=` per i preset, `dal=` e `al=` per
 * date libere. Senza niente, gli ultimi 12 mesi. Le date si riportano dentro
 * i confini (non oltre oggi, non prima del primo accesso) invece di dare
 * errore: un link con una data fuori range apre comunque una pagina utile.
 */
export function periodoDa(
  parametri: { periodo?: string; dal?: string; al?: string },
  oggi: string,
  predefinito: PresetChiave = '12m'
): Periodo {
  let preset: Periodo['preset']
  let dal: string
  let al: string
  const presetNoto = PRESET.find((p) => p.chiave === parametri.periodo)?.chiave
  if (dataValida(parametri.dal) && dataValida(parametri.al) && !presetNoto) {
    preset = 'personalizzato'
    dal = parametri.dal
    al = parametri.al
    if (dal > al) [dal, al] = [al, dal]
    if (al > oggi) al = oggi
    if (dal < PRIMO_GIORNO_ACCESSI) dal = PRIMO_GIORNO_ACCESSI
    if (dal > al) dal = al
  } else {
    preset = presetNoto ?? predefinito
    al = oggi
    dal = dalDelPreset(preset, oggi)
    if (dal < PRIMO_GIORNO_ACCESSI) dal = PRIMO_GIORNO_ACCESSI
  }
  const giorni = giorniFra(dal, al)
  const alPrec = giornoPiu(dal, -1)
  const dalPrec = giornoPiu(alPrec, -(giorni - 1))
  return {
    preset,
    dal,
    al,
    giorni,
    passo: passoPer(giorni),
    precedente: alPrec >= PRIMO_GIORNO_ACCESSI ? { dal: dalPrec < PRIMO_GIORNO_ACCESSI ? PRIMO_GIORNO_ACCESSI : dalPrec, al: alPrec } : null,
  }
}

/** Le chiavi di tutti i periodi (giorni, lunedì o primi del mese) che il passo disegna fra due date. */
export function chiaviPeriodi(dal: string, al: string, passo: Passo): string[] {
  const chiavi: string[] = []
  const inizio = passo === 'day' ? dal : passo === 'week' ? lunediDi(dal) : primoDelMese(dal)
  let corrente = inizio
  while (corrente <= al) {
    chiavi.push(corrente)
    if (passo === 'day') corrente = giornoPiu(corrente, 1)
    else if (passo === 'week') corrente = giornoPiu(corrente, 7)
    else {
      const [anno, mese] = corrente.split('-').map(Number)
      corrente = chiaveGiorno(mese === 12 ? anno + 1 : anno, mese % 12, 1)
    }
  }
  return chiavi
}

export function etichettaPeriodo(chiave: string, passo: Passo, lunga = false): string {
  const d = new Date(`${chiave}T12:00:00Z`)
  if (passo === 'month') {
    return d.toLocaleDateString('it-IT', {
      timeZone: 'UTC',
      month: lunga ? 'long' : 'short',
      year: lunga ? 'numeric' : '2-digit',
    })
  }
  const base = d.toLocaleDateString('it-IT', { timeZone: 'UTC', day: 'numeric', month: 'short' })
  return passo === 'week' && lunga ? `settimana dal ${base}` : base
}

export function etichettaIntervallo(dal: string, al: string): string {
  const f = (g: string) =>
    new Date(`${g}T12:00:00Z`).toLocaleDateString('it-IT', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
  return dal === al ? f(dal) : `${f(dal)} – ${f(al)}`
}

// ───────────────────────────────────────────────────────────────── dati

export type Riepilogo = {
  passaggi: number
  negati: number
  giorniAperti: number
  persone: number
  visite: number
}

export const RIEPILOGO_VUOTO: Riepilogo = { passaggi: 0, negati: 0, giorniAperti: 0, persone: 0, visite: 0 }

export type Gruppo = { id: string; nome: string; colore: string; ordine: number }

export type Varco = {
  /** `terminale-indirizzo-concentratore`, la chiave che si porta negli URL. */
  chiave: string
  terminale: number
  indirizzo: number
  concentratore: number
  descrizione: string
  gruppoId: string | null
  attivo: boolean
}

export function chiaveVarco(terminale: number, indirizzo: number, concentratore: number): string {
  return `${terminale}-${indirizzo}-${concentratore}`
}

export function leggiChiaveVarco(chiave: string | undefined): { terminale: number; indirizzo: number; concentratore: number } | null {
  const m = /^(\d+)-(\d+)-(\d+)$/.exec(chiave ?? '')
  return m ? { terminale: Number(m[1]), indirizzo: Number(m[2]), concentratore: Number(m[3]) } : null
}

export type RigaVarco = Varco & { passaggi: number; negati: number }

export type PuntoSerie = {
  periodo: string
  totale: number
  /** Passaggi per gruppo (CHIAVE_SENZA_GRUPPO per i varchi senza gruppo). */
  perGruppo: Record<string, number>
}

export type PuntoVisite = { periodo: string; visite: number; persone: number }

export type CellaCalore = { giornoSettimana: number; ora: number; passaggi: number; giorni: number }

export type RigaNegati = { tipo: number; descrizione: string; n: number }

export type FasciaFedelta = { fascia: string; ordine: number; persone: number }

export type SocioInattivo = {
  personaId: string
  nome: string | null
  cognome: string | null
  abbonamento: string | null
  dataFine: string | null
  ultimoIngresso: string
  giorniAssenza: number
}

// ─────────────────────────────────────────────────────── presentazione

export const GIORNI_SETTIMANA = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'] as const

/** Le ore che la mappa di calore mostra: fuori da queste i passaggi sono una manciata. */
export const ORE_MAPPA = Array.from({ length: 17 }, (_, i) => i + 6)

// it-IT da solo non mette il punto sulle migliaia a quattro cifre («6711»):
// 'always' lo mette sempre, così 6.711 e 41.000 si leggono allo stesso modo.
const FORMATO_NUMERO = new Intl.NumberFormat('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)

export function numero(n: number): string {
  return FORMATO_NUMERO.format(n)
}

/** «+12%», «−4%», o «—» quando il periodo prima era vuoto. */
export function testoDelta(attuale: number, precedente: number | null): string {
  if (precedente === null) return '—'
  const p = variazionePercentuale(attuale, precedente)
  if (p === null) return '—'
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%`
}

export function direzioneDelta(attuale: number, precedente: number | null): 'su' | 'giu' | 'piano' {
  if (precedente === null) return 'piano'
  const p = variazionePercentuale(attuale, precedente)
  if (p === null || p === 0) return 'piano'
  return p > 0 ? 'su' : 'giu'
}

export function oraTesto(ora: number): string {
  return `${String(ora).padStart(2, '0')}:00`
}
