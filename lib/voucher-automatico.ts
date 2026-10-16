import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'

// Lo stato del voucher automatico "(cer000)", letto dal pannello per mostrarlo
// alla segreteria. L'automazione vera gira su Supabase: edge function
// supabase/functions/voucher-automatico, chiamata da pg_cron
// (scripts/sql/2026-10-16-automazioni-su-supabase.sql).
//
// Server-only: usa la service role key.

export const CHIAVE_AUTOMAZIONE = 'voucher_cer000'

export type StatoAutomazione = { attiva: boolean; attivaDal: string | null }

// null se la riga non c'è: per chi chiama è come se fosse spenta.
export async function leggiStatoAutomazione(): Promise<StatoAutomazione | null> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('automazioni')
    .select('attiva, attiva_dal')
    .eq('chiave', CHIAVE_AUTOMAZIONE)
    .maybeSingle()
  if (error || !data) return null
  return { attiva: data.attiva === true, attivaDal: data.attiva_dal }
}
