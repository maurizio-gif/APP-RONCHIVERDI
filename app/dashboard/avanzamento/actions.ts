'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { TIPI_AGGIORNAMENTO, trovaPasso, type TipoAggiornamento } from '@/lib/avanzamento'

export type EsitoAzione = { ok: true } | { ok: false; errore: string }

/**
 * Segna fatto, riapre o annota un passo. Lo può fare chiunque abbia la
 * sezione, anche su un passo di un collega: chi l'ha fatto resta scritto
 * accanto, e a fine riunione è spesso uno solo a spuntare per tutti.
 * Riaprire chiede il perché, come una nota.
 */
export async function aggiornaPasso(passo: string, tipo: string, testo: string): Promise<EsitoAzione> {
  const email = emailCorrente()
  if (!email || !(await utenteHaSezione('avanzamento'))) {
    return { ok: false, errore: 'Non hai il permesso di aggiornare l’avanzamento.' }
  }
  const definizione = trovaPasso(passo)
  if (!definizione) return { ok: false, errore: 'Passo non riconosciuto.' }
  if (!(TIPI_AGGIORNAMENTO as readonly string[]).includes(tipo)) {
    return { ok: false, errore: 'Operazione non riconosciuta.' }
  }
  const pulito = testo.trim().slice(0, 2000)
  if ((tipo === 'nota' || tipo === 'riaperto') && !pulito) {
    return { ok: false, errore: tipo === 'nota' ? 'Scrivi la nota.' : 'Scrivi perché lo riapri.' }
  }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('avanzamento_aggiornamenti').insert({
    passo,
    email: email.trim().toLowerCase(),
    tipo: tipo as TipoAggiornamento,
    testo: pulito || null,
  })
  if (error) {
    console.error('Aggiornamento avanzamento non salvato:', error.message)
    return { ok: false, errore: 'Non è stato possibile salvare. Riprova.' }
  }

  await registraLog(email, `avanzamento_${tipo}`, {
    entita: 'avanzamento',
    entitaId: passo,
    dettagli: { titolo: definizione.titolo },
  })
  revalidatePath('/dashboard/avanzamento')
  return { ok: true }
}
