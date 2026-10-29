'use server'

import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { leggiFiltri } from '@/lib/contatti-filtri'
import { contattiPerEsportazione } from '@/lib/contatti-filtri-server'

export type EsitoElenco = { ok: true; valori: string[]; persone: number } | { ok: false; errore: string }

/**
 * Le email o i cellulari della lista, per copiarli negli appunti: chi è
 * spuntato (`ids`) o, se nessuno lo è, tutta la lista. `parametri` è la query
 * string della pagina, riletta qui con le stesse regole: il server non si fida
 * di quello che il browser dice di aver filtrato.
 */
export async function recapitiDellaLista(parametri: string, ids: string[], campo: 'email' | 'cellulare'): Promise<EsitoElenco> {
  if (!(await utenteHaSezione('persone'))) return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  try {
    const { filtri, ordine } = leggiFiltri(Object.fromEntries(new URLSearchParams(parametri).entries()))
    const righe = await contattiPerEsportazione(createSupabaseServiceClient(), filtri, ordine, ids)
    const valori = [...new Set(righe.map((r) => (r[campo] ?? '').trim()).filter(Boolean))]
    await registraLog(emailCorrente(), 'contatti_copiati', {
      dettagli: { campo, persone: righe.length, valori: valori.length, selezione: ids.length > 0 },
    })
    return { ok: true, valori, persone: righe.length }
  } catch (e) {
    return { ok: false, errore: e instanceof Error ? e.message : 'Errore nella lettura della lista.' }
  }
}
