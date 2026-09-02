import { cache } from 'react'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'

export type RigaStaff = {
  email: string
  nome: string | null
  cognome: string | null
  sezioni_consentite: string[]
  puo_invitare: boolean
  puo_cancellare: boolean
  commerciale: boolean
  puo_riassegnare: boolean
} | null

// La riga di staff_users dell'operatore corrente: chi può vedere cosa,
// amministrare, cancellare, e il nome per l'intestazione.
//
// cache() di React deduplica le chiamate con lo stesso argomento per la
// durata di una richiesta (o dell'esecuzione di una Server Action): senza,
// allowlist, sezioni consentite, nome utente e permessi booleani
// interrogherebbero la stessa riga con la stessa email cinque volte per
// pagina.
export const rigaStaffCorrente = cache(async (email: string | null | undefined): Promise<RigaStaff> => {
  const pulita = email?.trim().toLowerCase()
  if (!pulita) return null

  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('staff_users')
    .select('email, nome, cognome, sezioni_consentite, puo_invitare, puo_cancellare, commerciale, puo_riassegnare')
    .eq('email', pulita)
    .maybeSingle()

  return data as RigaStaff
})
