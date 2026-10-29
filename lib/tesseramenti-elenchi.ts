import type { SupabaseClient } from '@supabase/supabase-js'
import { leggiPaginato } from '@/lib/supabase/leggiPaginato'
import { vistaDi, VISTE, type RigaTesseramento, type Vista } from '@/lib/tesseramenti'

// Gli elenchi di tesseramenti_csi, per la vista Automazione e per la sua
// esportazione in CSV: la pagina e il file leggono dalla stessa funzione, così
// il file contiene esattamente le righe che si vedono a schermo.

export async function caricaTesseramenti(supabase: SupabaseClient) {
  return leggiPaginato<RigaTesseramento>((da) =>
    supabase
      .from('tesseramenti_csi')
      .select(
        'id, persona_id, stagione, stato, origine, tessera, quota, rilascio, scadenza, tesserato_il, motivo, motivo_tipo, tentativi, ultimo_tentativo_il, codice_attivita, creato_il, persone(nome, cognome, codice_fiscale, data_nascita, email, cellulare), abbonamenti(abbonamento, variante)'
      )
      .order('aggiornato_il', { ascending: false })
      .order('id', { ascending: false })
      .range(da, da + 999) as unknown as PromiseLike<{
      data: RigaTesseramento[] | null
      error: { message: string } | null
    }>
  )
}

export function vistaValida(v: string | undefined): Vista | null {
  return (VISTE as readonly string[]).includes(v ?? '') ? (v as Vista) : null
}

/** Il motivo di una riga come chiave del filtro: `attesa` se non ne ha. */
export const chiaveMotivo = (r: Pick<RigaTesseramento, 'motivo_tipo'>) => r.motivo_tipo ?? 'attesa'

export function elencoDi(righe: RigaTesseramento[], vista: Vista, motivo: string | null): RigaTesseramento[] {
  const nellaVista = righe.filter((r) => vistaDi(r) === vista)
  return motivo ? nellaVista.filter((r) => chiaveMotivo(r) === motivo) : nellaVista
}
