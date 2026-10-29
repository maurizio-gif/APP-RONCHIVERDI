import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { MAX_ESPORTAZIONE, PER_PAGINA, inJson, type FiltriContatti, type Ordine } from '@/lib/contatti-filtri'

// Le letture della pagina Contatti › Filtri. Server-only: usa la service role
// key. Il filtro vero sta nel database (`contatti_filtrati`, vedi
// scripts/sql/2026-10-29-contatti-filtri.sql): qui si chiama e basta.

type Db = ReturnType<typeof createSupabaseServiceClient>

export type RigaContatto = {
  id: string
  nome: string | null
  cognome: string | null
  email: string | null
  cellulare: string | null
  data_nascita: string | null
  /** Il prodotto dell'abbonamento attivo (quello che scade per ultimo). */
  abbonamento: string | null
  fine_abbonamento: string | null
  ultima_scadenza: string | null
  ultimo_accesso: string | null
  lead_stato: string | null
  lead_assegnato: string | null
  lead_creato: string | null
  richieste_da_lavorare: number
  totale: number
}

/** Lo script SQL dei filtri non è stato eseguito: la pagina lo dice invece di rompersi. */
export class ScriptContattiMancante extends Error {
  constructor() {
    super('Manca lo script SQL dei filtri: esegui scripts/sql/2026-10-29-contatti-filtri.sql nel SQL Editor di Supabase.')
  }
}

function controlla(errore: { code?: string; message: string } | null): void {
  if (!errore) return
  if (errore.code === 'PGRST202') throw new ScriptContattiMancante()
  throw new Error(`Contatti, filtri: ${errore.message}`)
}

/** Una pagina di risultati e il totale di chi soddisfa i filtri. */
export async function cercaContatti(
  db: Db,
  filtri: FiltriContatti,
  ordine: Ordine,
  pagina: number
): Promise<{ righe: RigaContatto[]; totale: number }> {
  const { data, error } = await db.rpc('contatti_filtrati', {
    p_f: inJson(filtri),
    p_ordine: ordine,
    p_limite: PER_PAGINA,
    p_offset: (pagina - 1) * PER_PAGINA,
  })
  controlla(error)
  const righe = (data ?? []) as RigaContatto[]
  return { righe, totale: righe.length > 0 ? Number(righe[0].totale) : 0 }
}

/**
 * Tutte le persone che soddisfano i filtri — o solo quelle spuntate (`ids`) —
 * per l'esportazione e per copiare email e cellulari. Un unico jsonb: le 1000
 * righe che PostgREST dà per richiesta sarebbero poche.
 */
export async function contattiPerEsportazione(
  db: Db,
  filtri: FiltriContatti,
  ordine: Ordine,
  ids: string[] = []
): Promise<RigaContatto[]> {
  const { data, error } = await db.rpc('contatti_filtrati_json', {
    p_f: inJson(filtri, ids),
    p_ordine: ordine,
    p_limite: MAX_ESPORTAZIONE,
  })
  controlla(error)
  return (data ?? []) as RigaContatto[]
}
