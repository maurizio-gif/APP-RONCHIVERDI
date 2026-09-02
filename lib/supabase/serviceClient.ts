import { createClient } from '@supabase/supabase-js'

// Client "amministrativo": usa la SERVICE ROLE KEY, bypassa sempre RLS.
// Import consentito SOLO da file eseguiti lato server (Server Component,
// Server Action, Route Handler). Non importare mai da un file con
// "use client" in cima: la chiave finirebbe nel bundle del browser.
export function createSupabaseServiceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}
