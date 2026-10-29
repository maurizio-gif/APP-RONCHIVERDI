'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { SEZIONE_TESSERAMENTI } from '@/lib/tesseramenti'

// «Riprova ora»: rimanda a CSI una riga non tesserata senza aspettare il
// giro delle due ore (utile dopo aver corretto un dato in Info4U). La chiamata
// parte dal database (riprova_tesseramento_csi, vedi
// scripts/sql/2026-10-29-tesseramento-csi.sql) ed è asincrona: l'esito si
// legge sulla riga quando la pagina si aggiorna.

export type EsitoRiprova = { ok: true } | { ok: false; errore: string }

// Due clic ravvicinati non devono diventare due invii a CSI.
const SECONDI_FRA_DUE_TENTATIVI = 30

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function riprovaTesseramento(id: string): Promise<EsitoRiprova> {
  const email = emailCorrente()
  if (!email || !(await utenteHaSezione(SEZIONE_TESSERAMENTI))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }
  if (!UUID.test(id)) return { ok: false, errore: 'Tesseramento non riconosciuto.' }

  const supabase = createSupabaseServiceClient()
  const { data: riga, error } = await supabase
    .from('tesseramenti_csi')
    .select('id, persona_id, stato, ultimo_tentativo_il')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('Tesseramenti: riga non letta', error.message)
    return { ok: false, errore: 'Non riesco a leggere il tesseramento. Riprova fra poco.' }
  }
  if (!riga) return { ok: false, errore: 'Questo tesseramento non esiste più.' }
  if (riga.stato === 'tesserato') return { ok: false, errore: 'È già tesserato.' }

  if (riga.ultimo_tentativo_il) {
    const passati = (Date.now() - new Date(riga.ultimo_tentativo_il).getTime()) / 1000
    if (passati < SECONDI_FRA_DUE_TENTATIVI) {
      return { ok: false, errore: 'È appena stato riprovato: aspetta qualche secondo.' }
    }
  }

  const { data: richiesta, error: errChiamata } = await supabase.rpc('riprova_tesseramento_csi', { p_id: id })
  if (errChiamata || richiesta === null) {
    console.error('Tesseramenti: «Riprova ora» non partito', errChiamata?.message)
    return { ok: false, errore: 'Non sono riuscito a far partire il tentativo. Riprova fra poco.' }
  }

  await registraLog(email, 'tesseramento_riprovato', {
    entita: 'tesseramenti_csi',
    entitaId: id,
    dettagli: { persona_id: riga.persona_id },
  })
  revalidatePath('/dashboard/tesseramenti')
  return { ok: true }
}
