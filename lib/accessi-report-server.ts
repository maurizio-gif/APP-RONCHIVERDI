import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { chiaveVarco, periodoDa, type Gruppo, type Varco } from '@/lib/accessi'
import { caricaGruppiAccessi, caricaVarchi, trovaPersone, type PersonaTrovata } from '@/lib/accessi-server'
import {
  MASSIMO_PERSONE_FILE,
  intervalloPredefinito,
  personeDaParametri,
  primo,
  varchiDaParametri,
  type ParametriReport,
  type PersonaScelta,
  type ReportAccessi,
  type RigaDettaglioReport,
  type RigaPersonaReport,
} from '@/lib/accessi-report'

// Le letture del report per ingresso e per nominativo. Server-only: usa la
// service role key. Passa dalle funzioni di scripts/sql/2026-10-29-accessi-report.sql
// (mai da `accessi`, 3,4 milioni di righe).

export class ScriptReportMancante extends Error {
  constructor() {
    super('Manca lo script SQL del report: esegui scripts/sql/2026-10-29-accessi-report.sql nel SQL Editor di Supabase.')
  }
}

type Db = ReturnType<typeof createSupabaseServiceClient>

const BLOCCO = 1000

function controlla(errore: { code?: string; message: string } | null, nome: string): void {
  if (!errore) return
  if (errore.code === 'PGRST202' || errore.code === '42P01' || errore.code === 'PGRST205') throw new ScriptReportMancante()
  throw new Error(`Report accessi, ${nome}: ${errore.message}`)
}

/** PostgREST dà al massimo 1000 righe per richiesta: si legge a blocchi. */
async function rpcTutte<T>(db: Db, funzione: string, argomenti: Record<string, unknown>, massimo = 100000): Promise<T[]> {
  const righe: T[] = []
  for (let da = 0; da < massimo; da += BLOCCO) {
    const { data, error } = await db.rpc(funzione, argomenti).range(da, da + BLOCCO - 1)
    controlla(error, funzione)
    const blocco = (data ?? []) as T[]
    righe.push(...blocco)
    if (blocco.length < BLOCCO) break
  }
  return righe
}

async function rpcUno(db: Db, funzione: string, argomenti: Record<string, unknown>): Promise<Record<string, number>> {
  const { data, error } = await db.rpc(funzione, argomenti)
  controlla(error, funzione)
  return (data ?? {}) as Record<string, number>
}

function nomeCompleto(p: { nome?: string | null; cognome?: string | null; email?: string | null; cellulare?: string | null }): string {
  return [p.cognome, p.nome].filter(Boolean).join(' ') || p.email || p.cellulare || 'Senza nome'
}

/** Le persone dietro a un elenco di numeri utente, a blocchi (l'URL di una richiesta non è infinito). */
async function personePerUtenti(db: Db, utenti: number[]): Promise<Map<number, { id: string; nome: string }>> {
  const mappa = new Map<number, { id: string; nome: string }>()
  const unici = [...new Set(utenti)]
  for (let i = 0; i < unici.length; i += 200) {
    const { data, error } = await db
      .from('persone')
      .select('id, nome, cognome, email, cellulare, source_utente_id')
      .in('source_utente_id', unici.slice(i, i + 200))
    controlla(error, 'persone')
    for (const p of data ?? []) mappa.set(p.source_utente_id, { id: p.id, nome: nomeCompleto(p) })
  }
  return mappa
}

async function personePerId(db: Db, ids: string[]): Promise<PersonaScelta[]> {
  if (ids.length === 0) return []
  const { data, error } = await db.from('persone').select('id, nome, cognome, email, cellulare, source_utente_id').in('id', ids)
  controlla(error, 'persone scelte')
  const trovate = new Map((data ?? []).map((p) => [p.id as string, p]))
  // Nell'ordine in cui sono state scelte.
  return ids.flatMap((id) => {
    const p = trovate.get(id)
    return p ? [{ id: p.id as string, nome: nomeCompleto(p), utente: (p.source_utente_id as number | null) ?? null }] : []
  })
}

export type RicercaReport = {
  report: ReportAccessi
  gruppi: Gruppo[]
  varchi: Varco[]
  /** Più persone corrispondono al testo cercato: si sceglie con un link. */
  candidate: PersonaTrovata[]
  /** Il testo cercato non corrisponde a nessuno. */
  nessunaPersona: boolean
  /** Gli id delle persone scelte, compresa quella aggiunta dal testo se era una sola. */
  personeScelte: string[]
}

/**
 * Traduce i parametri dell'URL e legge il report. La pagina e le
 * esportazioni passano da qui, così il file contiene gli stessi numeri
 * della pagina. `limitePersone` taglia la tabella per nominativo (poche righe
 * a schermo, tutte nel file).
 */
export async function caricaReportAccessi(
  db: Db,
  params: ParametriReport,
  oggi: string,
  limitePersone: number = MASSIMO_PERSONE_FILE
): Promise<RicercaReport> {
  const [gruppi, varchi] = await Promise.all([caricaGruppiAccessi(db), caricaVarchi(db)])

  const predefinito = intervalloPredefinito(oggi)
  const periodo = periodoDa({ dal: primo(params.dal) ?? predefinito.dal, al: primo(params.al) ?? predefinito.al }, oggi, '30g')

  const varchiChiesti = varchiDaParametri(params.varco)
  const varchiScelti = varchiChiesti.length > 0 ? varchiChiesti : null

  // Le persone: quelle già scelte, più quella del testo se è una sola.
  const idScelti = personeDaParametri(params.persona)
  let candidate: PersonaTrovata[] = []
  let nessunaPersona = false
  const testo = primo(params.q)?.trim()
  if (testo) {
    const trovate = await trovaPersone(db, testo)
    if (trovate.length === 1) {
      if (!idScelti.includes(trovate[0].id)) idScelti.push(trovate[0].id)
    } else if (trovate.length === 0) nessunaPersona = true
    else candidate = trovate.filter((c) => !idScelti.includes(c.id))
  }
  const persone = await personePerId(db, idScelti)
  const personeScelte = persone.map((p) => p.id)
  // Una persona senza numero utente Info4U non ha accessi: -1 non esiste.
  const utenti = persone.length > 0 ? persone.map((p) => p.utente ?? -1) : null

  const argomenti = { p_dal: periodo.dal, p_al: periodo.al, p_varchi: varchiScelti, p_utenti: utenti }
  const [totali, giorni, perVarco, perPersona, dettaglio] = await Promise.all([
    rpcUno(db, 'accessi_report_totali', argomenti),
    rpcTutte<{ giorno: string; passaggi: number; teste: number }>(db, 'accessi_report_giorni', argomenti),
    rpcTutte<{ source_terminale_id: number; indirizzo: number; source_concentratore_id: number; passaggi: number; teste: number }>(
      db,
      'accessi_report_varchi',
      argomenti
    ),
    rpcTutte<{ source_utente_id: number; passaggi: number; giorni: number; varchi: number }>(
      db,
      'accessi_report_persone',
      // Una riga in più per sapere se ce ne sono altre.
      { ...argomenti, p_limite: limitePersone + 1 },
      limitePersone + 1
    ),
    utenti
      ? rpcTutte<{
          source_utente_id: number
          giorno: string
          source_terminale_id: number
          indirizzo: number
          source_concentratore_id: number
          passaggi: number
        }>(db, 'accessi_report_dettaglio', argomenti)
      : Promise.resolve(null),
  ])

  const troncate = perPersona.length > limitePersone
  const righePersone = perPersona.slice(0, limitePersone)
  const nomiUtenti = await personePerUtenti(db, righePersone.map((p) => p.source_utente_id))

  const varcoDi = new Map(varchi.map((v) => [v.chiave, v]))
  const gruppoDi = new Map(gruppi.map((g) => [g.id, g.nome]))
  const descrizioneVarco = (chiave: string) => varcoDi.get(chiave)?.descrizione ?? `Varco ${chiave}`

  const elencoPersone: RigaPersonaReport[] = righePersone.map((p) => {
    const nota = nomiUtenti.get(p.source_utente_id)
    return {
      utente: p.source_utente_id,
      personaId: nota?.id ?? null,
      nome: nota?.nome ?? `Utente ${p.source_utente_id}`,
      passaggi: Number(p.passaggi),
      giorni: Number(p.giorni),
      varchi: Number(p.varchi),
    }
  })

  let righeDettaglio: RigaDettaglioReport[] | null = null
  if (dettaglio) {
    const nomePerUtente = new Map(persone.map((p) => [p.utente, p.nome]))
    righeDettaglio = dettaglio.map((d) => ({
      nome: nomePerUtente.get(d.source_utente_id) ?? `Utente ${d.source_utente_id}`,
      giorno: d.giorno,
      ingresso: descrizioneVarco(chiaveVarco(d.source_terminale_id, d.indirizzo, d.source_concentratore_id)),
      passaggi: Number(d.passaggi),
    }))
  }

  const report: ReportAccessi = {
    dal: periodo.dal,
    al: periodo.al,
    varchiScelti,
    nomiVarchiScelti: (varchiScelti ?? []).map(descrizioneVarco),
    persone: persone.length > 0 ? persone : null,
    totali: {
      passaggi: Number(totali.passaggi ?? 0),
      teste: Number(totali.teste ?? 0),
      visite: Number(totali.visite ?? 0),
      giorniAperti: Number(totali.giorni_aperti ?? 0),
    },
    giorni: giorni.map((g) => ({ giorno: g.giorno, passaggi: Number(g.passaggi), teste: Number(g.teste) })),
    perVarco: perVarco.map((v) => {
      const chiave = chiaveVarco(v.source_terminale_id, v.indirizzo, v.source_concentratore_id)
      const noto = varcoDi.get(chiave)
      return {
        chiave,
        descrizione: descrizioneVarco(chiave),
        gruppo: noto?.gruppoId ? (gruppoDi.get(noto.gruppoId) ?? null) : null,
        passaggi: Number(v.passaggi),
        teste: Number(v.teste),
      }
    }),
    perPersona: elencoPersone,
    personeTroncate: troncate,
    dettaglio: righeDettaglio,
  }

  return { report, gruppi, varchi, candidate, nessunaPersona, personeScelte }
}
