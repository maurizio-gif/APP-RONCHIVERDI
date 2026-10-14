import { cache } from 'react'
import { revalidateTag, unstable_cache } from 'next/cache'
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

// Il tag con cui la riga di staff_users sta nella Data Cache di Next: chi
// scrive su staff_users (Gestione utenti, imposta-password) chiama
// invalidaRigheStaff, e la lettura successiva torna al database.
const TAG_STAFF_USERS = 'staff-users'

// Quanto può restare in cache una riga che nessuno ha toccato dal pannello:
// copre solo le modifiche fatte a mano dal SQL Editor, che arrivano al
// massimo con questo ritardo. Quelle fatte da Gestione utenti invalidano
// subito (vedi invalidaRigheStaff).
const SECONDI_CACHE_STAFF = 30

// La lettura vera, condivisa fra le richieste. È la query più frequente del
// pannello: la fanno il layout di ogni pagina e i due polling ogni venti
// secondi, ed era il primo andata-e-ritorno verso Supabase prima di qualunque
// altro dato — una tabella di venti righe che cambia una volta a settimana.
// Un errore non finisce in cache (unstable_cache non memorizza le eccezioni):
// la richiesta dopo riprova.
const leggiRigaStaff = unstable_cache(
  async (pulita: string): Promise<RigaStaff> => {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase
      .from('staff_users')
      .select('email, nome, cognome, sezioni_consentite, puo_invitare, puo_cancellare, commerciale, puo_riassegnare')
      .eq('email', pulita)
      .maybeSingle()

    // null significa "email non in staff_users", cioè non autorizzata: è una
    // risposta legittima. Un errore della query è un'altra cosa — service
    // role key mancante o sbagliata, progetto Supabase giù, tabella
    // rinominata — e restituire null lo farebbe passare per un problema di
    // permessi, con l'utente giusto respinto da un messaggio che parla
    // d'altro. Lo lanciamo, così chi chiama può dire "servizio non
    // disponibile" invece di accusare l'account.
    if (error) throw new ErroreStaffUsers(error.message)

    return data as RigaStaff
  },
  ['riga-staff'],
  { revalidate: SECONDI_CACHE_STAFF, tags: [TAG_STAFF_USERS] }
)

// La riga di staff_users dell'operatore corrente: chi può vedere cosa,
// amministrare, cancellare, e il nome per l'intestazione.
//
// cache() di React deduplica le chiamate con lo stesso argomento per la
// durata di una richiesta (o dell'esecuzione di una Server Action): senza,
// allowlist, sezioni consentite, nome utente e permessi booleani
// chiederebbero la stessa riga cinque volte per pagina. Sotto, la Data Cache
// la tiene fra una richiesta e l'altra.
export const rigaStaffCorrente = cache(async (email: string | null | undefined): Promise<RigaStaff> => {
  const pulita = email?.trim().toLowerCase()
  if (!pulita) return null
  return leggiRigaStaff(pulita)
})

// Da chiamare dopo ogni scrittura su staff_users: permessi, sezioni, nome,
// inviti e rimozioni valgono dalla richiesta successiva, non dopo la scadenza
// della cache. Una rimozione d'accesso, soprattutto, non deve aspettare.
export function invalidaRigheStaff() {
  revalidateTag(TAG_STAFF_USERS)
}
