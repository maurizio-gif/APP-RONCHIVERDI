'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'

export type Esito = { ok: true } | { ok: false; errore: string }

/**
 * L'obiettivo del giorno per una commerciale: il numero che sul vecchio
 * foglio si scriveva a mano in una cella. Non si deriva da nessun dato — è
 * una decisione della responsabile, non una misura — quindi vive nella sua
 * tabella (vedi scripts/sql/2026-09-17-triple-pack-e-obiettivi-giornalieri.sql).
 *
 * `goal` null cancella la riga: una cella svuotata dalla responsabile deve
 * tornare vuota, non restare a zero — zero è un obiettivo (chiuso apposta),
 * vuoto è "non ancora deciso".
 */
export async function salvaObiettivoGiornaliero(
  commerciale: string,
  giorno: string,
  goal: number | null
): Promise<Esito> {
  if (!(await utenteHaSezione('core-manager'))) {
    return { ok: false, errore: 'Non hai accesso al Core Manager.' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno)) {
    return { ok: false, errore: 'Giorno non valido.' }
  }

  const supabase = createSupabaseServiceClient()
  const email = emailCorrente()

  if (goal === null) {
    const { error } = await supabase
      .from('obiettivi_giornalieri')
      .delete()
      .eq('commerciale', commerciale)
      .eq('giorno', giorno)
    if (error) return { ok: false, errore: error.message }
  } else {
    if (!Number.isFinite(goal) || goal < 0) {
      return { ok: false, errore: 'Il goal deve essere un numero non negativo.' }
    }
    const { error } = await supabase.from('obiettivi_giornalieri').upsert(
      {
        commerciale,
        giorno,
        goal: Math.round(goal),
        aggiornato_da: email,
        aggiornato_il: new Date().toISOString(),
      },
      { onConflict: 'commerciale,giorno' }
    )
    if (error) {
      if (/obiettivi_giornalieri/.test(error.message)) {
        return {
          ok: false,
          errore:
            'Manca la tabella degli obiettivi: esegui scripts/sql/2026-09-17-triple-pack-e-obiettivi-giornalieri.sql nel SQL Editor.',
        }
      }
      return { ok: false, errore: error.message }
    }
  }

  revalidatePath('/dashboard/core-manager/report')
  return { ok: true }
}
