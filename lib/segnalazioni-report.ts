import { aperta, inRitardo, oraEGiornoRoma, type Segnalazione, type Urgenza } from '@/lib/segnalazioni'

// Le cifre del report segnalazioni, calcolate su un elenco già letto. Pure:
// nessun accesso al database, così si leggono (e si provano) da sole.

export function mediana(valori: number[]): number | null {
  if (!valori.length) return null
  const v = [...valori].sort((a, b) => a - b)
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

const ore = (da: string, a: string) => (new Date(a).getTime() - new Date(da).getTime()) / 3600_000

export type Conteggio = { chiave: string; n: number }

function conta(righe: Segnalazione[], chiave: (s: Segnalazione) => string | null): Conteggio[] {
  const m = new Map<string, number>()
  for (const s of righe) {
    const k = chiave(s)
    if (k) m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].map(([k, n]) => ({ chiave: k, n })).sort((a, b) => b.n - a.n)
}

export type RigaSettore = {
  settore: string
  n: number
  aperte: number
  ritardo: number
  medianaRisoluzioneOre: number | null
}

export type Ricorrenza = { settore: string; motivo: string; n: number }
export type SocioRicorrente = { socio: string; n: number }
export type CaricoOperatore = {
  email: string
  assegnate: number
  aperte: number
  risolte: number
  medianaRisoluzioneOre: number | null
}

export type ReportSegnalazioni = {
  ricevute: number
  chiuse: number
  aperte: number
  inRitardo: number
  // Presa in carico: fra quelle il cui tempo è già scaduto o che sono state
  // prese, quante lo sono state in tempo.
  presaPuntuali: number
  presaDovute: number
  medianaPresaOre: number | null
  medianaRisoluzioneOre: number | null
  perUrgenza: Record<Urgenza, number>
  perSettore: RigaSettore[]
  perMotivo: Conteggio[]
  perOra: number[] // 24 valori
  perGiorno: number[] // 7 valori, lunedì primo
  perMese: Conteggio[] // YYYY-MM, in ordine di tempo
  ricorrenze: Ricorrenza[]
  sociRicorrenti: SocioRicorrente[]
  carico: CaricoOperatore[]
}

export function calcolaReport(righe: Segnalazione[], adesso: Date = new Date()): ReportSegnalazioni {
  const risolte = righe.filter((s) => s.risolta_il)
  const attive = righe.filter((s) => s.stato !== 'archiviata')

  const prese = attive.filter((s) => s.presa_in_carico_il)
  const dovute = attive.filter((s) => s.presa_in_carico_il || new Date(s.scadenza_presa_il) < adesso)
  const puntuali = dovute.filter((s) => s.presa_in_carico_il && new Date(s.presa_in_carico_il) <= new Date(s.scadenza_presa_il))

  const perUrgenza: Record<Urgenza, number> = { sicurezza: 0, disservizio: 0, comfort: 0 }
  for (const s of righe) perUrgenza[s.urgenza]++

  const settori = new Set(righe.map((s) => s.settore))
  const perSettore: RigaSettore[] = [...settori]
    .map((settore) => {
      const r = righe.filter((s) => s.settore === settore)
      return {
        settore,
        n: r.length,
        aperte: r.filter(aperta).length,
        ritardo: r.filter((s) => inRitardo(s, adesso)).length,
        medianaRisoluzioneOre: mediana(r.filter((s) => s.risolta_il).map((s) => ore(s.ricevuta_il, s.risolta_il!))),
      }
    })
    .sort((a, b) => b.n - a.n)

  const perOra = Array<number>(24).fill(0)
  const perGiorno = Array<number>(7).fill(0)
  for (const s of righe) {
    const { ora, giorno } = oraEGiornoRoma(s.ricevuta_il)
    perOra[ora]++
    perGiorno[giorno]++
  }

  const perMese = conta(righe, (s) => s.ricevuta_il.slice(0, 7)).sort((a, b) => a.chiave.localeCompare(b.chiave))

  // Lo stesso motivo nello stesso posto più volte: è un problema del luogo,
  // non il lamento di un socio. Tre è la soglia sotto cui può essere caso.
  const coppie = new Map<string, Ricorrenza>()
  for (const s of righe) {
    const k = `${s.settore}|${s.motivo}`
    const c = coppie.get(k)
    if (c) c.n++
    else coppie.set(k, { settore: s.settore, motivo: s.motivo, n: 1 })
  }
  const ricorrenze = [...coppie.values()].filter((c) => c.n >= 3).sort((a, b) => b.n - a.n)

  // Chi è in anagrafica si raggruppa per persona (due grafie dello stesso
  // nome restano una persona); gli altri per nome scritto.
  const nomePerChiave = new Map<string, string>()
  const soci = conta(righe, (s) => {
    const chiave = s.persona_id ?? s.socio_nome?.trim().toLowerCase() ?? null
    if (chiave && s.socio_nome && !nomePerChiave.has(chiave)) nomePerChiave.set(chiave, s.socio_nome.trim())
    return chiave
  })
    .filter((c) => c.n >= 2)
    .map((c) => ({ socio: nomePerChiave.get(c.chiave) ?? c.chiave, n: c.n }))

  const operatori = new Set(righe.map((s) => s.assegnato_a).filter((e): e is string => !!e))
  const carico: CaricoOperatore[] = [...operatori]
    .map((email) => {
      const r = righe.filter((s) => s.assegnato_a === email)
      return {
        email,
        assegnate: r.length,
        aperte: r.filter(aperta).length,
        risolte: r.filter((s) => s.risolta_il).length,
        medianaRisoluzioneOre: mediana(r.filter((s) => s.risolta_il).map((s) => ore(s.ricevuta_il, s.risolta_il!))),
      }
    })
    .sort((a, b) => b.assegnate - a.assegnate)

  return {
    ricevute: righe.length,
    chiuse: righe.filter((s) => !aperta(s)).length,
    aperte: righe.filter(aperta).length,
    inRitardo: righe.filter((s) => inRitardo(s, adesso)).length,
    presaPuntuali: puntuali.length,
    presaDovute: dovute.length,
    medianaPresaOre: mediana(prese.map((s) => ore(s.ricevuta_il, s.presa_in_carico_il!))),
    medianaRisoluzioneOre: mediana(risolte.map((s) => ore(s.ricevuta_il, s.risolta_il!))),
    perUrgenza,
    perSettore,
    perMotivo: conta(righe, (s) => s.motivo),
    perOra,
    perGiorno,
    perMese,
    ricorrenze,
    sociRicorrenti: soci,
    carico,
  }
}
