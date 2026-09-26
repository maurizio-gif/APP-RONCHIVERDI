import { createClient } from '@supabase/supabase-js'

// Client "amministrativo": usa la SERVICE ROLE KEY, bypassa sempre RLS.
// Import consentito SOLO da file eseguiti lato server (Server Component,
// Server Action, Route Handler). Non importare mai da un file con
// "use client" in cima: la chiave finirebbe nel bundle del browser.
//
// Il fetch passato qui forza `cache: 'no-store'` su ogni richiesta a
// Supabase: senza, la Data Cache di Next intercetta anche il fetch globale
// usato da supabase-js, e una chiamata GET con la stessa URL/querystring di
// una precedente nello stesso deployment torna la risposta vecchia invece di
// interrogare di nuovo il database — è quello che ha svuotato il resoconto
// serale del 26/9/2026 (vedi le vendite di "oggi" azzerate: la stessa query
// fatta da un invio di prova delle 7:23 è stata ripresentata pari pari
// dall'invio delle 22:00, senza una sola richiesta in più verso Supabase).
export function createSupabaseServiceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
    global: { fetch: (url, opzioni) => fetch(url, { ...opzioni, cache: 'no-store' }) },
  })
}
