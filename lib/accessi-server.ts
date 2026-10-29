import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { giornoPiu, mezzanotteRoma } from '@/lib/agenda'
import {
  CHIAVE_SENZA_GRUPPO,
  ESITI_PASSAGGIO,
  RIEPILOGO_VUOTO,
  chiaveVarco,
  chiaviPeriodi,
  leggiChiaveVarco,
  periodoDa,
  type CellaCalore,
  type FasciaFedelta,
  type Gruppo,
  type Passo,
  type Periodo,
  type PuntoSerie,
  type PuntoVisite,
  type Riepilogo,
  type RigaNegati,
  type RigaVarco,
  type SocioInattivo,
  type Varco,
} from '@/lib/accessi'

// Le letture della sezione Accessi. Server-only: usa la service role key.
// I grafici non leggono `accessi` (3,4 milioni di righe) ma il riepilogo
// `accessi_ore` e le funzioni di scripts/sql/2026-10-29-accessi-sezione.sql;
// solo la ricerca interroga `accessi` direttamente, sempre con un periodo.

/** Lo script SQL della sezione non è stato eseguito: le pagine lo dicono invece di rompersi. */
export class ScriptAccessiMancante extends Error {
  constructor() {
    super('Manca lo script SQL della sezione Accessi: esegui scripts/sql/2026-10-29-accessi-sezione.sql nel SQL Editor di Supabase.')
  }
}

type Db = ReturnType<typeof createSupabaseServiceClient>

function controlla(errore: { code?: string; message: string } | null, nome: string): void {
  if (!errore) return
  // PGRST202: funzione non trovata; 42P01: tabella inesistente.
  if (errore.code === 'PGRST202' || errore.code === '42P01' || errore.code === 'PGRST205') throw new ScriptAccessiMancante()
  throw new Error(`Accessi, ${nome}: ${errore.message}`)
}

async function rpc<T>(db: Db, funzione: string, argomenti: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await db.rpc(funzione, argomenti)
  controlla(error, funzione)
  return (data ?? []) as T[]
}

// ─────────────────────────────────────────────────────── anagrafica varchi

export async function caricaGruppiAccessi(db: Db = createSupabaseServiceClient()): Promise<Gruppo[]> {
  const { data, error } = await db.from('accessi_gruppi').select('id, nome, colore, ordine').order('ordine').order('nome')
  controlla(error, 'gruppi')
  return (data ?? []) as Gruppo[]
}

/** Tutti i varchi dell'anagrafica Info4U, ciascuno col suo gruppo (se ce l'ha). */
export async function caricaVarchi(db: Db = createSupabaseServiceClient()): Promise<Varco[]> {
  const [terminali, assegnazioni] = await Promise.all([
    db.from('terminali_info4u').select('source_terminale_id, indirizzo, source_concentratore_id, descrizione, attivo'),
    db.from('accessi_gruppi_varchi').select('source_terminale_id, indirizzo, source_concentratore_id, gruppo_id'),
  ])
  controlla(terminali.error, 'varchi')
  controlla(assegnazioni.error, 'assegnazioni dei varchi')
  const gruppoDi = new Map(
    (assegnazioni.data ?? []).map((a) => [chiaveVarco(a.source_terminale_id, a.indirizzo, a.source_concentratore_id), a.gruppo_id as string])
  )
  return (terminali.data ?? [])
    .map((t): Varco => {
      const chiave = chiaveVarco(t.source_terminale_id, t.indirizzo, t.source_concentratore_id)
      return {
        chiave,
        terminale: t.source_terminale_id,
        indirizzo: t.indirizzo,
        concentratore: t.source_concentratore_id,
        descrizione: (t.descrizione as string | null)?.trim() || `Varco ${chiave}`,
        gruppoId: gruppoDi.get(chiave) ?? null,
        attivo: !!t.attivo,
      }
    })
    .sort((a, b) => a.descrizione.localeCompare(b.descrizione, 'it'))
}

// ───────────────────────────────────────────────────────────────── letture

export async function riepilogoAccessi(db: Db, dal: string, al: string): Promise<Riepilogo> {
  const { data, error } = await db.rpc('accessi_riepilogo', { p_dal: dal, p_al: al })
  controlla(error, 'riepilogo')
  const r = data as Record<string, number> | null
  if (!r) return RIEPILOGO_VUOTO
  return {
    passaggi: Number(r.passaggi ?? 0),
    negati: Number(r.negati ?? 0),
    giorniAperti: Number(r.giorni_aperti ?? 0),
    persone: Number(r.persone ?? 0),
    visite: Number(r.visite ?? 0),
  }
}

/** I passaggi per periodo, con tutti i periodi del range (anche quelli a zero). */
export async function serieAccessi(db: Db, dal: string, al: string, passo: Passo): Promise<PuntoSerie[]> {
  const righe = await rpc<{ periodo: string; gruppo_id: string | null; passaggi: number }>(db, 'accessi_serie', {
    p_dal: dal,
    p_al: al,
    p_passo: passo,
  })
  const punti = new Map<string, PuntoSerie>(
    chiaviPeriodi(dal, al, passo).map((p) => [p, { periodo: p, totale: 0, perGruppo: {} }])
  )
  for (const r of righe) {
    const punto = punti.get(r.periodo)
    if (!punto) continue
    const chiave = r.gruppo_id ?? CHIAVE_SENZA_GRUPPO
    const n = Number(r.passaggi)
    punto.perGruppo[chiave] = (punto.perGruppo[chiave] ?? 0) + n
    punto.totale += n
  }
  return [...punti.values()]
}

export async function serieVisite(db: Db, dal: string, al: string, passo: Passo): Promise<PuntoVisite[]> {
  const righe = await rpc<{ periodo: string; visite: number; persone: number }>(db, 'accessi_serie_visite', {
    p_dal: dal,
    p_al: al,
    p_passo: passo,
  })
  const punti = new Map<string, PuntoVisite>(chiaviPeriodi(dal, al, passo).map((p) => [p, { periodo: p, visite: 0, persone: 0 }]))
  for (const r of righe) {
    const punto = punti.get(r.periodo)
    if (punto) {
      punto.visite = Number(r.visite)
      punto.persone = Number(r.persone)
    }
  }
  return [...punti.values()]
}

export async function accessiPerVarco(db: Db, dal: string, al: string, varchi: Varco[]): Promise<RigaVarco[]> {
  const righe = await rpc<{
    source_terminale_id: number
    indirizzo: number
    source_concentratore_id: number
    descrizione: string | null
    gruppo_id: string | null
    passaggi: number
    negati: number
  }>(db, 'accessi_per_varco', { p_dal: dal, p_al: al })
  const anagrafica = new Map(varchi.map((v) => [v.chiave, v]))
  return righe
    .map((r): RigaVarco => {
      const chiave = chiaveVarco(r.source_terminale_id, r.indirizzo, r.source_concentratore_id)
      const noto = anagrafica.get(chiave)
      return {
        chiave,
        terminale: r.source_terminale_id,
        indirizzo: r.indirizzo,
        concentratore: r.source_concentratore_id,
        descrizione: r.descrizione?.trim() || noto?.descrizione || `Varco ${chiave}`,
        gruppoId: r.gruppo_id,
        attivo: noto?.attivo ?? false,
        passaggi: Number(r.passaggi),
        negati: Number(r.negati),
      }
    })
    .sort((a, b) => b.passaggi - a.passaggi)
}

export async function mappaCalore(db: Db, dal: string, al: string, gruppoId: string | null): Promise<CellaCalore[]> {
  const righe = await rpc<{ giorno_settimana: number; ora: number; passaggi: number; giorni: number }>(db, 'accessi_mappa_calore', {
    p_dal: dal,
    p_al: al,
    p_gruppo: gruppoId,
  })
  return righe.map((r) => ({
    giornoSettimana: r.giorno_settimana,
    ora: r.ora,
    passaggi: Number(r.passaggi),
    giorni: Number(r.giorni),
  }))
}

export async function accessiNegati(db: Db, dal: string, al: string): Promise<RigaNegati[]> {
  const righe = await rpc<{ tipo_accesso: number; descrizione: string | null; n: number }>(db, 'accessi_negati', { p_dal: dal, p_al: al })
  return righe.map((r) => ({ tipo: r.tipo_accesso, descrizione: r.descrizione ?? `Esito ${r.tipo_accesso}`, n: Number(r.n) }))
}

export async function fedeltaAccessi(db: Db, dal: string, al: string): Promise<FasciaFedelta[]> {
  const righe = await rpc<{ fascia: string; ordine: number; persone: number }>(db, 'accessi_fedelta', { p_dal: dal, p_al: al })
  return righe.map((r) => ({ fascia: r.fascia, ordine: r.ordine, persone: Number(r.persone) }))
}

export async function sociInattivi(db: Db, giorni: number, limite: number): Promise<SocioInattivo[]> {
  const righe = await rpc<{
    persona_id: string
    nome: string | null
    cognome: string | null
    abbonamento: string | null
    data_fine: string | null
    ultimo_ingresso: string
    giorni_assenza: number
  }>(db, 'accessi_inattivi', { p_giorni: giorni, p_limite: limite })
  return righe.map((r) => ({
    personaId: r.persona_id,
    nome: r.nome,
    cognome: r.cognome,
    abbonamento: r.abbonamento,
    dataFine: r.data_fine,
    ultimoIngresso: r.ultimo_ingresso,
    giorniAssenza: r.giorni_assenza,
  }))
}

// ───────────────────────────────────────────────────────────────── ricerca

export type FiltriRicerca = {
  dal: string
  al: string
  /** source_utente_id delle persone cercate; null = tutte. */
  utenti: number[] | null
  /** Un varco solo, o i varchi di un gruppo: la lista di terne. null = tutti. */
  varchi: { terminale: number; indirizzo: number; concentratore: number }[] | null
  esito: 'ammessi' | 'negati' | 'tutti'
}

export type RigaAccesso = {
  id: number
  utente: number | null
  quando: string
  esito: number
  varcoChiave: string
}

function applicaFiltri<T extends { gte: Function; lt: Function; in: Function; or: Function }>(q: T, f: FiltriRicerca): T {
  let query: any = q
    .gte('data_accesso', mezzanotteRoma(f.dal))
    .lt('data_accesso', mezzanotteRoma(giornoPiu(f.al, 1)))
  if (f.utenti) query = query.in('source_utente_id', f.utenti)
  if (f.varchi) {
    // Una terna è tre colonne: ogni varco è un `and(...)`, e i varchi del
    // gruppo si mettono in `or`.
    const condizioni = f.varchi.map(
      (v) => `and(source_terminale_id.eq.${v.terminale},indirizzo.eq.${v.indirizzo},source_concentratore_id.eq.${v.concentratore})`
    )
    query = query.or(condizioni.length ? condizioni.join(',') : 'source_accesso_id.eq.-1')
  }
  if (f.esito === 'ammessi') query = query.in('tipo_accesso', ESITI_PASSAGGIO)
  else if (f.esito === 'negati') query = query.lt('tipo_accesso', 0)
  return query
}

/** Una pagina di passaggi, dal più recente. Chiede una riga in più per sapere se ce n'è un'altra pagina. */
export async function ricercaAccessi(
  db: Db,
  filtri: FiltriRicerca,
  da: number,
  quanti: number
): Promise<{ righe: RigaAccesso[]; ceAltro: boolean }> {
  const base = db
    .from('accessi')
    .select('source_accesso_id, source_utente_id, data_accesso, tipo_accesso, source_terminale_id, indirizzo, source_concentratore_id')
  const { data, error } = await applicaFiltri(base, filtri)
    .order('data_accesso', { ascending: false })
    .order('source_accesso_id', { ascending: false })
    .range(da, da + quanti)
  controlla(error, 'ricerca')
  const tutte = (data ?? []).map(
    (r): RigaAccesso => ({
      id: r.source_accesso_id,
      utente: r.source_utente_id,
      quando: r.data_accesso,
      esito: r.tipo_accesso,
      varcoChiave: chiaveVarco(r.source_terminale_id, r.indirizzo, r.source_concentratore_id),
    })
  )
  return { righe: tutte.slice(0, quanti), ceAltro: tutte.length > quanti }
}

export type PersonaTrovata = {
  id: string
  nome: string | null
  cognome: string | null
  email: string | null
  cellulare: string | null
  utente: number | null
}

/** Le persone che corrispondono al testo: ogni parola deve comparire in nome, cognome, email o cellulare. */
export async function trovaPersone(db: Db, testo: string, limite = 20): Promise<PersonaTrovata[]> {
  const parole = testo
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    // I caratteri che hanno un significato nei filtri di PostgREST o in ilike.
    .map((p) => p.replace(/[,()%_\\*]/g, ''))
    .filter(Boolean)
  if (parole.length === 0) return []
  let query = db.from('persone').select('id, nome, cognome, email, cellulare, source_utente_id')
  for (const p of parole) {
    const numerica = /^\d+$/.test(p) ? `,source_utente_id.eq.${p}` : ''
    query = query.or(`nome.ilike.%${p}%,cognome.ilike.%${p}%,email.ilike.%${p}%,cellulare.ilike.%${p}%${numerica}`)
  }
  const { data, error } = await query.order('cognome').limit(limite)
  controlla(error, 'persone')
  return (data ?? []).map((p) => ({
    id: p.id,
    nome: p.nome,
    cognome: p.cognome,
    email: p.email,
    cellulare: p.cellulare,
    utente: p.source_utente_id,
  }))
}

/** Nome e scheda delle persone dietro a un insieme di passaggi. */
export async function personeDegliUtenti(db: Db, utenti: number[]): Promise<Map<number, { id: string; nome: string }>> {
  const mappa = new Map<number, { id: string; nome: string }>()
  const unici = [...new Set(utenti)]
  if (unici.length === 0) return mappa
  const { data, error } = await db.from('persone').select('id, nome, cognome, source_utente_id').in('source_utente_id', unici)
  controlla(error, 'persone degli accessi')
  for (const p of data ?? []) {
    mappa.set(p.source_utente_id, { id: p.id, nome: [p.cognome, p.nome].filter(Boolean).join(' ') || 'Senza nome' })
  }
  return mappa
}

/** Quanti giorni diversi è venuto un socio nel periodo, e il suo primo e ultimo ingresso. */
export async function presenzeDiUnUtente(
  db: Db,
  utente: number,
  dal: string,
  al: string
): Promise<{ giorni: number; primo: string | null; ultimo: string | null }> {
  const filtro = () => db.from('accessi_giorni').select('giorno', { count: 'exact' }).eq('source_utente_id', utente).gte('giorno', dal).lte('giorno', al)
  const [totale, primo, ultimo] = await Promise.all([
    filtro().limit(1),
    filtro().order('giorno').limit(1),
    filtro().order('giorno', { ascending: false }).limit(1),
  ])
  controlla(totale.error ?? primo.error ?? ultimo.error, 'presenze')
  return {
    giorni: totale.count ?? 0,
    primo: (primo.data?.[0]?.giorno as string | undefined) ?? null,
    ultimo: (ultimo.data?.[0]?.giorno as string | undefined) ?? null,
  }
}

// ──────────────────────────────────────── i filtri della ricerca, dall'URL

export type ParametriRicerca = {
  periodo?: string
  dal?: string
  al?: string
  q?: string
  persona?: string
  varco?: string
  gruppo?: string
  esito?: string
  p?: string
}

export type RicercaRisolta = {
  periodo: Periodo
  filtri: FiltriRicerca
  /** La persona su cui si cerca, se una sola. */
  persona: PersonaTrovata | null
  /** Più persone corrispondono al testo: bisogna sceglierne una prima di cercare. */
  candidate: PersonaTrovata[]
  /** Il testo scritto non corrisponde a nessuno. */
  nessunaPersona: boolean
  varcoScelto: string | null
  gruppoScelto: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Traduce i parametri dell'URL in filtri sul database. La pagina e
 * l'esportazione CSV passano da qui: così il CSV contiene esattamente le righe
 * che la pagina mostrava. Un varco scelto batte il gruppo; per la persona si
 * usa quella scelta dall'elenco (`persona`) o l'unica che corrisponde al
 * testo (`q`).
 */
export async function risolviRicerca(
  db: Db,
  params: ParametriRicerca,
  oggi: string,
  varchi: Varco[],
  gruppi: Gruppo[]
): Promise<RicercaRisolta> {
  const periodo = periodoDa(params, oggi, '30g')
  const esito = params.esito === 'negati' || params.esito === 'tutti' ? params.esito : 'ammessi'

  let persona: PersonaTrovata | null = null
  let candidate: PersonaTrovata[] = []
  let nessunaPersona = false
  if (params.persona && UUID.test(params.persona)) {
    const { data, error } = await db
      .from('persone')
      .select('id, nome, cognome, email, cellulare, source_utente_id')
      .eq('id', params.persona)
      .maybeSingle()
    controlla(error, 'persona')
    if (data) {
      persona = { id: data.id, nome: data.nome, cognome: data.cognome, email: data.email, cellulare: data.cellulare, utente: data.source_utente_id }
    } else nessunaPersona = true
  } else if (params.q?.trim()) {
    candidate = await trovaPersone(db, params.q)
    if (candidate.length === 1) {
      persona = candidate[0]
      candidate = []
    } else if (candidate.length === 0) nessunaPersona = true
  }

  const varco = leggiChiaveVarco(params.varco)
  const gruppoScelto = !varco && gruppi.some((g) => g.id === params.gruppo) ? (params.gruppo as string) : null
  const varchiFiltrati = varco
    ? [varco]
    : gruppoScelto
      ? varchi.filter((v) => v.gruppoId === gruppoScelto).map((v) => ({ terminale: v.terminale, indirizzo: v.indirizzo, concentratore: v.concentratore }))
      : null

  return {
    periodo,
    filtri: {
      dal: periodo.dal,
      al: periodo.al,
      // Una persona senza numero utente Info4U non ha accessi: -1 non esiste.
      utenti: persona ? [persona.utente ?? -1] : null,
      varchi: varchiFiltrati,
      esito,
    },
    persona,
    candidate,
    nessunaPersona,
    varcoScelto: varco ? chiaveVarco(varco.terminale, varco.indirizzo, varco.concentratore) : null,
    gruppoScelto,
  }
}
