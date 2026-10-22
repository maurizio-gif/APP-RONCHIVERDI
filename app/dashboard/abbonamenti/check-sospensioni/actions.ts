'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { LUNGHEZZA_MASSIMA_MOTIVO, SEZIONE_CHECK_SOSPENSIONI, type MotivoSospensione } from '@/lib/sospensioni'

// Il motivo di una sospensione (vedi scripts/sql/2026-10-22-check-sospensioni.sql).
// Si aggiunge e basta: la tabella rifiuta modifiche e cancellazioni, quindi
// la prima nota è il motivo e le successive sono rettifiche. Lo scrive
// chiunque abbia la sezione, anche per un collega: l'autore resta il suo.

export type EsitoMotivo = { ok: true; nota: MotivoSospensione } | { ok: false; errore: string }

export async function aggiungiMotivoSospensione(sourceLogId: number, testo: string): Promise<EsitoMotivo> {
  const email = emailCorrente()
  if (!email || !(await utenteHaSezione(SEZIONE_CHECK_SOSPENSIONI))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }
  if (!Number.isInteger(sourceLogId) || sourceLogId <= 0) return { ok: false, errore: 'Sospensione non riconosciuta.' }

  const pulito = testo.trim()
  if (!pulito) return { ok: false, errore: 'Scrivi il motivo.' }
  if (pulito.length > LUNGHEZZA_MASSIMA_MOTIVO) {
    return { ok: false, errore: `Il motivo è troppo lungo (massimo ${LUNGHEZZA_MASSIMA_MOTIVO} caratteri).` }
  }

  const supabase = createSupabaseServiceClient()
  // Si legge dalla vista, non dal registro intero: si può motivare solo una
  // sospensione che la pagina mostra.
  const { data: proroga, error: erroreProroga } = await supabase
    .from('check_sospensioni')
    .select('source_log_id, source_iscrizione_id')
    .eq('source_log_id', sourceLogId)
    .maybeSingle()
  if (erroreProroga) {
    console.error('Check sospensioni: proroga non letta', erroreProroga.message)
    return { ok: false, errore: 'Non riesco a salvare adesso. Riprova fra poco.' }
  }
  if (!proroga) return { ok: false, errore: 'Questa sospensione non è più nell’elenco.' }

  const { data, error } = await supabase
    .from('sospensioni_motivi')
    .insert({
      source_log_id: sourceLogId,
      source_iscrizione_id: (proroga as { source_iscrizione_id: number | null }).source_iscrizione_id,
      testo: pulito,
      autore: email.trim().toLowerCase(),
    })
    .select('id, testo, autore, creato_il')
    .single()
  if (error || !data) {
    console.error('Check sospensioni: motivo non salvato', error?.message)
    return { ok: false, errore: 'Non è stato possibile salvare il motivo.' }
  }

  revalidatePath('/dashboard/abbonamenti/check-sospensioni')
  revalidatePath('/dashboard/abbonamenti/scadenze-spostate')
  return { ok: true, nota: data as MotivoSospensione }
}
