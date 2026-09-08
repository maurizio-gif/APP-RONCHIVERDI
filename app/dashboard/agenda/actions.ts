'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { puoCancellare } from '@/lib/auth/permessi'
import { registraLog } from '@/lib/audit'
import { rigaEvento, type EventoDaProgrammare, type ModoEvento } from '@/lib/eventi'

// Risultato come valore di ritorno, non un throw: in produzione Next.js
// oscura il messaggio di un errore lanciato da una Server Action.
export type Esito = { ok: true } | { ok: false; errore: string }

async function autorizzato(): Promise<boolean> {
  return utenteHaSezione('agenda')
}

/**
 * Crea a mano una voce d'agenda.
 *
 * Due cose la governano, e nessuna delle due era vera prima:
 *
 *  - **il contatto è obbligatorio**. Una voce senza contatto non compariva
 *    nella scheda di nessuno e in agenda era un titolo senza il perché: si
 *    ritrovava solo per caso, scorrendo il giorno giusto.
 *  - **programma o registra**, dichiarato. Prima lo indovinava la data (vedi
 *    eGiaAvvenuto): una telefonata appena fatta e annotata per domani restava
 *    «da fare», e un impegno fissato per stamattina nasceva già chiuso.
 *
 * Le regole sui campi (l'ora ai soli appuntamenti, la durata dal tipo,
 * l'assegnatario a chi scrive) stanno in lib/eventi.ts, le stesse che valgono
 * per i seguiti programmati chiudendo una voce.
 */
export async function creaVoce(formData: FormData): Promise<Esito> {
  if (!(await autorizzato())) return { ok: false, errore: 'Non hai accesso all’agenda.' }

  const personaId = String(formData.get('persona_id') ?? '').trim()
  if (!personaId) {
    return { ok: false, errore: 'Scegli il contatto a cui agganciare la voce.' }
  }

  const modoGrezzo = String(formData.get('modo') ?? 'programma')
  const modo: ModoEvento = modoGrezzo === 'registra' ? 'registra' : 'programma'

  const evento: EventoDaProgrammare = {
    titolo: String(formData.get('titolo') ?? ''),
    tipo: String(formData.get('tipo') ?? 'task'),
    data: String(formData.get('data') ?? '').trim(),
    ora: String(formData.get('ora') ?? '').trim(),
    durataMinuti: Number(String(formData.get('durata_minuti') ?? '')) || null,
    assegnatoA: String(formData.get('assegnato_a') ?? ''),
    note: String(formData.get('note') ?? ''),
    modo,
    esito: String(formData.get('esito') ?? '') || null,
    notaEsito: String(formData.get('nota_esito') ?? '') || null,
  }

  const email = emailCorrente()
  const esitoRiga = rigaEvento(evento, email, { entita: 'persona', id: personaId })
  if ('errore' in esitoRiga) return { ok: false, errore: esitoRiga.errore }

  // Il contatto deve esistere: un id inventato creerebbe una voce agganciata
  // al nulla, che è il problema da cui siamo partiti.
  const supabase = createSupabaseServiceClient()
  const { data: persona } = await supabase
    .from('persone')
    .select('id')
    .eq('id', personaId)
    .maybeSingle()
  if (!persona) return { ok: false, errore: 'Contatto non trovato: riscegli dall’elenco.' }

  const { error } = await supabase.from('task').insert(esitoRiga.riga)

  if (error) {
    console.error('Voce di agenda non creata:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a salvare la voce. Riprova.' }
  }

  await registraLog(email, modo === 'registra' ? 'evento_registrato' : 'agenda_voce_creata', {
    entita: 'persona',
    entitaId: personaId,
    dettagli: {
      titolo: esitoRiga.riga.titolo,
      tipo: esitoRiga.riga.tipo,
      data: esitoRiga.riga.data,
      ora: esitoRiga.riga.ora,
    },
  })

  revalidatePath('/dashboard/agenda')
  revalidatePath('/dashboard/richieste/richieste-club')
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
