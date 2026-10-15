'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
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

/**
 * «Sono persone diverse»: chiude la segnalazione di possibile doppione di una
 * scheda (il familiare con lo stesso cognome e cellulare, vedi
 * scripts/sql/2026-10-15-nome-contenuto-e-possibili-doppioni.sql). Si azzera
 * il puntatore sulla scheda che lo porta, e sparisce da tutte e due.
 *
 * Solo per 'possibile_doppione' e 'nome_cognome': un conflitto su email o
 * cellulare è un recapito che la sync non ha potuto scrivere, e azzerarlo le
 * farebbe riprovare lo stesso valore a ogni giro.
 */
export async function segnaPersoneDiverse(
  idConPuntatore: string
): Promise<{ ok: true } | { ok: false; errore: string }> {
  if (!(await utenteHaSezione('persone'))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('persone')
    .update({ conflitto_con_persona_id: null, conflitto_campo: null })
    .eq('id', idConPuntatore)
    .in('conflitto_campo', ['possibile_doppione', 'nome_cognome'])
    .select('id')

  if (error) {
    console.error('Segnalazione di doppione non chiusa:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a chiudere la segnalazione. Riprova.' }
  }
  if (!data?.length) return { ok: false, errore: 'La segnalazione era già chiusa.' }

  await registraLog(emailCorrente(), 'doppione_escluso', { entita: 'persone', entitaId: idConPuntatore })
  revalidatePath('/dashboard/persone', 'layout')
  return { ok: true }
}
