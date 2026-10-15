import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import type { TentativiRichiamo, VoceAgenda } from '@/lib/agenda'

// Server-only (usa il client service role): importare solo da Server
// Action/Server Component, mai da un file "use client".

// I tentativi a vuoto su un «Richiamami» dal sito.
//
// «Non risponde, riprovo» (registraTentativoRichiamo, in
// app/dashboard/agenda/esito-actions.ts) non chiude la richiesta: scrive una
// telefonata già avvenuta e fallita, agganciata alla richiesta, e la richiesta
// resta da fare. Quelle telefonate sono i tentativi: qui si contano, per
// mostrarli sulla riga della richiesta — «2 tentativi, l'ultimo di Carola alle
// 10:32». Senza, chi apre l'agenda richiama chi è appena stato chiamato.
//
// Conta ogni telefonata fallita agganciata alla richiesta, non solo quelle
// nate da quel pulsante: una chiamata a vuoto è un tentativo comunque la si
// sia registrata. Il titolo non serve a riconoscerle — in agenda il titolo è
// sempre il nome del contatto.

/** I tentativi di ciascuna richiesta, per id della richiesta. */
export async function caricaTentativiRichiamo(
  idRichieste: string[]
): Promise<Map<string, TentativiRichiamo>> {
  const mappa = new Map<string, TentativiRichiamo>()
  if (idRichieste.length === 0) return mappa

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('task')
    .select('entita_id, esito_da, esito_il')
    .eq('entita', 'form_contatti')
    .in('entita_id', idRichieste)
    .eq('tipo', 'appuntamento_telefonico')
    .eq('esito_tipo', 'fallita')
    .order('esito_il', { ascending: true })

  if (error) {
    // Non blocca la pagina: senza il conteggio la richiesta si vede comunque.
    console.error('Tentativi di richiamo non letti:', error.message)
    return mappa
  }

  for (const r of data ?? []) {
    const id = String(r.entita_id)
    const prima = mappa.get(id)
    mappa.set(id, {
      numero: (prima?.numero ?? 0) + 1,
      ultimoDa: (r.esito_da as string | null) ?? null,
      ultimoIl: String(r.esito_il),
    })
  }
  return mappa
}

/**
 * Aggiunge i tentativi alle voci «Richiamami» di un elenco già costruito.
 * Le altre voci restano come sono.
 */
export async function conTentativiRichiamo<T extends VoceAgenda>(voci: T[]): Promise<T[]> {
  const ids = voci.filter((v) => v.origine === 'form_contatti' && v.fascia).map((v) => v.id)
  const tentativi = await caricaTentativiRichiamo(ids)
  if (tentativi.size === 0) return voci
  return voci.map((v) =>
    v.origine === 'form_contatti' && tentativi.has(v.id) ? { ...v, tentativi: tentativi.get(v.id)! } : v
  )
}
