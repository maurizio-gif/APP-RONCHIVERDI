'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { MOTIVI_NON_RINNOVO } from './motivi'

// Lo stato di lavorazione di un rinnovo (nota e "in trattativa") non arriva
// da nessuna sincronizzazione: lo scrive solo chi lavora il rinnovo, qui,
// prendendo il posto del foglio Excel "REPORT RINNOVI" che faceva la stessa
// cosa fuori dal CRM. Vedi scripts/sql/2026-09-25-abbonamenti-scadenze-lavorazione.sql.

export type Esito = { ok: true } | { ok: false; errore: string }

const NEGATO: Esito = { ok: false, errore: 'Non hai accesso a questa sezione.' }

// Chi lavora un rinnovo entra da due porte diverse — la sezione Abbonamenti
// (direzionale) o Rinnovi Core (segreteria, vedi lib/auth/sezioni.ts) — e non
// è detto che abbia entrambi i permessi: gli operatori di segreteria hanno
// solo il secondo. Basta uno dei due per poter scrivere qui.
async function operatoreAutorizzato(): Promise<string | null> {
  const email = emailCorrente()
  if (!email) return null
  const [haAbbonamenti, haRinnoviCore] = await Promise.all([
    utenteHaSezione('abbonamenti'),
    utenteHaSezione('rinnovi-core'),
  ])
  if (!haAbbonamenti && !haRinnoviCore) return null
  return email
}

function rivalidaScadenze() {
  revalidatePath('/dashboard/abbonamenti/scadenze')
  revalidatePath('/dashboard/abbonamenti/rinnovi')
}

export async function salvaMotivoNonRinnovo(abbonamentoId: string, motivo: string | null): Promise<Esito> {
  const email = await operatoreAutorizzato()
  if (!email) return NEGATO

  if (motivo && !(MOTIVI_NON_RINNOVO as readonly string[]).includes(motivo)) {
    return { ok: false, errore: 'Motivo non riconosciuto.' }
  }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('abbonamenti_scadenze_lavorazione').upsert(
    {
      abbonamento_id: abbonamentoId,
      motivo_non_rinnovo: motivo,
      aggiornato_da: email,
      aggiornato_il: new Date().toISOString(),
    },
    { onConflict: 'abbonamento_id' }
  )

  if (error) {
    console.error('Motivo non rinnovo non salvato:', error.message)
    return { ok: false, errore: 'Non è stato possibile salvare il motivo.' }
  }

  rivalidaScadenze()
  return { ok: true }
}

export async function salvaNoteNonRinnovo(abbonamentoId: string, note: string): Promise<Esito> {
  const email = await operatoreAutorizzato()
  if (!email) return NEGATO

  const testo = note.trim().slice(0, 2000) || null
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('abbonamenti_scadenze_lavorazione').upsert(
    {
      abbonamento_id: abbonamentoId,
      note_non_rinnovo: testo,
      aggiornato_da: email,
      aggiornato_il: new Date().toISOString(),
    },
    { onConflict: 'abbonamento_id' }
  )

  if (error) {
    console.error('Note non rinnovo non salvate:', error.message)
    return { ok: false, errore: 'Non è stato possibile salvare le note.' }
  }

  rivalidaScadenze()
  return { ok: true }
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

export type StatoManuale = 'in_trattativa' | 'perso' | null

/**
 * Lo stato scelto a mano su un rinnovo non ancora rinnovato: vuoto (ancora da
 * valutare), "in trattativa" o "perso". Un rinnovato vero (calcolato, vedi la
 * vista) non passa da qui — il fatto che esista già un nuovo abbonamento ha
 * già risposto alla domanda, e uno stato manuale che lo contraddicesse
 * sarebbe un dato che mente.
 */
export async function impostaStatoManuale(abbonamentoId: string, stato: StatoManuale): Promise<Esito> {
  const email = await operatoreAutorizzato()
  if (!email) return NEGATO

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('abbonamenti_scadenze_lavorazione').upsert(
    {
      abbonamento_id: abbonamentoId,
      stato_manuale: stato,
      aggiornato_da: email,
      aggiornato_il: new Date().toISOString(),
    },
    { onConflict: 'abbonamento_id' }
  )

  if (error) {
    console.error('Stato manuale non aggiornato:', error.message)
    return { ok: false, errore: 'Non è stato possibile aggiornare lo stato.' }
  }

  rivalidaScadenze()
  return { ok: true }
}

/**
 * A chi è affidato il rinnovo: solo un operatore di segreteria (vedi
 * staff_users.operatore_segreteria), non un commerciale o un istruttore —
 * stesso principio di assegnaTrattativa in richieste/trattativa-actions.ts,
 * ma con quel flag al posto di `commerciale`. Il destinatario si
 * ri-verifica qui, lato server: la tendina in pagina già mostra solo
 * operatori di segreteria, ma questa è la riga che decide davvero.
 */
export async function assegnaScadenza(abbonamentoId: string, email: string | null): Promise<Esito> {
  const chiEsegue = await operatoreAutorizzato()
  if (!chiEsegue) return NEGATO

  const destinatario = email?.trim().toLowerCase() || null
  const supabase = createSupabaseServiceClient()

  if (destinatario) {
    const { data: chi } = await supabase
      .from('staff_users')
      .select('email, operatore_segreteria')
      .eq('email', destinatario)
      .maybeSingle()
    if (!chi) return { ok: false, errore: 'Questa persona non ha accesso al pannello.' }
    if (!chi.operatore_segreteria) {
      return { ok: false, errore: `${destinatario} non è un operatore di segreteria.` }
    }
  }

  const { error } = await supabase.from('abbonamenti_scadenze_lavorazione').upsert(
    {
      abbonamento_id: abbonamentoId,
      assegnato_a: destinatario,
      aggiornato_da: chiEsegue,
      aggiornato_il: new Date().toISOString(),
    },
    { onConflict: 'abbonamento_id' }
  )

  if (error) {
    console.error('Assegnatario non aggiornato:', error.message)
    return { ok: false, errore: 'Non è stato possibile aggiornare l\'assegnatario.' }
  }

  rivalidaScadenze()
  return { ok: true }
}

/**
 * Un abbonamento che non è da rinnovare né da trattare (fuori scope, caso
 * particolare già gestito altrove) esce dal conteggio di rinnovi/trattative
 * senza sparire: resta in tabella e nel grafico come fetta a sé, verificabile
 * in ogni momento. Manuale come stato_manuale e nota: nessuna
 * sincronizzazione lo scrive.
 */
export async function impostaEsclusoReport(abbonamentoId: string, escluso: boolean): Promise<Esito> {
  const email = await operatoreAutorizzato()
  if (!email) return NEGATO

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('abbonamenti_scadenze_lavorazione').upsert(
    {
      abbonamento_id: abbonamentoId,
      escluso_da_report: escluso,
      aggiornato_da: email,
      aggiornato_il: new Date().toISOString(),
    },
    { onConflict: 'abbonamento_id' }
  )

  if (error) {
    console.error('Esclusione dal report non aggiornata:', error.message)
    return { ok: false, errore: 'Non è stato possibile aggiornare l\'esclusione.' }
  }

  rivalidaScadenze()
  return { ok: true }
}
