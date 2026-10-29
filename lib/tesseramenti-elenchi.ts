import type { SupabaseClient } from '@supabase/supabase-js'
import { leggiPaginato } from '@/lib/supabase/leggiPaginato'
import { VISTA_DI_CATEGORIA, VISTE, type RigaElenco, type Vista } from '@/lib/tesseramenti'

// Gli elenchi di Tesseramenti, per la vista Elenchi e per la sua esportazione
// in CSV: la pagina e il file leggono dalla stessa funzione del database
// (tesseramenti_elenco), così il file contiene esattamente le righe che si
// vedono a schermo. L'elenco è dinamico: si ricalcola a ogni apertura da
// abbonamenti in corso, tessere CSI e dati in anagrafica.

export async function caricaElenco(supabase: SupabaseClient) {
  return leggiPaginato<RigaElenco>((da) =>
    supabase.rpc('tesseramenti_elenco').range(da, da + 999) as unknown as PromiseLike<{
      data: RigaElenco[] | null
      error: { message: string } | null
    }>
  )
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

export function elencoDi(righe: RigaElenco[], vista: Vista, motivo: string | null, q = ''): RigaElenco[] {
  return righe.filter(
    (r) => vistaDi(r) === vista && (!motivo || chiaveMotivo(r) === motivo) && corrisponde(r, q)
  )
}
