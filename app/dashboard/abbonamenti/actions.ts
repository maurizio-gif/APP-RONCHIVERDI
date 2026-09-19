'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'

export type Esito = { ok: true } | { ok: false; errore: string }

function erroreMigrazioneObiettivo(messaggio: string): string {
  if (/abbonamenti_obiettivi_mensili|gruppo_id/.test(messaggio)) {
    return "Manca la colonna del gruppo sull'obiettivo: esegui scripts/sql/2026-09-19-obiettivo-mensile-per-gruppo.sql nel SQL Editor."
  }
  return messaggio
}

/**
 * L'obiettivo di fatturato del mese: un numero deciso dalla direzione, non
 * misurato — vedi scripts/sql/2026-09-18-abbonamenti-obiettivo-mensile.sql e
 * scripts/sql/2026-09-19-obiettivo-mensile-per-gruppo.sql.
 *
 * `gruppoId` null è il generale (il totale), non nessun gruppo: la stessa
 * data può avere un obiettivo generale e uno per ciascun gruppo, righe
 * distinte — vedi la migration per come si distinguono senza una primary key
 * su `mese` da sola.
 *
 * `goal` null cancella la riga di questo contesto (obiettivo non ancora
 * deciso, diverso da "0").
 */
export async function salvaObiettivoMensile(
  mese: string,
  gruppoId: string | null,
  goal: number | null
): Promise<Esito> {
  if (!(await utenteHaSezione('abbonamenti'))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }
  if (!/^\d{4}-\d{2}-01$/.test(mese)) {
    return { ok: false, errore: 'Mese non valido.' }
  }

  const supabase = createSupabaseServiceClient()

  if (goal === null) {
    let query = supabase.from('abbonamenti_obiettivi_mensili').delete().eq('mese', mese)
    query = gruppoId ? query.eq('gruppo_id', gruppoId) : query.is('gruppo_id', null)
    const { error } = await query
    if (error) return { ok: false, errore: erroreMigrazioneObiettivo(error.message) }
  } else {
    if (!Number.isFinite(goal) || goal < 0) {
      return { ok: false, errore: "L'obiettivo deve essere un numero non negativo." }
    }

    // Niente upsert nativo: mese da solo non è più la chiave (vedi la
    // migration), e la stessa data ha una riga generale e una per ogni
    // gruppo. Si cerca la riga di questo contesto specifico e si aggiorna,
    // altrimenti se ne crea una.
    let queryLettura = supabase.from('abbonamenti_obiettivi_mensili').select('id').eq('mese', mese)
    queryLettura = gruppoId ? queryLettura.eq('gruppo_id', gruppoId) : queryLettura.is('gruppo_id', null)
    const { data: esistente, error: erroreLettura } = await queryLettura.maybeSingle()
    if (erroreLettura) return { ok: false, errore: erroreMigrazioneObiettivo(erroreLettura.message) }

    const riga = {
      mese,
      gruppo_id: gruppoId,
      goal: Math.round(goal * 100) / 100,
      aggiornato_da: emailCorrente(),
      aggiornato_il: new Date().toISOString(),
    }

    const { error } = esistente
      ? await supabase.from('abbonamenti_obiettivi_mensili').update(riga).eq('id', esistente.id)
      : await supabase.from('abbonamenti_obiettivi_mensili').insert(riga)

    if (error) return { ok: false, errore: erroreMigrazioneObiettivo(error.message) }
  }

  revalidatePath('/dashboard/abbonamenti')
  return { ok: true }
}
