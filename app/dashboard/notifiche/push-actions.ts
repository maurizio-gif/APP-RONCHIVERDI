'use server'

import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { SEZIONE_NOTIFICHE } from '@/lib/notifiche'
import type { EsitoAzione } from './actions'

type SottoscrizioneDalBrowser = { endpoint: string; keys: { p256dh: string; auth: string } }

/**
 * Registra il dispositivo su cui l'operatore ha appena acceso le push.
 *
 * Una riga per dispositivo (l'endpoint è univoco per browser/installazione) e
 * non per persona: la stessa persona attiva le notifiche sul telefono e sul
 * computer e le riceve su entrambi.
 */
export async function salvaSottoscrizionePush(
  sottoscrizione: SottoscrizioneDalBrowser
): Promise<EsitoAzione> {
  const email = emailCorrente()
  if (!email) return { ok: false, errore: 'Sessione non valida: ricarica la pagina e riprova.' }
  if (!(await utenteHaSezione(SEZIONE_NOTIFICHE))) {
    return { ok: false, errore: 'Non hai il permesso di ricevere messaggi interni.' }
  }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      email,
      endpoint: sottoscrizione.endpoint,
      p256dh: sottoscrizione.keys.p256dh,
      auth: sottoscrizione.keys.auth,
    },
    // Riattivare le notifiche sullo stesso dispositivo aggiorna la riga
    // esistente: le chiavi cambiano a ogni nuova sottoscrizione, l'endpoint no.
    { onConflict: 'endpoint' }
  )

  if (error) {
    console.error('Sottoscrizione push non salvata:', error.message)
    return { ok: false, errore: 'Non è stato possibile registrare questo dispositivo.' }
  }

  return { ok: true }
}

export async function rimuoviSottoscrizionePush(endpoint: string): Promise<EsitoAzione> {
  const email = emailCorrente()
  if (!email) return { ok: false, errore: 'Sessione non valida: ricarica la pagina e riprova.' }

  const supabase = createSupabaseServiceClient()
  // Il filtro sull'email oltre che sull'endpoint: così spedire un endpoint
  // altrui non spegne le notifiche di un collega.
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('email', email)

  if (error) {
    console.error('Sottoscrizione push non rimossa:', error.message)
    return { ok: false, errore: 'Non è stato possibile disattivare le notifiche su questo dispositivo.' }
  }

  return { ok: true }
}
