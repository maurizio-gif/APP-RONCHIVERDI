'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'

export type Esito = { ok: true } | { ok: false; errore: string }

/**
 * L'obiettivo di fatturato del mese: un numero deciso dalla direzione, non
 * misurato — vedi scripts/sql/2026-09-18-abbonamenti-obiettivo-mensile.sql.
 * `goal` null cancella la riga (obiettivo non ancora deciso, diverso da "0").
 */
export async function salvaObiettivoMensile(mese: string, goal: number | null): Promise<Esito> {
  if (!(await utenteHaSezione('abbonamenti'))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }
  if (!/^\d{4}-\d{2}-01$/.test(mese)) {
    return { ok: false, errore: 'Mese non valido.' }
  }

  const supabase = createSupabaseServiceClient()

  if (goal === null) {
    const { error } = await supabase.from('abbonamenti_obiettivi_mensili').delete().eq('mese', mese)
    if (error) return { ok: false, errore: error.message }
  } else {
    if (!Number.isFinite(goal) || goal < 0) {
      return { ok: false, errore: "L'obiettivo deve essere un numero non negativo." }
    }
    const { error } = await supabase.from('abbonamenti_obiettivi_mensili').upsert(
      {
        mese,
        goal: Math.round(goal * 100) / 100,
        aggiornato_da: emailCorrente(),
        aggiornato_il: new Date().toISOString(),
      },
      { onConflict: 'mese' }
    )
    if (error) {
      if (/abbonamenti_obiettivi_mensili/.test(error.message)) {
        return {
          ok: false,
          errore:
            "Manca la tabella dell'obiettivo: esegui scripts/sql/2026-09-18-abbonamenti-obiettivo-mensile.sql nel SQL Editor.",
        }
      }
      return { ok: false, errore: error.message }
    }
  }

  revalidatePath('/dashboard/abbonamenti')
  return { ok: true }
}
