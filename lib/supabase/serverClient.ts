import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Client "sessione utente" (anon key + cookie), usato SOLO per sapere CHI è
// loggato (getUser/getSession) in Server Component e middleware. Non usarlo
// per leggere form_contatti, sessioni, staff_users: quelle tabelle non hanno
// policy per il ruolo authenticated e restituirebbero sempre zero righe.
export function createSupabaseServerClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // chiamato da un Server Component: i cookie non sono scrivibili
            // lì, ma il middleware li rinfresca alla richiesta successiva.
          }
        },
      },
    }
  )
}
