'use server'

import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import type { Persona } from '@/lib/persone'

export type EsitoRicerca = { ok: true; persone: Persona[] } | { ok: false; errore: string }

/**
 * Cerca fra TUTTE le persone in anagrafica, non solo le 500 più recenti che
 * la pagina carica di default (vedi cerca_persone in
 * scripts/sql/2026-09-19-ricerca-persone-server-side.sql): è quello che
 * rende trovabile chi non ha mai scritto dal sito — tutti i contatti
 * importati da Info4U — che nell'elenco caricato in pagina non c'è, quindi
 * un filtro in memoria sul browser non lo trova mai.
 */
export async function cercaPersone(query: string): Promise<EsitoRicerca> {
  if (!(await utenteHaSezione('persone'))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }

  const termine = query.trim()
  if (!termine) return { ok: true, persone: [] }

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc('cerca_persone', { p_query: termine, p_limite: 100 })

  if (error) {
    if (/cerca_persone/.test(error.message)) {
      return {
        ok: false,
        errore:
          'Manca la funzione di ricerca: esegui scripts/sql/2026-09-19-ricerca-persone-server-side.sql nel SQL Editor.',
      }
    }
    return { ok: false, errore: error.message }
  }

  return { ok: true, persone: (data ?? []) as unknown as Persona[] }
}
