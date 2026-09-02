'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { puoAmministrare, puoCancellare } from '@/lib/auth/permessi'
import { registraLog } from '@/lib/audit'
import { giornoRoma } from '@/lib/timbratura'

export type Esito = { ok: true } | { ok: false; errore: string }

// Ogni azione rifà da capo il controllo dei permessi: una Server Action resta
// chiamabile a mano anche da chi non vede il pulsante, quindi nascondere
// l'interfaccia non è mai una protezione.
async function autorizzato(): Promise<boolean> {
  return (await utenteHaSezione('log-operatori')) && (await puoAmministrare(emailCorrente()))
}

/**
 * Corregge l'orario di una timbratura già registrata — il caso vero è
 * un'uscita timbrata il giorno sbagliato, che fa risultare un turno di 144
 * ore.
 *
 * Si cambia solo l'orario di una riga che esiste: qui non si creano
 * timbrature mancanti, perché ogni riga porta con sé le coordinate GPS del
 * timbro e inventarle renderebbe il dato indistinguibile da un timbro reale.
 */
export async function correggiTimbratura(id: number, nuovoIso: string): Promise<Esito> {
  if (!(await autorizzato())) {
    return { ok: false, errore: 'Serve il permesso di amministrare per correggere una timbratura.' }
  }

  const quando = new Date(nuovoIso)
  if (Number.isNaN(quando.getTime())) return { ok: false, errore: 'Data e ora non valide.' }
  if (quando.getTime() > Date.now() + 60_000) {
    return { ok: false, errore: 'Non si può spostare una timbratura nel futuro.' }
  }

  const supabase = createSupabaseServiceClient()
  const { data: riga } = await supabase
    .from('timbrature')
    .select('id, email, tipo, created_at')
    .eq('id', id)
    .maybeSingle()

  if (!riga) return { ok: false, errore: 'Timbratura non trovata.' }

  // La correzione deve restare nello stesso giorno: spostarla altrove
  // sposterebbe le ore da una giornata all'altra, che è una cosa diversa dal
  // correggere un orario sbagliato e va fatta guardandola, non di lato.
  if (giornoRoma(nuovoIso) !== giornoRoma(riga.created_at as string)) {
    return {
      ok: false,
      errore: 'La correzione deve restare nello stesso giorno della timbratura.',
    }
  }

  // Le altre timbrature della persona devono restare in sequenza: un turno
  // corretto a mano non può scavalcare quello prima o quello dopo, altrimenti
  // l'accoppiamento entrata/uscita produrrebbe turni assurdi su righe che
  // nessuno ha toccato.
  const { data: vicine } = await supabase
    .from('timbrature')
    .select('id, created_at')
    .eq('email', riga.email)
    .neq('id', id)
    .order('created_at', { ascending: true })

  const precedente = (vicine ?? []).filter((v) => v.created_at < (riga.created_at as string)).pop()
  const successiva = (vicine ?? []).find((v) => v.created_at > (riga.created_at as string))

  if (precedente && quando.getTime() <= new Date(precedente.created_at as string).getTime()) {
    return { ok: false, errore: 'L’orario corretto finirebbe prima della timbratura precedente.' }
  }
  if (successiva && quando.getTime() >= new Date(successiva.created_at as string).getTime()) {
    return { ok: false, errore: 'L’orario corretto finirebbe dopo la timbratura successiva.' }
  }

  const { error } = await supabase
    .from('timbrature')
    .update({ created_at: quando.toISOString() })
    .eq('id', id)

  if (error) return { ok: false, errore: error.message }

  // Nel log finiscono sia il valore vecchio sia quello nuovo: una correzione
  // manuale sulle ore lavorate deve restare ricostruibile.
  await registraLog(emailCorrente(), 'timbratura_corretta', {
    entita: 'timbrature',
    entitaId: String(id),
    dettagli: {
      email_target: riga.email,
      tipo: riga.tipo,
      prima: riga.created_at,
      dopo: quando.toISOString(),
    },
  })

  revalidatePath('/dashboard/log-operatori')
  revalidatePath('/dashboard/timbratura')
  return { ok: true }
}

/** Cancella una timbratura sbagliata: serve anche il permesso di cancellare. */
export async function eliminaTimbratura(id: number): Promise<Esito> {
  if (!(await autorizzato())) {
    return { ok: false, errore: 'Serve il permesso di amministrare.' }
  }
  if (!(await puoCancellare(emailCorrente()))) {
    return {
      ok: false,
      errore: 'Non hai il permesso di cancellare. Puoi correggere l’orario invece di eliminare la riga.',
    }
  }

  const supabase = createSupabaseServiceClient()
  const { data: riga } = await supabase
    .from('timbrature')
    .select('email, tipo, created_at, distanza_metri')
    .eq('id', id)
    .maybeSingle()

  const { error } = await supabase.from('timbrature').delete().eq('id', id)
  if (error) return { ok: false, errore: error.message }

  // Il contenuto della riga cancellata resta nel log: è l'unico posto dove
  // ritrovarlo se la cancellazione era sbagliata.
  await registraLog(emailCorrente(), 'timbratura_eliminata', {
    entita: 'timbrature',
    entitaId: String(id),
    dettagli: riga ?? {},
  })

  revalidatePath('/dashboard/log-operatori')
  revalidatePath('/dashboard/timbratura')
  return { ok: true }
}
