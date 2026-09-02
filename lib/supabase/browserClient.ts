import { createBrowserClient } from '@supabase/ssr'

// Usato SOLO dalle pagine che devono parlare con Supabase Auth dal browser
// (login, callback dell'invito). Non legge mai le tabelle dei dati: con RLS
// attiva e nessuna policy, la anon key non potrebbe comunque farlo.
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
