// Helper condivisi fra le pagine di reportistica abbonamenti
// (app/dashboard/abbonamenti/**): i gruppi prodotto sono una categorizzazione
// commerciale definita a mano da Ronchiverdi (vedi
// scripts/sql/2026-09-18-abbonamenti-gruppi.sql), non un dato di Info4U.

import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'

export type Gruppo = { id: string; nome: string; ordine: number }

// Chiave sintetica per i prodotti senza un gruppo assegnato: non è l'id di
// nessuna riga in abbonamenti_gruppi, serve solo per tenerli insieme nelle
// mappe di aggregazione dei report.
export const NON_CATEGORIZZATO = 'non-categorizzato'

export async function caricaGruppi(): Promise<Gruppo[]> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('abbonamenti_gruppi')
    .select('id, nome, ordine')
    .order('ordine', { ascending: true })
    .order('nome', { ascending: true })
  return data ?? []
}
