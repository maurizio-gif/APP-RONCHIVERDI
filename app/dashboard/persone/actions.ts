'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'

export type Esito = { ok: true } | { ok: false; errore: string }

export async function salvaNotaPersona(id: string, nota: string): Promise<Esito> {
  if (!(await utenteHaSezione('persone'))) {
    return { ok: false, errore: 'Non hai accesso all’anagrafica.' }
  }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('persone')
    .update({ note: nota.trim() || null, aggiornato_il: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('Nota persona non salvata:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a salvare la nota. Riprova.' }
  }

  await registraLog(emailCorrente(), 'persona_nota_salvata', { entita: 'persone', entitaId: id })
  revalidatePath('/dashboard/persone', 'layout')
  return { ok: true }
}

/**
 * Corregge nome e cognome in anagrafica. Email e cellulare non si toccano da
 * qui: sono le chiavi con cui il database riconosce la persona, e cambiarle a
 * mano spezzerebbe il collegamento con le richieste future — quelle vanno
 * corrette alla fonte, sul form.
 */
export async function salvaNomePersona(id: string, nome: string, cognome: string): Promise<Esito> {
  if (!(await utenteHaSezione('persone'))) {
    return { ok: false, errore: 'Non hai accesso all’anagrafica.' }
  }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('persone')
    .update({
      nome: nome.trim() || null,
      cognome: cognome.trim() || null,
      aggiornato_il: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return { ok: false, errore: error.message }

  await registraLog(emailCorrente(), 'persona_nome_corretto', {
    entita: 'persone',
    entitaId: id,
    dettagli: { nome, cognome },
  })
  revalidatePath('/dashboard/persone', 'layout')
  return { ok: true }
}
