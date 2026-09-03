import { cache } from 'react'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'

// Lanciata quando la query su staff_users non riesce: distingue un guasto di
// configurazione o di rete da un'email semplicemente non autorizzata.
export class ErroreStaffUsers extends Error {
  constructor(dettaglio: string) {
    super(`Controllo staff_users non riuscito: ${dettaglio}`)
    this.name = 'ErroreStaffUsers'
  }
}

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
  const { data, error } = await supabase
    .from('staff_users')
    .select('email, nome, cognome, sezioni_consentite, puo_invitare, puo_cancellare, commerciale, puo_riassegnare')
    .eq('email', pulita)
    .maybeSingle()

  // null significa "email non in staff_users", cioè non autorizzata: è una
  // risposta legittima. Un errore della query è un'altra cosa — service role
  // key mancante o sbagliata, progetto Supabase giù, tabella rinominata — e
  // restituire null lo farebbe passare per un problema di permessi, con
  // l'utente giusto respinto da un messaggio che parla d'altro. Lo lanciamo,
  // così chi chiama può dire "servizio non disponibile" invece di accusare
  // l'account.
  if (error) throw new ErroreStaffUsers(error.message)

  return data as RigaStaff
})
