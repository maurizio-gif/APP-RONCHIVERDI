'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'

export type Esito = { ok: true } | { ok: false; errore: string }

function rivalidaReport() {
  revalidatePath('/dashboard/abbonamenti/gruppi')
  revalidatePath('/dashboard/abbonamenti')
  revalidatePath('/dashboard/abbonamenti/report')
  revalidatePath('/dashboard/abbonamenti/andamento')
}

export async function creaGruppo(nome: string): Promise<Esito> {
  if (!(await utenteHaSezione('abbonamenti'))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }
  const nomePulito = nome.trim()
  if (!nomePulito) {
    return { ok: false, errore: 'Il nome del gruppo non può essere vuoto.' }
  }

  const supabase = createSupabaseServiceClient()
  // L'ordine di visualizzazione è scelto a mano (non alfabetico, vedi la
  // migration): un gruppo nuovo va semplicemente in fondo alla lista.
  const { data: esistenti } = await supabase.from('abbonamenti_gruppi').select('ordine')
  const ordineMassimo = (esistenti ?? []).reduce((max, r) => Math.max(max, r.ordine ?? 0), 0)

  const { error } = await supabase.from('abbonamenti_gruppi').insert({ nome: nomePulito, ordine: ordineMassimo + 1 })

  if (error) {
    if (/duplicate key/.test(error.message)) {
      return { ok: false, errore: 'Esiste già un gruppo con questo nome.' }
    }
    if (/abbonamenti_gruppi/.test(error.message)) {
      return {
        ok: false,
        errore: 'Manca la tabella dei gruppi: esegui scripts/sql/2026-09-18-abbonamenti-gruppi.sql nel SQL Editor.',
      }
    }
    return { ok: false, errore: error.message }
  }

  rivalidaReport()
  return { ok: true }
}

export async function rinominaGruppo(id: string, nome: string): Promise<Esito> {
  if (!(await utenteHaSezione('abbonamenti'))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }
  const nomePulito = nome.trim()
  if (!nomePulito) {
    return { ok: false, errore: 'Il nome del gruppo non può essere vuoto.' }
  }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('abbonamenti_gruppi').update({ nome: nomePulito }).eq('id', id)
  if (error) {
    if (/duplicate key/.test(error.message)) {
      return { ok: false, errore: 'Esiste già un gruppo con questo nome.' }
    }
    return { ok: false, errore: error.message }
  }

  rivalidaReport()
  return { ok: true }
}

export async function creaMacroSettore(nome: string): Promise<Esito> {
  if (!(await utenteHaSezione('abbonamenti'))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }
  const nomePulito = nome.trim()
  if (!nomePulito) {
    return { ok: false, errore: 'Il nome del macro settore non può essere vuoto.' }
  }

  const supabase = createSupabaseServiceClient()
  const { data: esistenti } = await supabase.from('abbonamenti_macro_settori').select('ordine')
  const ordineMassimo = (esistenti ?? []).reduce((max, r) => Math.max(max, r.ordine ?? 0), 0)

  const { error } = await supabase
    .from('abbonamenti_macro_settori')
    .insert({ nome: nomePulito, ordine: ordineMassimo + 1 })

  if (error) {
    if (/duplicate key/.test(error.message)) {
      return { ok: false, errore: 'Esiste già un macro settore con questo nome.' }
    }
    if (/abbonamenti_macro_settori/.test(error.message)) {
      return {
        ok: false,
        errore:
          'Manca la tabella dei macro settori: esegui scripts/sql/2026-09-18-abbonamenti-macro-settori.sql nel SQL Editor.',
      }
    }
    return { ok: false, errore: error.message }
  }

  rivalidaReport()
  return { ok: true }
}

export async function assegnaMacroSettore(gruppoId: string, macroSettoreId: string | null): Promise<Esito> {
  if (!(await utenteHaSezione('abbonamenti'))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('abbonamenti_gruppi')
    .update({ macro_settore_id: macroSettoreId })
    .eq('id', gruppoId)
  if (error) {
    if (/macro_settore_id|abbonamenti_macro_settori/.test(error.message)) {
      return {
        ok: false,
        errore:
          'Manca la colonna del macro settore: esegui scripts/sql/2026-09-18-abbonamenti-macro-settori.sql nel SQL Editor.',
      }
    }
    return { ok: false, errore: error.message }
  }

  rivalidaReport()
  return { ok: true }
}

export async function assegnaProdotto(prodotto: string, gruppoId: string | null): Promise<Esito> {
  if (!(await utenteHaSezione('abbonamenti'))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('abbonamenti_mappatura')
    .upsert({ prodotto, gruppo_id: gruppoId, aggiornato_il: new Date().toISOString() }, { onConflict: 'prodotto' })
  if (error) {
    if (/abbonamenti_mappatura/.test(error.message)) {
      return {
        ok: false,
        errore: 'Manca la tabella di mappatura: esegui scripts/sql/2026-09-18-abbonamenti-gruppi.sql nel SQL Editor.',
      }
    }
    return { ok: false, errore: error.message }
  }

  rivalidaReport()
  return { ok: true }
}
