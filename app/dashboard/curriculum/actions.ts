'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { CV_BUCKET, ETICHETTE_STATO, eStatoValido, type StatoCandidatura } from '@/lib/candidature'

// Esito come valore di ritorno e non throw: in produzione Next.js oscura il
// messaggio di un errore lanciato da una Server Action, e qui chi legge deve
// sapere perché il curriculum non si è aperto.
export type EsitoAzione = { ok: true } | { ok: false; errore: string }

const NEGATO = { ok: false as const, errore: 'Non hai il permesso di gestire le candidature.' }

async function operatoreAutorizzato(): Promise<string | null> {
  const email = emailCorrente()
  if (!email) return null
  if (!(await utenteHaSezione('candidature'))) return null
  return email
}

export async function cambiaStato(id: string, stato: string): Promise<EsitoAzione> {
  const email = await operatoreAutorizzato()
  if (!email) return NEGATO
  if (!eStatoValido(stato)) return { ok: false, errore: 'Stato non riconosciuto.' }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('candidature')
    .update({
      stato,
      // Chi ha toccato per ultimo la candidatura e quando: serve a sapere se
      // qualcun altro l'ha già guardata prima di richiamare la persona.
      gestita_da: email,
      gestita_il: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    console.error('Stato candidatura non aggiornato:', error.message)
    return { ok: false, errore: 'Non è stato possibile aggiornare la candidatura.' }
  }

  await registraLog(email, 'candidatura_stato', {
    entita: 'candidature',
    entitaId: id,
    dettagli: { stato: ETICHETTE_STATO[stato as StatoCandidatura] },
  })
  revalidatePath('/dashboard/curriculum')
  return { ok: true }
}

export async function salvaNota(id: string, nota: string): Promise<EsitoAzione> {
  const email = await operatoreAutorizzato()
  if (!email) return NEGATO

  const testo = nota.trim().slice(0, 2000)
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('candidature')
    .update({ note: testo || null })
    .eq('id', id)

  if (error) {
    console.error('Nota candidatura non salvata:', error.message)
    return { ok: false, errore: 'Non è stato possibile salvare la nota.' }
  }

  await registraLog(email, 'candidatura_nota', { entita: 'candidature', entitaId: id })
  revalidatePath('/dashboard/curriculum')
  return { ok: true }
}

/**
 * Link temporaneo per scaricare il curriculum.
 *
 * Il bucket è privato e resta tale: si firma una URL valida un minuto, il
 * tempo di far partire il download. Il nome originale del file viene passato
 * come `download`, così chi scarica si ritrova "CV Mario Rossi.pdf" e non il
 * nome ripulito che sta nello storage.
 */
export async function linkCurriculum(
  id: string
): Promise<{ ok: true; url: string } | { ok: false; errore: string }> {
  const email = await operatoreAutorizzato()
  if (!email) return NEGATO

  const supabase = createSupabaseServiceClient()
  const { data: candidatura, error } = await supabase
    .from('candidature')
    .select('cv_path, cv_nome')
    .eq('id', id)
    .maybeSingle()

  if (error || !candidatura?.cv_path) {
    return { ok: false, errore: 'Questa candidatura non ha un curriculum allegato.' }
  }

  const { data, error: erroreFirma } = await supabase.storage
    .from(CV_BUCKET)
    .createSignedUrl(candidatura.cv_path, 60, { download: candidatura.cv_nome ?? true })

  if (erroreFirma || !data?.signedUrl) {
    console.error('Firma del download CV fallita:', erroreFirma?.message)
    return { ok: false, errore: 'Non è stato possibile aprire il curriculum. Riprova.' }
  }

  // Chi apre un curriculum lascia traccia, come per ogni altro dato personale
  // toccato dal pannello.
  await registraLog(email, 'candidatura_cv_scaricato', { entita: 'candidature', entitaId: id })
  return { ok: true, url: data.signedUrl }
}
