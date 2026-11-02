'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { SEZIONE_TESSERAMENTI, azioneConsigliata, type MotivoTipo } from '@/lib/tesseramenti'

// «Riprova ora»: rimanda a CSI una riga non tesserata senza aspettare il
// giro delle due ore (utile dopo aver corretto un dato in Info4U). La chiamata
// parte dal database (riprova_tesseramento_csi, vedi
// scripts/sql/2026-10-29-tesseramento-csi.sql) ed è asincrona, ma l'azione
// aspetta che la riga venga lavorata e restituisce subito l'esito: la tessera
// emessa, oppure l'errore con cosa fare per correggerlo.

export type EsitoRiprova =
  | { ok: true; esito: 'tesserato'; tessera: string | null }
  | { ok: true; esito: 'errore'; errore: string; azione: string | null }
  | { ok: true; esito: 'in_corso' }
  | { ok: false; errore: string }

// Quanto aspettare la risposta di CSI (una chiamata ne dura 1-3, con la lettura
// preventiva due) prima di dire che è ancora in corso.
const ATTESA_MASSIMA_MS = 25_000
const PAUSA_LETTURA_MS = 1000

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

  // Un margine per lo scarto fra gli orologi di questo server e della function.
  const partita = new Date(Date.now() - 5000)
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

  // Il tentativo è concluso quando la riga è stata presa dopo il clic
  // (ultimo_tentativo_il) e poi riscritta con l'esito (aggiornato_il più tardi).
  const fine = Date.now() + ATTESA_MASSIMA_MS
  while (Date.now() < fine) {
    await new Promise((r) => setTimeout(r, PAUSA_LETTURA_MS))
    const { data: ora } = await supabase
      .from('tesseramenti_csi')
      .select('stato, tessera, motivo, motivo_tipo, ultimo_tentativo_il, aggiornato_il')
      .eq('id', id)
      .maybeSingle()
    if (!ora?.ultimo_tentativo_il || new Date(ora.ultimo_tentativo_il) < partita) continue
    if (new Date(ora.aggiornato_il) <= new Date(ora.ultimo_tentativo_il)) continue

    revalidatePath('/dashboard/tesseramenti')
    if (ora.stato === 'tesserato') return { ok: true, esito: 'tesserato', tessera: ora.tessera }
    if (ora.stato === 'simulato') {
      return { ok: true, esito: 'errore', errore: 'CSI è in simulazione: nessuna tessera è stata emessa.', azione: 'Controlla che il segreto CSI_LIVE valga 1 su Supabase.' }
    }
    const motivoTipo = ora.motivo_tipo as MotivoTipo | null
    return {
      ok: true,
      esito: 'errore',
      errore: ora.motivo ?? 'CSI non ha tesserato la persona.',
      azione: azioneConsigliata({ motivo_tipo: motivoTipo, mancanti: null, ultimo_errore: ora.motivo }),
    }
  }
  revalidatePath('/dashboard/tesseramenti')
  return { ok: true, esito: 'in_corso' }
}
