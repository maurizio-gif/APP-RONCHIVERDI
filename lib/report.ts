// Il report per periodo (da data A a data B), a schermo e in PDF: i tipi dei
// dati, le sezioni fra cui scegliere e il calcolo del periodo. Niente
// import server-only: li usa anche il costruttore del PDF. Le letture dal
// database stanno in lib/report-server.ts.
//
// Ogni sezione riusa la fonte della pagina da cui nasce, così il report non
// dà mai un numero diverso da quello che si vede altrove:
//   lead         statistiche_richieste        (Dashboard direzionale)
//   iscritti     abbonamenti_giornalieri_tipo (Abbonamenti)
//   soci         abbonamenti_attivi_al        (Dashboard direzionale)
//   scaduti      abbonamenti_scadenze         (Abbonamenti › Scadenze)
//   incassi      incassato_giornaliero        (Incassato)
//   accessi      accessi_ore, accessi_giorni  (Accessi)

import { mesePiu, primoDelMese, stessoGiornoMesiFa, ultimoDelMese } from '@/lib/agenda'
import { PRIMO_GIORNO_ACCESSI, giorniFra, periodoDa, type Periodo } from '@/lib/accessi'
import type { SezioneChiave } from '@/lib/auth/sezioni'

// ────────────────────────────────────────────────────────────── sezioni

export const SEZIONI_REPORT = [
  {
    chiave: 'lead',
    etichetta: 'Lead',
    nota: 'Richieste ricevute, da dove arrivano, cosa chiedono e come sono andate le trattative.',
    richiede: 'direzione',
  },
  {
    chiave: 'iscritti',
    etichetta: 'Iscritti',
    nota: 'Nuove iscrizioni e rinnovi venduti, per gruppo di prodotti.',
    richiede: 'abbonamenti',
  },
  {
    chiave: 'soci',
    etichetta: 'Numero soci',
    nota: 'Abbonamenti in corso a inizio e a fine periodo, per gruppo.',
    richiede: 'abbonamenti',
  },
  {
    chiave: 'scaduti',
    etichetta: 'Scaduti',
    nota: 'Abbonamenti scaduti nel periodo, rinnovati e non, con il tasso di rinnovo.',
    richiede: 'abbonamenti',
  },
  {
    chiave: 'incassi',
    etichetta: 'Incassi',
    nota: 'Incassato netto per tipo di servizio, metodo di pagamento e mese.',
    richiede: 'incassato',
  },
  {
    chiave: 'accessi',
    etichetta: 'Accessi',
    nota: 'Ingressi al club: visite, persone, passaggi per gruppo di varchi e per varco.',
    richiede: 'accessi',
  },
] as const satisfies readonly { chiave: string; etichetta: string; nota: string; richiede: SezioneChiave }[]

export type SezioneReport = (typeof SEZIONI_REPORT)[number]['chiave']

export const CHIAVI_SEZIONI_REPORT: readonly SezioneReport[] = SEZIONI_REPORT.map((s) => s.chiave)

export function eSezioneReport(valore: string): valore is SezioneReport {
  return (CHIAVI_SEZIONI_REPORT as readonly string[]).includes(valore)
}

/**
 * Le sezioni scelte nell'URL: `sezioni=lead,incassi` (i link) oppure la stessa
 * chiave ripetuta (le caselle del modulo). Senza scelta, tutte — salvo che il
 * modulo sia stato inviato (`inviato`): allora nessuna casella spuntata vuol
 * dire nessuna sezione, non «tutte».
 */
export function sezioniDaParametro(valore: string | string[] | undefined, inviato = false): SezioneReport[] {
  if (valore === undefined) return inviato ? [] : [...CHIAVI_SEZIONI_REPORT]
  const scelte = (Array.isArray(valore) ? valore : [valore]).flatMap((v) => v.split(',')).filter(eSezioneReport)
  return CHIAVI_SEZIONI_REPORT.filter((c) => scelte.includes(c))
}

// ───────────────────────────────────────────────────────────────── periodo

export const PRESET_REPORT = [
  { chiave: 'mese', etichetta: 'Mese in corso' },
  { chiave: 'mese-scorso', etichetta: 'Mese scorso' },
  { chiave: '3m', etichetta: '3 mesi' },
  { chiave: '6m', etichetta: '6 mesi' },
  { chiave: '12m', etichetta: '12 mesi' },
  { chiave: 'anno', etichetta: "Quest'anno" },
] as const

/**
 * Il periodo del report dall'URL: un preset, o `dal` e `al`. Come in
 * lib/accessi.ts, ma con «mese in corso» e «mese scorso», che per un report
 * sono i più usati; per questi due il confronto è col mese prima (stessi
 * giorni), per gli altri col periodo di pari durata subito precedente.
 */
export function periodoReport(parametri: { periodo?: string; dal?: string; al?: string }, oggi: string): Periodo {
  const mese = parametri.periodo === 'mese'
  const meseScorso = parametri.periodo === 'mese-scorso'
  if (!mese && !meseScorso) return periodoDa(parametri, oggi, '12m')

  const primoMeseCorrente = primoDelMese(oggi)
  const dal = mese ? primoMeseCorrente : mesePiu(primoMeseCorrente, -1)
  const al = mese ? oggi : ultimoDelMese(dal)
  const dalPrec = mesePiu(dal, -1)
  const alPrec = mese ? stessoGiornoMesiFa(oggi, -1) : ultimoDelMese(dalPrec)
  const giorni = giorniFra(dal, al)
  return {
    preset: parametri.periodo as Periodo['preset'],
    dal: dal < PRIMO_GIORNO_ACCESSI ? PRIMO_GIORNO_ACCESSI : dal,
    al,
    giorni,
    passo: giorni <= 62 ? 'day' : 'month',
    precedente: alPrec >= PRIMO_GIORNO_ACCESSI ? { dal: dalPrec < PRIMO_GIORNO_ACCESSI ? PRIMO_GIORNO_ACCESSI : dalPrec, al: alPrec } : null,
  }
}

/** Il periodo da usare quando l'URL non dice niente: il mese in corso. */
export function periodoPredefinito(parametri: { periodo?: string; dal?: string; al?: string }, oggi: string): Periodo {
  const haDate = !!parametri.dal && !!parametri.al
  return periodoReport(haDate || parametri.periodo ? parametri : { periodo: 'mese' }, oggi)
}

// ─────────────────────────────────────────────────────────────────── dati

/** Un numero del periodo e, se c'è, lo stesso nel periodo precedente. */
export type Confronto = { attuale: number; precedente: number | null }

export type VoceReport = { etichetta: string; valore: number }

export type ReportLead = {
  richieste: Confronto
  lavorate: number
  conAppuntamento: number
  personeNuove: number
  trattative: { aperte: number; vinte: number; perse: number }
  perProvenienza: VoceReport[]
  perCanale: VoceReport[]
  perInteresse: VoceReport[]
  /** Dal giorno in cui il CRM raccoglie le richieste: prima non ci sono dati. */
  datiDal: string | null
}

export type RigaGruppoReport = { gruppo: string; valori: number[] }

export type ReportIscritti = {
  nuove: Confronto
  rinnovi: Confronto
  fatturatoNuove: Confronto
  fatturatoRinnovi: Confronto
  /** gruppo, nuove, rinnovi, fatturato */
  perGruppo: { gruppo: string; nuove: number; rinnovi: number; fatturato: number }[]
  perMese: { mese: string; nuove: number; rinnovi: number }[]
}

export type ReportSoci = {
  inizio: { data: string; totale: number }
  fine: { data: string; totale: number }
  /** gruppo, a inizio periodo, a fine periodo */
  perGruppo: { gruppo: string; inizio: number; fine: number }[]
}

export type ReportScaduti = {
  scaduti: Confronto
  rinnovati: Confronto
  /** Rinnovati su scaduti, in percentuale. */
  tasso: Confronto
  valoreNonRinnovato: Confronto
  perGruppo: { gruppo: string; scaduti: number; rinnovati: number }[]
  perMese: { mese: string; scaduti: number; rinnovati: number }[]
}

export type ReportIncassi = {
  netto: Confronto
  entrate: Confronto
  uscite: Confronto
  /** L'incassato netto dei soli abbonamenti (tipo di servizio «A»). */
  abbonamenti: Confronto
  perTipo: { tipo: string; movimenti: number; netto: number }[]
  perMetodo: { metodo: string; movimenti: number; netto: number }[]
  perMese: { mese: string; netto: number }[]
}

export type ReportAccessi = {
  visite: Confronto
  persone: Confronto
  passaggi: Confronto
  negati: Confronto
  perGruppo: { gruppo: string; passaggi: number }[]
  perVarco: { varco: string; gruppo: string | null; passaggi: number }[]
  perPeriodo: { periodo: string; visite: number }[]
  passo: 'day' | 'week' | 'month'
  oraDiPunta: { giorno: string; ora: number; media: number } | null
}

export type ReportDati = {
  periodo: { dal: string; al: string; giorni: number; precedente: { dal: string; al: string } | null }
  generato: { il: string; da: string | null }
  sezioni: SezioneReport[]
  /** Le sezioni scelte che l'utente non può vedere con i suoi permessi. */
  nonConsentite: SezioneReport[]
  lead?: ReportLead
  iscritti?: ReportIscritti
  soci?: ReportSoci
  scaduti?: ReportScaduti
  incassi?: ReportIncassi
  accessi?: ReportAccessi
}

// ───────────────────────────────────────────────────────────── formati

const FORMATO_NUMERO = new Intl.NumberFormat('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)
const FORMATO_EURO = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' } as Intl.NumberFormatOptions)
const FORMATO_EURO_INTERO = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
  useGrouping: 'always',
} as Intl.NumberFormatOptions)

export const numeroIt = (n: number) => FORMATO_NUMERO.format(n)
export const euroIt = (n: number) => FORMATO_EURO.format(n)
export const euroInteroIt = (n: number) => FORMATO_EURO_INTERO.format(n)

/** «+12%», «-4%» o «n.d.» quando il periodo prima era a zero o non c'è. */
export function testoVariazione(c: Confronto): string {
  if (c.precedente === null || c.precedente <= 0) return 'n.d.'
  const p = Math.round(((c.attuale - c.precedente) / c.precedente) * 100)
  return `${p > 0 ? '+' : ''}${p}%`
}

export function dataEstesa(giorno: string): string {
  return new Date(`${giorno}T12:00:00Z`).toLocaleDateString('it-IT', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function meseEstesoBreve(mese: string): string {
  return new Date(`${mese}T12:00:00Z`).toLocaleDateString('it-IT', { timeZone: 'UTC', month: 'short', year: '2-digit' })
}

/** Il nome del file: report_AAAA-MM-GG_AAAA-MM-GG.pdf. */
export function nomeFileReport(dal: string, al: string): string {
  return `report_${dal}_${al}.pdf`
}

