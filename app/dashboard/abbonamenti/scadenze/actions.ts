'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'

// Lo stato di lavorazione di un rinnovo (nota e "in trattativa") non arriva
// da nessuna sincronizzazione: lo scrive solo chi lavora il rinnovo, qui,
// prendendo il posto del foglio Excel "REPORT RINNOVI" che faceva la stessa
// cosa fuori dal CRM. Vedi scripts/sql/2026-09-25-abbonamenti-scadenze-lavorazione.sql.

export type Esito = { ok: true } | { ok: false; errore: string }

const NEGATO: Esito = { ok: false, errore: 'Non hai accesso a questa sezione.' }

async function operatoreAutorizzato(): Promise<string | null> {
  const email = emailCorrente()
  if (!email) return null
  if (!(await utenteHaSezione('abbonamenti'))) return null
  return email
}

function rivalidaScadenze() {
  revalidatePath('/dashboard/abbonamenti/scadenze')
  revalidatePath('/dashboard/abbonamenti/rinnovi')
}

export async function salvaNotaScadenza(abbonamentoId: string, nota: string): Promise<Esito> {
  const email = await operatoreAutorizzato()
  if (!email) return NEGATO

  const testo = nota.trim().slice(0, 2000) || null
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('abbonamenti_scadenze_lavorazione').upsert(
    {
      abbonamento_id: abbonamentoId,
      nota: testo,
      aggiornato_da: email,
      aggiornato_il: new Date().toISOString(),
    },
    { onConflict: 'abbonamento_id' }
  )

  if (error) {
    console.error('Nota scadenza non salvata:', error.message)
    return { ok: false, errore: 'Non è stato possibile salvare la nota.' }
  }

  rivalidaScadenze()
  return { ok: true }
}

export async function impostaTrattativa(abbonamentoId: string, valore: boolean): Promise<Esito> {
  const email = await operatoreAutorizzato()
  if (!email) return NEGATO

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('abbonamenti_scadenze_lavorazione').upsert(
    {
      abbonamento_id: abbonamentoId,
      in_trattativa: valore,
      aggiornato_da: email,
      aggiornato_il: new Date().toISOString(),
    },
    { onConflict: 'abbonamento_id' }
  )

  if (error) {
    console.error('Trattativa non aggiornata:', error.message)
    return { ok: false, errore: 'Non è stato possibile aggiornare lo stato.' }
  }

  rivalidaScadenze()
  return { ok: true }
}
