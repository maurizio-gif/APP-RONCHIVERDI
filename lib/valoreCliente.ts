// Quanto vale un cliente: quanto ha speso nel club. Niente server-only qui:
// tipi e funzione pura, così il calcolo si legge e si prova da solo.

export type MovimentoCliente = {
  importo: number | string | null
  data_operazione: string | null
}

export type ValoreCliente = {
  /** Speso dal primo acquisto a oggi, al netto di storni e rimborsi. */
  totale: number
  /** Speso negli ultimi 12 mesi, sempre al netto. */
  ultimi12Mesi: number
  /** Quanti pagamenti ha fatto (i movimenti con un importo positivo). */
  pagamenti: number
  primoAcquisto: string
  ultimoAcquisto: string
  /** Speso per anno solare (Roma), dal più recente. */
  perAnno: { anno: number; totale: number }[]
}

const FORMATO_ANNO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric' })

/**
 * Somma i movimenti di cassa di una persona.
 *
 * Si somma l'importo così com'è, col segno: uno storno è una riga uguale e
 * contraria all'originale (le due si annullano) e un rimborso è un importo
 * negativo, quindi il netto è già giusto senza distinguerli. Non si guarda
 * `movimenta_cassa`: un bonifico è denaro incassato anche se non passa dal
 * cassetto. I movimenti con data futura (rate non ancora scadute) restano
 * fuori: non sono ancora speso. Chi non ha mai pagato non ha un valore da
 * mostrare, quindi `null`.
 */
export function calcolaValoreCliente(righe: MovimentoCliente[], adesso: Date = new Date()): ValoreCliente | null {
  const dodiciMesiFa = new Date(adesso)
  dodiciMesiFa.setFullYear(dodiciMesiFa.getFullYear() - 1)

  let totale = 0
  let ultimi12Mesi = 0
  let pagamenti = 0
  let primo: string | null = null
  let ultimo: string | null = null
  const perAnno = new Map<number, number>()

  for (const r of righe) {
    const importo = Number(r.importo ?? 0)
    if (!r.data_operazione || !Number.isFinite(importo) || importo === 0) continue
    const quando = new Date(r.data_operazione)
    if (Number.isNaN(quando.getTime()) || quando > adesso) continue

    totale += importo
    if (quando >= dodiciMesiFa) ultimi12Mesi += importo
    const anno = Number(FORMATO_ANNO.format(quando))
    perAnno.set(anno, (perAnno.get(anno) ?? 0) + importo)

    if (importo > 0) {
      pagamenti++
      if (!primo || r.data_operazione < primo) primo = r.data_operazione
      if (!ultimo || r.data_operazione > ultimo) ultimo = r.data_operazione
    }
  }

  if (!primo || !ultimo) return null
  return {
    totale,
    ultimi12Mesi,
    pagamenti,
    primoAcquisto: primo,
    ultimoAcquisto: ultimo,
    // Un anno in cui storni e rimborsi hanno azzerato tutto non dice nulla.
    perAnno: [...perAnno.entries()]
      .filter(([, t]) => t !== 0)
      .map(([anno, t]) => ({ anno, totale: t }))
      .sort((a, b) => b.anno - a.anno),
  }
}
