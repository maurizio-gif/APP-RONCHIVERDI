'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { puoCancellare } from '@/lib/auth/permessi'
import { registraLog } from '@/lib/audit'
import {
  DURATA_PREDEFINITA,
  eAppuntamentoVero,
  eGiaAvvenuto,
  eTipoValido,
  normalizzaOra,
  type TipoVoce,
} from '@/lib/agenda'

// Risultato come valore di ritorno, non un throw: in produzione Next.js
// oscura il messaggio di un errore lanciato da una Server Action.
export type Esito = { ok: true } | { ok: false; errore: string }

async function autorizzato(): Promise<boolean> {
  return utenteHaSezione('agenda')
}

function eDataValida(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export async function creaVoce(formData: FormData): Promise<Esito> {
  if (!(await autorizzato())) return { ok: false, errore: 'Non hai accesso all’agenda.' }

  const titolo = String(formData.get('titolo') ?? '').trim()
  const tipoGrezzo = String(formData.get('tipo') ?? 'task')
  const data = String(formData.get('data') ?? '').trim()
  const oraGrezza = String(formData.get('ora') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()
  const assegnatoA = String(formData.get('assegnato_a') ?? '').trim()
  const durataGrezza = String(formData.get('durata_minuti') ?? '').trim()

  if (!titolo) return { ok: false, errore: 'Il titolo è obbligatorio.' }
  if (!eDataValida(data)) return { ok: false, errore: 'La data non è valida.' }
  if (!eTipoValido(tipoGrezzo)) return { ok: false, errore: 'Tipo non valido.' }

  const tipo: TipoVoce = tipoGrezzo

  // L'ora la hanno solo gli appuntamenti veri: quelli sì sono un impegno preso
  // con qualcuno a un'ora precisa, e sono gli unici che togliono uno slot al
  // sito. Un'email o una cosa da fare valgono per la giornata, e dargli un'ora
  // significherebbe occupare una fascia che invece resta prenotabile. Il
  // vincolo sta qui e non solo nel form, così vale anche per le voci create
  // dalla chiusura di un esito.
  const oraRichiesta = eAppuntamentoVero(tipo) ? oraGrezza : ''
  const ora = oraRichiesta ? normalizzaOra(oraRichiesta) : null
  if (oraRichiesta && !ora) return { ok: false, errore: 'L’ora non è valida (formato HH:MM).' }

  const durata = Number(durataGrezza)
  const durataMinuti =
    Number.isFinite(durata) && durata > 0 && durata <= 480 ? Math.round(durata) : DURATA_PREDEFINITA[tipo]

  // Una voce già passata si segna da sé come fatta: vedi eGiaAvvenuto.
  const giaAvvenuto = eGiaAvvenuto(data, ora)

  const email = emailCorrente()
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('task').insert({
    titolo,
    tipo,
    data,
    ora,
    durata_minuti: durataMinuti,
    note: note || null,
    // Chi non indica un assegnatario se la prende in carico: un'agenda con
    // voci di nessuno non si lavora.
    assegnato_a: assegnatoA || email,
    creato_da: email,
    stato: giaAvvenuto ? 'completato' : 'aperto',
    completato_il: giaAvvenuto ? new Date().toISOString() : null,
    entita: String(formData.get('entita') ?? '').trim() || null,
    entita_id: String(formData.get('entita_id') ?? '').trim() || null,
  })

  if (error) {
    console.error('Voce di agenda non creata:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a salvare la voce. Riprova.' }
  }

  await registraLog(email, 'agenda_voce_creata', {
    entita: 'task',
    dettagli: { titolo, tipo, data, ora, durata_minuti: durataMinuti },
  })

  revalidatePath('/dashboard/agenda')
  return { ok: true }
}

export async function riapriVoce(id: string): Promise<Esito> {
  if (!(await autorizzato())) return { ok: false, errore: 'Non hai accesso all’agenda.' }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('task')
    .update({ stato: 'aperto', completato_il: null, esito: null })
    .eq('id', id)

  if (error) return { ok: false, errore: error.message }

  await registraLog(emailCorrente(), 'agenda_voce_riaperta', { entita: 'task', entitaId: id })
  revalidatePath('/dashboard/agenda')
  return { ok: true }
}

export async function annullaVoce(id: string): Promise<Esito> {
  if (!(await autorizzato())) return { ok: false, errore: 'Non hai accesso all’agenda.' }

  // Annullare, non cancellare: è l'unico stato che libera lo slot per il sito
  // (vedi slotOccupati), e lascia comunque la traccia di cosa era stato
  // fissato. La cancellazione vera resta a chi ha puo_cancellare.
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('task').update({ stato: 'annullato' }).eq('id', id)

  if (error) return { ok: false, errore: error.message }

  await registraLog(emailCorrente(), 'agenda_voce_annullata', { entita: 'task', entitaId: id })
  revalidatePath('/dashboard/agenda')
  return { ok: true }
}

export async function eliminaVoce(id: string): Promise<Esito> {
  if (!(await autorizzato())) return { ok: false, errore: 'Non hai accesso all’agenda.' }
  if (!(await puoCancellare(emailCorrente()))) {
    return {
      ok: false,
      errore: 'Non hai il permesso di cancellare. Puoi annullare la voce: lo slot si libera comunque.',
    }
  }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('task').delete().eq('id', id)
  if (error) return { ok: false, errore: error.message }

  await registraLog(emailCorrente(), 'agenda_voce_eliminata', { entita: 'task', entitaId: id })
  revalidatePath('/dashboard/agenda')
  return { ok: true }
}

/**
 * Riporta fra quelle da lavorare una richiesta arrivata dal sito. In agenda
 * le richieste dal sito non hanno uno stato proprio: `gestito` su
 * form_contatti è il segno che la segreteria le ha lavorate, ed è quello che
 * l'agenda mostra come "fatto".
 *
 * Si riapre e basta: la chiusura passa solo da "Chiudi con esito". L'esito si
 * azzera insieme al resto, altrimenti la richiesta riaperta continuerebbe a
 * portarsi dietro il giudizio di una lavorazione annullata.
 */
export async function riapriContatto(id: string): Promise<Esito> {
  if (!(await autorizzato())) return { ok: false, errore: 'Non hai accesso all’agenda.' }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('form_contatti')
    .update({ gestito: false, gestito_da: null, gestito_il: null, esito_tipo: null, esito: null })
    .eq('id', id)
  if (error) return { ok: false, errore: error.message }

  await registraLog(emailCorrente(), 'contatto_riaperto', {
    entita: 'form_contatti',
    entitaId: id,
  })

  revalidatePath('/dashboard/agenda')
  revalidatePath('/dashboard/richieste', 'layout')
  return { ok: true }
}
