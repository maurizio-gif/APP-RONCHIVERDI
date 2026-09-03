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

/**
 * Riporta una richiesta chiusa fra quelle da lavorare. È il modo di disfare
 * una chiusura sbagliata, e l'unico gesto che tocca `gestito` da qui: la
 * chiusura passa solo da "Chiudi con esito", che scrive anche il perché.
 *
 * Azzera anche l'esito: senza, una richiesta riaperta continuerebbe a
 * mostrare "eseguita" e la nota di chiusura di una lavorazione annullata.
 */
export async function riapriRichiesta(id: string): Promise<Esito> {
  if (!(await puoLavorare(id))) {
    return { ok: false, errore: 'Questa richiesta non è nelle tue sezioni.' }
  }

  const email = emailCorrente()
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('form_contatti')
    .update({
      gestito: false,
      gestito_da: null,
      gestito_il: null,
      esito_tipo: null,
      esito: null,
    })
    .eq('id', id)

  if (error) {
    console.error('Riapertura richiesta non salvata:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a salvare. Riprova.' }
  }

  await registraLog(email, 'contatto_riaperto', {
    entita: 'form_contatti',
    entitaId: id,
  })

  revalidatePath('/dashboard/richieste', 'layout')
  revalidatePath('/dashboard/agenda')
  return { ok: true }
}

// La nota libera su form_contatti.note non si scrive più: la nota è una sola
// ed è quella obbligatoria della chiusura con esito (form_contatti.esito, vedi
// chiudiConEsito). Ce n'erano due nello stesso pannello, e non era chiaro
// quale contasse. Le note già salvate restano leggibili nei dettagli.
