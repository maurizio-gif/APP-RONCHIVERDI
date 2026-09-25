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

// Cancellabile solo se non ha più nessun prodotto assegnato: la colonna
// abbonamenti_mappatura.gruppo_id è "on delete set null" (vedi
// scripts/sql/2026-09-18-abbonamenti-gruppi.sql), quindi il database da solo
// lascerebbe cancellare comunque un gruppo pieno di prodotti, spostandoli
// tutti silenziosamente fra i "non categorizzati" — esattamente il contrario
// di quello che serve quando un gruppo è pieno per un motivo, non per uno
// creato per sbaglio. Il blocco è quindi qui, non nello schema.
export async function eliminaGruppo(id: string): Promise<Esito> {
  if (!(await utenteHaSezione('abbonamenti'))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }

  const supabase = createSupabaseServiceClient()
  const { count, error: erroreConteggio } = await supabase
    .from('abbonamenti_mappatura')
    .select('id', { count: 'exact', head: true })
    .eq('gruppo_id', id)
  if (erroreConteggio) {
    return { ok: false, errore: erroreConteggio.message }
  }
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      errore: `Ci sono ${count} prodott${count === 1 ? 'o' : 'i'} assegnat${count === 1 ? 'o' : 'i'} a questo gruppo: rimuovi l'assegnazione e riprova a cancellare il gruppo.`,
    }
  }

  const { error } = await supabase.from('abbonamenti_gruppi').delete().eq('id', id)
  if (error) {
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

// "No abbonamento": prodotti come "VISITA MEDICA" o "QUOTA ISCRIZIONE" che
// Info4U registra come una vendita qualunque ma non sono un vero
// abbonamento — flaggati qui escono dal conteggio utenti attivi e dal
// report scadenze/rinnovi (vedi 2026-09-21-abbonamenti-no-abbonamento.sql).
// Upsert per prodotto come assegnaProdotto: un prodotto mai categorizzato
// prima (nessuna riga in abbonamenti_mappatura) può comunque essere
// flaggato senza dover prima scegliergli un gruppo.
export async function impostaNoAbbonamento(prodotto: string, valore: boolean): Promise<Esito> {
  if (!(await utenteHaSezione('abbonamenti'))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('abbonamenti_mappatura')
    .upsert({ prodotto, no_abbonamento: valore, aggiornato_il: new Date().toISOString() }, { onConflict: 'prodotto' })
  if (error) {
    if (/no_abbonamento/.test(error.message)) {
      return {
        ok: false,
        errore: 'Manca la colonna no_abbonamento: esegui scripts/sql/2026-09-21-abbonamenti-no-abbonamento.sql nel SQL Editor.',
      }
    }
    return { ok: false, errore: error.message }
  }

  rivalidaReport()
  return { ok: true }
}
