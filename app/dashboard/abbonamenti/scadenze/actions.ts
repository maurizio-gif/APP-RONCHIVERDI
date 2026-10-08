'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { puoRiassegnare } from '@/lib/auth/permessi'
import { MOTIVI_NON_RINNOVO } from './motivi'
import { TIPI_NOTA, type NotaScadenza, type TipoNota } from './note'

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

/**
 * Una nota in più nello storico della scadenza (vedi abbonamenti_scadenze_note):
 * di gestione o sul mancato rinnovo, secondo `tipo`. Non sovrascrive le
 * precedenti, porta con sé chi l'ha scritta e quando — come le note sulle
 * disdette di Athlon. L'ultima nota resta anche nella colonna corrispondente
 * di abbonamenti_scadenze_lavorazione (nota o note_non_rinnovo), che la vista
 * abbonamenti_scadenze espone già: chi legge quel campo continua a trovarci
 * la più recente. Ritorna la nota salvata, con orario del database, perché la
 * tabella la mostri subito in cima allo storico senza ricaricare la pagina.
 */
export async function aggiungiNotaScadenza(
  abbonamentoId: string,
  tipo: TipoNota,
  testo: string
): Promise<{ ok: true; nota: NotaScadenza } | { ok: false; errore: string }> {
  const email = await operatoreAutorizzato()
  if (!email) return { ok: false, errore: 'Non hai accesso a questa sezione.' }

  if (!(TIPI_NOTA as readonly string[]).includes(tipo)) return { ok: false, errore: 'Tipo di nota non riconosciuto.' }
  const pulito = testo.trim().slice(0, 2000)
  if (!pulito) return { ok: false, errore: 'La nota è vuota.' }

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('abbonamenti_scadenze_note')
    .insert({ abbonamento_id: abbonamentoId, tipo, testo: pulito, autore: email })
    .select('id, tipo, testo, autore, creato_il')
    .single()

  if (error || !data) {
    console.error('Nota di gestione non salvata:', error?.message)
    return { ok: false, errore: 'Non è stato possibile salvare la nota.' }
  }

  const { error: erroreUltima } = await supabase.from('abbonamenti_scadenze_lavorazione').upsert(
    {
      abbonamento_id: abbonamentoId,
      [tipo === 'gestione' ? 'nota' : 'note_non_rinnovo']: pulito,
      aggiornato_da: email,
      aggiornato_il: data.creato_il,
    },
    { onConflict: 'abbonamento_id' }
  )
  // La nota è già nello storico, che è il dato vero: un errore qui lascia
  // indietro solo la copia dell'ultima nota, non fa perdere niente.
  if (erroreUltima) console.error('Ultima nota non aggiornata:', erroreUltima.message)

  rivalidaScadenze()
  return { ok: true, nota: data as NotaScadenza }
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

  // Un rinnovo già assegnato lo sposta solo chi lo ha in mano o chi ha il
  // permesso "Può riassegnare" (la responsabile): il controllo vero è qui,
  // la tendina disabilitata in pagina è solo cortesia.
  const { data: attuale } = await supabase
    .from('abbonamenti_scadenze_lavorazione')
    .select('assegnato_a')
    .eq('abbonamento_id', abbonamentoId)
    .maybeSingle()
  const titolare = (attuale?.assegnato_a as string | null)?.toLowerCase() ?? null
  if (titolare && titolare !== chiEsegue.toLowerCase() && !(await puoRiassegnare(chiEsegue))) {
    return { ok: false, errore: 'Questo rinnovo è assegnato a un\'altra persona: solo lei o la responsabile può riassegnarlo.' }
  }

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
