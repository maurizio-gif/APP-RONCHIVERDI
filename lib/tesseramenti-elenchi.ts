import type { SupabaseClient } from '@supabase/supabase-js'
import { leggiPaginato } from '@/lib/supabase/leggiPaginato'
import { VISTA_DI_CATEGORIA, VISTE, oggiRoma, type RigaElenco, type Vista } from '@/lib/tesseramenti'

// Gli elenchi di Tesseramenti, per la vista Elenchi e per la sua esportazione
// in CSV: la pagina e il file leggono dalla stessa funzione del database
// (tesseramenti_elenco), così il file contiene esattamente le righe che si
// vedono a schermo. L'elenco è dinamico: si ricalcola a ogni apertura da
// abbonamenti in corso, tessere CSI e dati in anagrafica.

export async function caricaElenco(supabase: SupabaseClient) {
  const { righe, error } = await leggiPaginato<RigaElenco>((da) =>
    supabase.rpc('tesseramenti_elenco').range(da, da + 999) as unknown as PromiseLike<{
      data: RigaElenco[] | null
      error: { message: string } | null
    }>
  )
  if (error) return { righe, error }
  // Pagina e CSV leggono da qui: i doppioni restano fuori da entrambi.
  const senza = senzaDoppioni(righe)
  return { righe: await conEsitoInvio(supabase, senza), error }
}

/**
 * Due cose che la funzione del database non sa, perché la tessera arriva
 * nell'archivio CSI solo con la lettura oraria:
 * - chi è stato tesserato da qui (riga «tesserato» con la scadenza in corso) passa
 *   subito fra i tesserati, senza aspettare la lettura successiva;
 * - per chi non è tesserato, la risposta di CSI all'ultimo tentativo, se rifiutato.
 */
async function conEsitoInvio(supabase: SupabaseClient, righe: RigaElenco[]): Promise<RigaElenco[]> {
  const ids = righe.filter((r) => r.riga_id && vistaDi(r) !== 'tesserati').map((r) => r.riga_id as string)
  if (ids.length === 0) return righe

  const emesse = new Map<string, { tessera: string | null; rilascio: string | null; scadenza: string | null }>()
  const ultimoEsito = new Map<string, { errore: string | null; il: string }>()
  const oggi = oggiRoma()

  for (let i = 0; i < ids.length; i += 200) {
    const blocco = ids.slice(i, i + 200)
    const [{ data: tesseramenti }, { data: tentativi }] = await Promise.all([
      supabase.from('tesseramenti_csi').select('id, stato, tessera, rilascio, scadenza').in('id', blocco).eq('stato', 'tesserato'),
      supabase
        .from('tesseramenti_csi_tentativi')
        .select('tesseramento_id, esito, errore, creato_il')
        .in('tesseramento_id', blocco)
        .order('creato_il', { ascending: false }),
    ])
    for (const t of tesseramenti ?? []) {
      if (t.tessera && t.scadenza && t.scadenza >= oggi) {
        emesse.set(t.id, { tessera: t.tessera, rilascio: t.rilascio, scadenza: t.scadenza })
      }
    }
    for (const a of tentativi ?? []) {
      if (!ultimoEsito.has(a.tesseramento_id)) {
        ultimoEsito.set(a.tesseramento_id, { errore: a.esito === 'OK' ? null : (a.errore ?? 'Errore di CSI.'), il: a.creato_il })
      }
    }
  }

  return righe.map((r) => {
    if (!r.riga_id || vistaDi(r) === 'tesserati') return r
    const tessera = emesse.get(r.riga_id)
    if (tessera) {
      return { ...r, categoria: 'tesserato', tessera: tessera.tessera, tessera_rilascio: tessera.rilascio, tessera_scadenza: tessera.scadenza, motivo_tipo: null, motivo: null }
    }
    const esito = ultimoEsito.get(r.riga_id)
    return esito?.errore ? { ...r, ultimo_errore: esito.errore, ultimo_errore_il: esito.il } : r
  })
}

export function vistaValida(v: string | undefined | null): Vista | null {
  return (VISTE as readonly string[]).includes(v ?? '') ? (v as Vista) : null
}

/** Il motivo di una riga come chiave del filtro. */
export const chiaveMotivo = (r: Pick<RigaElenco, 'motivo_tipo'>) => r.motivo_tipo ?? 'attesa'

export const vistaDi = (r: Pick<RigaElenco, 'categoria'>): Vista => VISTA_DI_CATEGORIA[r.categoria] ?? 'da_tesserare'

const normalizza = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/** Cerca per parole su cognome, nome, codice fiscale e numero di tessera. */
export function corrisponde(r: RigaElenco, q: string): boolean {
  const parole = normalizza(q).split(/\s+/).filter(Boolean)
  if (parole.length === 0) return true
  const testo = normalizza([r.cognome, r.nome, r.codice_fiscale, r.tessera].filter(Boolean).join(' '))
  return parole.every((p) => testo.includes(p))
}

const cfDi = (r: Pick<RigaElenco, 'codice_fiscale'>) => (r.codice_fiscale ?? '').trim().toUpperCase()

/**
 * Toglie i doppioni in anagrafica: chi sta fra i «da tesserare» ma ha lo stesso
 * codice fiscale di un'altra scheda che ha già la tessera CSI. La tessera è
 * legata alla scheda più vecchia, e la scheda doppia non va tesserata (si
 * risolve unendo le schede in Info4U).
 */
export function senzaDoppioni(righe: RigaElenco[]): RigaElenco[] {
  const conTessera = new Map<string, string>()
  for (const r of righe) {
    if (vistaDi(r) === 'tesserati' && cfDi(r).length === 16) conTessera.set(cfDi(r), r.persona_id)
  }
  return righe.filter((r) => {
    if (vistaDi(r) === 'tesserati') return true
    const altra = conTessera.get(cfDi(r))
    return !(altra && altra !== r.persona_id)
  })
}

export function elencoDi(righe: RigaElenco[], vista: Vista, motivo: string | null, q = ''): RigaElenco[] {
  return righe.filter(
    (r) => vistaDi(r) === vista && (!motivo || chiaveMotivo(r) === motivo) && corrisponde(r, q)
  )
}
