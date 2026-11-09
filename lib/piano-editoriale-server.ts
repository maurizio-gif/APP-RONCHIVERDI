import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { SEZIONE_PIANO_EDITORIALE } from '@/lib/piano-editoriale'

// Chi è chi nel piano editoriale. Server-only: service role key.
//
// - gestisce: la social media manager (staff_users.social_manager) e gli
//   amministratori (puo_invitare). Accettano, spostano e rifiutano le
//   richieste, aggiornano lo stato, inseriscono voci anche con meno preavviso.
// - tutti gli altri con la sezione: vedono il calendario di tutti e
//   modificano solo le proprie richieste, finché sono ancora «richiesta».

export type RuoloPiano = { email: string; gestisce: boolean }

export async function ruoloPiano(): Promise<RuoloPiano | null> {
  const email = emailCorrente()
  if (!email || !(await utenteHaSezione(SEZIONE_PIANO_EDITORIALE))) return null
  const { data } = await createSupabaseServiceClient()
    .from('staff_users')
    .select('social_manager, puo_invitare')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle()
  const riga = data as { social_manager: boolean | null; puo_invitare: boolean | null } | null
  return { email: email.trim().toLowerCase(), gestisce: !!(riga?.social_manager || riga?.puo_invitare) }
}

// La cartella di ciascuno nel bucket: chi registra un file può indicare solo
// file caricati da lui.
export function cartellaPiano(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9._-]/g, '_')
}
