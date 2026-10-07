import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { giornoPiu, mezzanotteRoma } from '@/lib/agenda'

// Il report dell'incassato (/dashboard/incassato): i movimenti di cassa di
// Info4U (tabella `transazioni`, vedi scripts/sql/2026-10-07-transazioni-cassa.sql
// e 2026-10-07-incassato-report.sql), letti dalle viste di riconciliazione.

type Supabase = ReturnType<typeof createSupabaseServiceClient>

// Le transazioni si migrano dal 1 gennaio 2023 (vedi il sync): prima di
// questo mese il report non ha dati.
export const PRIMO_MESE_DATI = '2023-01-01'

// PostgREST tronca ogni risposta a 1000 righe: si pagina sempre.
const PAGINA = 1000

// ─────────────────────────────────────────────────────────────── etichette

export const TIPI_SERVIZIO: Record<string, { nome: string; nota: string }> = {
  A: { nome: 'Abbonamenti', nota: 'Incassi delle vendite di abbonamenti: è il grosso dell’incassato.' },
  C: {
    nome: 'Cauzioni',
    nota: 'Cauzioni prese e restituite: denaro in transito, non ricavo. Somma vicina a zero.',
  },
  I: { nome: 'Tesseramento', nota: 'Tesseramento soci: importi minimi, spesso a zero.' },
  P: { nome: 'Prenotazioni', nota: 'Prenotazioni manuali dei campi.' },
  O: { nome: 'Restituzioni', nota: 'Restituzioni di somme («Restituiti X €»): uscite.' },
  B: { nome: 'Borsellino', nota: 'Credito e utilizzi del borsellino (padel, tennis).' },
  M: { nome: 'Varie', nota: 'Movimenti di altro tipo.' },
  '?': { nome: 'Tipo non indicato', nota: 'Movimento senza tipo di servizio.' },
}

export function nomeTipo(tipo: string): string {
  return TIPI_SERVIZIO[tipo]?.nome ?? `Tipo ${tipo}`
}

export const COLLEGAMENTI = ['abbonamento', 'eliminazione', 'vendita_eliminata', 'senza_abbonamento'] as const
export type Collegamento = (typeof COLLEGAMENTI)[number]

export const ETICHETTE_COLLEGAMENTO: Record<Collegamento, { nome: string; nota: string }> = {
  abbonamento: {
    nome: 'Su un abbonamento',
    nota: 'Incasso collegato a una vendita presente nel CRM.',
  },
  eliminazione: {
    nome: 'Eliminazione di vendita',
    nota: 'Movimento negativo che Info4U crea quando un operatore elimina una vendita: compensa gli incassi originali.',
  },
  vendita_eliminata: {
    nome: 'Vendita non più presente',
    nota: 'Punta a una vendita cancellata in Info4U: l’incasso originale resta in cassa e l’eliminazione lo compensa.',
  },
  senza_abbonamento: {
    nome: 'Senza abbonamento',
    nota: 'Nessuna vendita collegata: cauzioni, tesseramenti, prenotazioni, rimborsi, borsellino.',
  },
}

export const PERIODI_VENDITA = ['stesso_mese', 'vendita_precedente', 'vendita_successiva'] as const
export type PeriodoVendita = (typeof PERIODI_VENDITA)[number]

export const ETICHETTE_PERIODO: Record<PeriodoVendita, { nome: string; nota: string }> = {
  stesso_mese: { nome: 'Vendite dello stesso mese', nota: 'Incassato nel mese su abbonamenti venduti nello stesso mese.' },
  vendita_precedente: {
    nome: 'Vendite di mesi precedenti',
    nota: 'Rate e saldi incassati nel mese su abbonamenti venduti prima.',
  },
  vendita_successiva: {
    nome: 'Vendite di mesi successivi',
    nota: 'Acconti incassati prima del mese della vendita.',
  },
}

export const SENZA_METODO = 'Nessun metodo'
// «Da definire» è il metodo che InfoRYOU propone quando l’operatore non ne
// sceglie uno: il movimento è incassato, ma non si sa come.
export const METODO_DA_DEFINIRE = 'Da definire'

// ───────────────────────────────────────────────────────────────── totali

export type Totali = { movimenti: number; entrate: number; uscite: number; netto: number; storni: number }

export const totaliVuoti = (): Totali => ({ movimenti: 0, entrate: 0, uscite: 0, netto: 0, storni: 0 })

// Gli importi sono smallmoney/numeric: sommati in virgola mobile accumulano
// scarti di frazioni di centesimo, quindi si arrotonda al centesimo a ogni
// somma — i totali devono tornare al centesimo con la cassa.
const cent = (n: number) => Math.round(n * 100) / 100

export function sommaIn(a: Totali, r: RigaGiornaliera): void {
  a.movimenti += r.movimenti
  a.entrate = cent(a.entrate + r.entrate)
  a.uscite = cent(a.uscite + r.uscite)
  a.netto = cent(a.netto + r.netto)
  a.storni += r.storni
}

export function raggruppa<K extends string>(righe: RigaGiornaliera[], chiave: (r: RigaGiornaliera) => K): Map<K, Totali> {
  const mappa = new Map<K, Totali>()
  for (const r of righe) {
    const k = chiave(r)
    let t = mappa.get(k)
    if (!t) {
      t = totaliVuoti()
      mappa.set(k, t)
    }
    sommaIn(t, r)
  }
  return mappa
}

export function sommaTutto(righe: RigaGiornaliera[]): Totali {
  const t = totaliVuoti()
  for (const r of righe) sommaIn(t, r)
  return t
}

// ───────────────────────────────────────────────────────── riepilogo mensile

export type RigaGiornaliera = {
  giorno: string
  tipo_servizio: string
  metodo_pagamento: string
  movimenta_cassa: boolean | null
  collegamento: Collegamento
  periodo_vendita: PeriodoVendita | null
  movimenti: number
  entrate: number
  uscite: number
  netto: number
  storni: number
}

export async function caricaGiornaliero(
  supabase: Supabase,
  primo: string,
  ultimo: string
): Promise<{ righe: RigaGiornaliera[]; errore: string | null }> {
  const righe: RigaGiornaliera[] = []
  // Ordine su tutte le colonne di raggruppamento: la paginazione con range()
  // su un ordine non deterministico potrebbe ripetere o saltare righe.
  for (let da = 0; da < 20 * PAGINA; da += PAGINA) {
    const { data, error } = await supabase
      .from('incassato_giornaliero')
      .select('giorno, tipo_servizio, metodo_pagamento, movimenta_cassa, collegamento, periodo_vendita, movimenti, entrate, uscite, netto, storni')
      .gte('giorno', primo)
      .lte('giorno', ultimo)
      .order('giorno')
      .order('tipo_servizio')
      .order('metodo_pagamento')
      .order('collegamento')
      .order('periodo_vendita', { nullsFirst: true })
      .range(da, da + PAGINA - 1)
    if (error) return { righe: [], errore: error.message }
    for (const r of data ?? []) {
      righe.push({
        giorno: r.giorno as string,
        tipo_servizio: r.tipo_servizio as string,
        metodo_pagamento: r.metodo_pagamento as string,
        movimenta_cassa: r.movimenta_cassa as boolean | null,
        collegamento: r.collegamento as Collegamento,
        periodo_vendita: r.periodo_vendita as PeriodoVendita | null,
        movimenti: Number(r.movimenti),
        entrate: Number(r.entrate),
        uscite: Number(r.uscite),
        netto: Number(r.netto),
        storni: Number(r.storni),
      })
    }
    if (!data || data.length < PAGINA) break
  }
  return { righe, errore: null }
}

// ─────────────────────────────────────────────────────────── venduto del mese

// Le vendite del mese (data_vendita), non cancellate: il «venduto» a cui
// confrontare l'incassato. Letto dalla vista per vendita, non da `abbonamenti`
// riga per riga, per avere in un colpo anche l'incassato di ciascuna.
export async function caricaVenditeDelMese(
  supabase: Supabase,
  primo: string,
  ultimo: string
): Promise<{ righe: RigaVendita[]; errore: string | null }> {
  const righe: RigaVendita[] = []
  for (let da = 0; da < 20 * PAGINA; da += PAGINA) {
    const { data, error } = await supabase
      .from('abbonamenti_incassato')
      .select(
        'source_iscrizione_id, persona_id, persona_nome, persona_cognome, abbonamento, variante, data_vendita, venduto, incassato, movimenti, ultimo_incasso, differenza, rate_totali, rate_pagate, rate_insolute, importo_insoluto, importo_da_pagare'
      )
      .gte('data_vendita', mezzanotteRoma(primo))
      .lt('data_vendita', mezzanotteRoma(giornoPiu(ultimo, 1)))
      .order('data_vendita', { ascending: false })
      .order('source_iscrizione_id', { ascending: false })
      .range(da, da + PAGINA - 1)
    if (error) return { righe: [], errore: error.message }
    for (const r of data ?? []) {
      righe.push({
        source_iscrizione_id: Number(r.source_iscrizione_id),
        persona_id: r.persona_id as string | null,
        persona_nome: r.persona_nome as string | null,
        persona_cognome: r.persona_cognome as string | null,
        abbonamento: r.abbonamento as string | null,
        variante: r.variante as string | null,
        data_vendita: r.data_vendita as string,
        venduto: Number(r.venduto),
        incassato: Number(r.incassato),
        movimenti: Number(r.movimenti),
        ultimo_incasso: r.ultimo_incasso as string | null,
        differenza: Number(r.differenza),
        rate_totali: Number(r.rate_totali),
        rate_pagate: Number(r.rate_pagate),
        rate_insolute: Number(r.rate_insolute),
        importo_insoluto: Number(r.importo_insoluto),
        importo_da_pagare: Number(r.importo_da_pagare),
      })
    }
    if (!data || data.length < PAGINA) break
  }
  return { righe, errore: null }
}

export type RigaVendita = {
  source_iscrizione_id: number
  persona_id: string | null
  persona_nome: string | null
  persona_cognome: string | null
  abbonamento: string | null
  variante: string | null
  data_vendita: string
  venduto: number
  incassato: number
  movimenti: number
  ultimo_incasso: string | null
  differenza: number
  rate_totali: number
  rate_pagate: number
  rate_insolute: number
  importo_insoluto: number
  importo_da_pagare: number
}

export type StatoVendita = 'completa' | 'rateale' | 'insoluta' | 'non_spiegata' | 'eccesso'

// Una vendita «da incassare» ha tre possibili spiegazioni, in ordine:
//   - ha rate scadute e non pagate: INSOLUTA;
//   - la differenza è tutta coperta da rate non ancora scadute: RATEALE, a
//     posto, è solo il piano di pagamento in corso;
//   - nessuna rata la spiega (o ne spiega solo una parte): NON SPIEGATA, il
//     caso da controllare — una vendita senza incasso né rate, un incasso
//     mancante, un piano rate non migrato.
// Tolleranza di un centesimo: gli importi sono già al centesimo, ma la
// differenza di due numeri in virgola mobile no.
export function statoVendita(v: RigaVendita): StatoVendita {
  const d = cent(v.differenza)
  if (d === 0) return 'completa'
  if (d < 0) return 'eccesso'
  if (v.rate_insolute > 0) return 'insoluta'
  if (cent(v.importo_da_pagare) >= d) return 'rateale'
  return 'non_spiegata'
}

export const ETICHETTE_STATO_VENDITA: Record<StatoVendita, string> = {
  completa: 'Incassata per intero',
  rateale: 'Rate in corso',
  insoluta: 'Rate scadute non pagate',
  non_spiegata: 'Differenza non spiegata',
  eccesso: 'Incassato oltre il venduto',
}

/** La parte della differenza che nessuna rata (scaduta o futura) spiega. */
export function nonSpiegato(v: RigaVendita): number {
  return cent(Math.max(0, v.differenza - v.importo_insoluto - v.importo_da_pagare))
}

// ───────────────────────────────────────────────────── elenco dei movimenti

export type FiltriMovimenti = {
  primo: string
  ultimo: string
  tipo: string | null
  metodo: string | null
  collegamento: Collegamento | null
  segno: 'entrate' | 'uscite' | 'zero' | null
  storno: boolean
  giorno: string | null
}

export type RigaMovimento = {
  source_movimento_id: number
  data_operazione: string
  importo: number
  tipo_servizio: string | null
  descrizione_servizio: string | null
  causale: string | null
  metodo_pagamento: string | null
  movimenta_cassa: boolean | null
  e_storno: boolean
  source_movimento_storno_id: number | null
  operatore_nome: string | null
  persona_id: string | null
  persona_nome: string | null
  persona_cognome: string | null
  source_iscrizione_id: number | null
  abbonamento: string | null
  data_vendita: string | null
  vendita_totale: number | null
  collegamento: Collegamento
}

const COLONNE_MOVIMENTO =
  'source_movimento_id, data_operazione, importo, tipo_servizio, descrizione_servizio, causale, metodo_pagamento, movimenta_cassa, e_storno, source_movimento_storno_id, operatore_nome, persona_id, persona_nome, persona_cognome, source_iscrizione_id, abbonamento, data_vendita, vendita_totale, collegamento'

// Legge il valore di un parametro di ricerca solo se è fra quelli ammessi:
// i filtri finiscono in una query, e un valore libero non entra mai.
function fra<T extends string>(valore: string | undefined, ammessi: readonly T[]): T | null {
  return (ammessi as readonly string[]).includes(valore ?? '') ? (valore as T) : null
}

export function leggiFiltriMovimenti(
  primo: string,
  ultimo: string,
  sp: { tipo?: string; metodo?: string; collegamento?: string; segno?: string; storno?: string; giorno?: string }
): FiltriMovimenti {
  const giornoValido = /^\d{4}-\d{2}-\d{2}$/.test(sp.giorno ?? '') && sp.giorno! >= primo && sp.giorno! <= ultimo
  return {
    primo,
    ultimo,
    tipo: sp.tipo && sp.tipo.length <= 2 ? sp.tipo : null,
    metodo: sp.metodo && sp.metodo.length <= 60 ? sp.metodo : null,
    collegamento: fra(sp.collegamento, COLLEGAMENTI),
    segno: fra(sp.segno, ['entrate', 'uscite', 'zero'] as const),
    storno: sp.storno === 'si',
    giorno: giornoValido ? sp.giorno! : null,
  }
}

// I parametri di un filtro, per ricostruire un link che lo mantiene.
export function parametriFiltri(f: FiltriMovimenti): Record<string, string> {
  const p: Record<string, string> = {}
  if (f.tipo) p.tipo = f.tipo
  if (f.metodo) p.metodo = f.metodo
  if (f.collegamento) p.collegamento = f.collegamento
  if (f.segno) p.segno = f.segno
  if (f.storno) p.storno = 'si'
  if (f.giorno) p.giorno = f.giorno
  return p
}

export const DIMENSIONE_PAGINA_MOVIMENTI = 100

export async function caricaMovimenti(
  supabase: Supabase,
  f: FiltriMovimenti,
  da: number,
  quanti: number
): Promise<{ righe: RigaMovimento[]; totale: number; errore: string | null }> {
  let q = supabase
    .from('transazioni_dettaglio')
    .select(COLONNE_MOVIMENTO, { count: 'exact' })
    .is('cancellato_il', null)
    .lte('data_operazione', new Date().toISOString())
    .gte('giorno', f.giorno ?? f.primo)
    .lte('giorno', f.giorno ?? f.ultimo)
  if (f.tipo) q = f.tipo === '?' ? q.is('tipo_servizio', null) : q.eq('tipo_servizio', f.tipo)
  if (f.metodo) q = f.metodo === SENZA_METODO ? q.is('metodo_pagamento', null) : q.eq('metodo_pagamento', f.metodo)
  if (f.collegamento) q = q.eq('collegamento', f.collegamento)
  if (f.segno === 'entrate') q = q.gt('importo', 0)
  if (f.segno === 'uscite') q = q.lt('importo', 0)
  if (f.segno === 'zero') q = q.eq('importo', 0)
  if (f.storno) q = q.eq('e_storno', true)

  const { data, count, error } = await q
    .order('data_operazione', { ascending: false })
    .order('source_movimento_id', { ascending: false })
    .range(da, da + quanti - 1)
  if (error) return { righe: [], totale: 0, errore: error.message }

  const righe = (data ?? []).map((r) => ({
    ...r,
    source_movimento_id: Number(r.source_movimento_id),
    importo: Number(r.importo ?? 0),
    vendita_totale: r.vendita_totale === null ? null : Number(r.vendita_totale),
  })) as unknown as RigaMovimento[]
  return { righe, totale: count ?? 0, errore: null }
}

/** Movimenti con data nel futuro: quasi sempre un anno digitato male. */
export async function contaMovimentiFuturi(supabase: Supabase): Promise<number> {
  const { count } = await supabase
    .from('transazioni')
    .select('id', { count: 'exact', head: true })
    .is('cancellato_il', null)
    .gt('data_operazione', new Date().toISOString())
  return count ?? 0
}

// ───────────────────────────────────────────────────────────────────── rate

export type RigaRata = {
  source_rata_id: number
  source_iscrizione_id: number | null
  data_rata: string | null
  importo: number
  metodo_pagamento: string | null
  transazione_errore: string | null
  transazione_data: string | null
  giorni_ritardo: number | null
  persona_id: string | null
  persona_nome: string | null
  persona_cognome: string | null
  abbonamento: string | null
  variante: string | null
  vendita_totale: number | null
  vendita_assente: boolean
}

// Le rate scadute e non pagate, le più vecchie per prime. Tetto di
// 5 pagine (5.000 rate): se lo supera, la pagina lo dice invece di mostrare
// un totale monco senza avvisare.
export async function caricaRateInsolute(
  supabase: Supabase
): Promise<{ righe: RigaRata[]; troncato: boolean; errore: string | null }> {
  const righe: RigaRata[] = []
  let troncato = false
  for (let da = 0; da < 5 * PAGINA; da += PAGINA) {
    const { data, error } = await supabase
      .from('rate_abbonamenti')
      .select(
        'source_rata_id, source_iscrizione_id, data_rata, importo, metodo_pagamento, transazione_errore, transazione_data, giorni_ritardo, persona_id, persona_nome, persona_cognome, abbonamento, variante, vendita_totale, vendita_assente'
      )
      .eq('stato', 'insoluta')
      .order('data_rata', { ascending: true })
      .order('source_rata_id', { ascending: true })
      .range(da, da + PAGINA - 1)
    if (error) return { righe: [], troncato: false, errore: error.message }
    for (const r of data ?? []) {
      righe.push({
        source_rata_id: Number(r.source_rata_id),
        source_iscrizione_id: r.source_iscrizione_id === null ? null : Number(r.source_iscrizione_id),
        data_rata: r.data_rata as string | null,
        importo: Number(r.importo ?? 0),
        metodo_pagamento: r.metodo_pagamento as string | null,
        transazione_errore: r.transazione_errore as string | null,
        transazione_data: r.transazione_data as string | null,
        giorni_ritardo: r.giorni_ritardo === null ? null : Number(r.giorni_ritardo),
        persona_id: r.persona_id as string | null,
        persona_nome: r.persona_nome as string | null,
        persona_cognome: r.persona_cognome as string | null,
        abbonamento: r.abbonamento as string | null,
        variante: r.variante as string | null,
        vendita_totale: r.vendita_totale === null ? null : Number(r.vendita_totale),
        vendita_assente: Boolean(r.vendita_assente),
      })
    }
    if (!data || data.length < PAGINA) return { righe, troncato, errore: null }
    if (da + PAGINA >= 5 * PAGINA) troncato = true
  }
  return { righe, troncato, errore: null }
}
