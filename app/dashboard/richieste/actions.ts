'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { canaleDiRichiesta } from '@/lib/richieste'

export type Esito = { ok: true } | { ok: false; errore: string }

/**
 * Il permesso si verifica sul canale della richiesta, non su una sezione
 * passata dal client: altrimenti chi ha accesso a un solo corso potrebbe
 * chiamare l'azione con l'id di una richiesta altrui e lavorarla.
 */
async function puoLavorare(idRichiesta: string): Promise<boolean> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('form_contatti')
    .select('attivita, settore, origine')
    .eq('id', idRichiesta)
    .maybeSingle()
  if (!data) return false

  const canale = canaleDiRichiesta(data)
  if (!canale) return false

  const sezioni = await getSezioniConsentite(emailCorrente())
  return sezioni.includes(canale.chiave)
}

export async function segnaGestita(id: string, gestito: boolean): Promise<Esito> {
  if (!(await puoLavorare(id))) {
    return { ok: false, errore: 'Questa richiesta non è nelle tue sezioni.' }
  }

  const email = emailCorrente()
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('form_contatti')
    .update({
      gestito,
      gestito_da: gestito ? email : null,
      gestito_il: gestito ? new Date().toISOString() : null,
    })
    .eq('id', id)

  if (error) {
    console.error('Presa in carico non salvata:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a salvare. Riprova.' }
  }

  await registraLog(email, 'contatto_gestito', {
    entita: 'form_contatti',
    entitaId: id,
    dettagli: { gestito },
  })

  revalidatePath('/dashboard/richieste', 'layout')
  revalidatePath('/dashboard/agenda')
  return { ok: true }
}

export async function salvaNota(id: string, nota: string): Promise<Esito> {
  if (!(await puoLavorare(id))) {
    return { ok: false, errore: 'Questa richiesta non è nelle tue sezioni.' }
  }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('form_contatti')
    .update({ note: nota.trim() || null })
    .eq('id', id)

  if (error) return { ok: false, errore: error.message }

  await registraLog(emailCorrente(), 'contatto_nota_salvata', {
    entita: 'form_contatti',
    entitaId: id,
  })

  revalidatePath('/dashboard/richieste', 'layout')
  return { ok: true }
}
