// Periodi, confronti e variazioni per la sezione Analytics.
//
// Tutto in italiano, comprese le etichette dei grafici: nel CRM del Tennis
// Club Ambrosiano l'Analytics è l'unica sezione in inglese (formatDeltaEn,
// formatDateWithWeekday) e stona col resto del pannello. Qui no.
//
// Nessun import server-only: usato sia dai Server Component sia dai client.

export const OPZIONI_PERIODO = [
  { valore: '7', etichetta: '7 giorni', giorni: 7 },
  { valore: '30', etichetta: '30 giorni', giorni: 30 },
  { valore: '90', etichetta: '90 giorni', giorni: 90 },
  { valore: '365', etichetta: '12 mesi', giorni: 365 },
] as const

export type ValorePeriodo = (typeof OPZIONI_PERIODO)[number]['valore']

export const OPZIONI_CONFRONTO = [
  { valore: 'precedente', etichetta: 'Periodo precedente' },
  { valore: 'anno', etichetta: 'Anno precedente' },
  { valore: 'nessuno', etichetta: 'Nessun confronto' },
] as const

export type ValoreConfronto = (typeof OPZIONI_CONFRONTO)[number]['valore']

export function periodoDa(valore: string | undefined) {
  return OPZIONI_PERIODO.find((p) => p.valore === valore) ?? OPZIONI_PERIODO[1]
}

export function confrontoDa(valore: string | undefined): ValoreConfronto {
  return (OPZIONI_CONFRONTO.find((c) => c.valore === valore)?.valore ?? 'precedente') as ValoreConfronto
}

/**
 * Estremi del periodo e del confronto.
 *
 * Il periodo precedente è lungo esattamente come quello principale e finisce
 * dove l'altro comincia: confrontare 30 giorni con 14 darebbe una variazione
 * che non significa niente. L'anno precedente sposta di 365 giorni entrambi
 * gli estremi, così il confronto cade sullo stesso periodo dell'anno prima.
 */
export function calcolaEstremi(giorni: number, confronto: ValoreConfronto) {
  const a = new Date()
  const da = new Date(a)
  da.setDate(da.getDate() - giorni)

  if (confronto === 'nessuno') return { da, a, confronto: null as null | { da: Date; a: Date } }

  if (confronto === 'anno') {
    const cDa = new Date(da)
    const cA = new Date(a)
    cDa.setDate(cDa.getDate() - 365)
    cA.setDate(cA.getDate() - 365)
    return { da, a, confronto: { da: cDa, a: cA } }
  }

  const cA = new Date(da)
  const cDa = new Date(da)
  cDa.setDate(cDa.getDate() - giorni)
  return { da, a, confronto: { da: cDa, a: cA } }
}

/**
 * Variazione percentuale fra due periodi.
 *
 * null quando prima era zero e ora no: mostrare "+∞%" o "+100%" sarebbe
 * falso, si scrive "nuovo". 0 quando entrambi sono a zero — niente è
 * cambiato, e nascondere il dato farebbe pensare a un errore.
 */
export function variazione(ora: number, prima: number): number | null {
  if (prima === 0) return ora === 0 ? 0 : null
  return Math.round(((ora - prima) / prima) * 1000) / 10
}

/** "+12,5%", "−8%", "nuovo", "=". */
export function formattaVariazione(v: number | null): string {
  if (v === null) return 'nuovo'
  if (v === 0) return '='
  const segno = v > 0 ? '+' : '−'
  return `${segno}${String(Math.abs(v)).replace('.', ',')}%`
}

/** Classe del badge: una variazione negativa non è sempre una brutta notizia. */
export function classeVariazione(v: number | null, piuEMeglio = true): string {
  if (v === null) return 'badge-ok'
  if (v === 0) return 'badge-off'
  const buona = piuEMeglio ? v > 0 : v < 0
  return buona ? 'badge-ok' : 'badge-warn'
}

export function percentuale(parte: number, totale: number): string {
  if (!totale) return '—'
  return `${(Math.round((parte / totale) * 1000) / 10).toString().replace('.', ',')}%`
}

/** "lun 2 set", per l'asse del grafico e i tooltip. */
export function giornoBreve(chiave: string): string {
  return new Date(`${chiave}T12:00:00Z`).toLocaleDateString('it-IT', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function dataBreve(d: Date): string {
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
}

export type Voce = { voce: string; richieste: number }
export type Giorno = { giorno: string; richieste: number }
export type Combinazione = {
  attivita: string | null
  settore: string | null
  origine: string | null
  richieste: number
  lavorate: number
}

export type Statistiche = {
  richieste: number
  lavorate: number
  con_appuntamento: number
  persone_nuove: number
  trattative_aperte: number
  trattative_vinte: number
  trattative_perse: number
  giorni: Giorno[]
  combinazioni: Combinazione[]
  attivita: Voce[]
  sorgenti: Voce[]
  mezzi: Voce[]
  campagne: Voce[]
  termini: Voce[]
  cta: Voce[]
  pagine: Voce[]
  stati_trattativa: Voce[]
  assegnatari: Voce[]
  lavorate_da: Voce[]
}

export const STATISTICHE_VUOTE: Statistiche = {
  richieste: 0,
  lavorate: 0,
  con_appuntamento: 0,
  persone_nuove: 0,
  trattative_aperte: 0,
  trattative_vinte: 0,
  trattative_perse: 0,
  giorni: [],
  combinazioni: [],
  attivita: [],
  sorgenti: [],
  mezzi: [],
  campagne: [],
  termini: [],
  cta: [],
  pagine: [],
  stati_trattativa: [],
  assegnatari: [],
  lavorate_da: [],
}

/** Serie completa di giorni fra due estremi, con gli zeri dove non c'è nulla. */
export function serieCompleta(giorni: Giorno[], da: Date, a: Date): Giorno[] {
  const presenti = new Map(giorni.map((g) => [g.giorno, g.richieste]))
  const serie: Giorno[] = []
  const cursore = new Date(Date.UTC(da.getFullYear(), da.getMonth(), da.getDate()))
  const fine = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())

  // Il giorno senza richieste vale zero e va disegnato: senza, il grafico
  // comprimerebbe le pause e farebbe sembrare continuo un andamento che non lo è.
  while (cursore.getTime() <= fine) {
    const chiave = cursore.toISOString().slice(0, 10)
    serie.push({ giorno: chiave, richieste: presenti.get(chiave) ?? 0 })
    cursore.setUTCDate(cursore.getUTCDate() + 1)
  }
  return serie
}
