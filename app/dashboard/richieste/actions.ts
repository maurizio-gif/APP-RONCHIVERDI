'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { canaleDiRichiesta, eGestioneSemplice, type Canale } from '@/lib/richieste'

export type Esito = { ok: true } | { ok: false; errore: string }

/**
 * Il canale della richiesta, se chi sta agendo ha quella sezione.
 *
 * Il permesso si verifica sul canale della richiesta, non su una sezione
 * passata dal client: altrimenti chi ha accesso a un solo corso potrebbe
 * chiamare l'azione con l'id di una richiesta altrui e lavorarla.
 *
 * Ritorna il canale e non un sì/no perché chi chiama deve anche sapere *come*
 * si lavora quella richiesta: le due modalità di gestione (vedi
 * eGestioneSemplice) hanno azioni diverse, e ognuna deve rifiutare le righe
 * dell'altra.
 */
async function canaleAutorizzato(idRichiesta: string): Promise<Canale | null> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('form_contatti')
    .select('attivita, settore, origine')
    .eq('id', idRichiesta)
    .maybeSingle()
  if (!data) return null

  const canale = canaleDiRichiesta(data)
  if (!canale) return null

  const sezioni = await getSezioniConsentite(emailCorrente())
  return sezioni.includes(canale.chiave) ? canale : null
}

async function puoLavorare(idRichiesta: string): Promise<boolean> {
  return !!(await canaleAutorizzato(idRichiesta))
}

/**
 * Riporta una richiesta chiusa fra quelle da lavorare. È il modo di disfare
 * una chiusura sbagliata, e l'unico gesto che tocca `gestito` da qui: la
 * chiusura passa solo da "Chiudi con esito", che scrive anche il perché.
 *
 * Azzera anche l'esito: senza, una richiesta riaperta continuerebbe a
 * mostrare "eseguita" e la nota di chiusura di una lavorazione annullata.
 */
export async function riapriRichiesta(id: string): Promise<Esito> {
  if (!(await puoLavorare(id))) {
    return { ok: false, errore: 'Questa richiesta non è nelle tue sezioni.' }
  }

  const email = emailCorrente()
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('form_contatti')
    .update({
      gestito: false,
      gestito_da: null,
      gestito_il: null,
      esito_tipo: null,
      esito: null,
    })
    .eq('id', id)

  if (error) {
    console.error('Riapertura richiesta non salvata:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a salvare. Riprova.' }
  }

  await registraLog(email, 'contatto_riaperto', {
    entita: 'form_contatti',
    entitaId: id,
  })

  revalidatePath('/dashboard/richieste', 'layout')
  revalidatePath('/dashboard/agenda')
  return { ok: true }
}

// Su Club e Family la nota libera di `form_contatti.note` non si scrive più:
// là la nota è una sola ed è quella obbligatoria della chiusura con esito
// (form_contatti.esito, vedi chiudiConEsito). Ce n'erano due nello stesso
// pannello, e non era chiaro quale contasse.
//
// Sugli altri canali — le Young School e gli altri corsi, dove non esiste
// nessuna trattativa da seguire — `note` torna a essere *la* nota: la sola
// cosa che si scrive, accanto all'unico interruttore che conta. Vedi
// salvaGestione qui sotto.

/**
 * La gestione semplice: **gestito o no**, e una **nota**.
 *
 * È tutto quello che si può fare su una richiesta delle Young School, del
 * Summer Camp, di Chinesis, dei corsi padel e del Fitness Manager (vedi
 * eGestioneSemplice in lib/richieste.ts). Il responsabile chiama e la
 * richiesta è finita: non c'è una vendita da far avanzare, quindi non ci sono
 * esiti da scegliere né eventi da programmare — e chiederglieli voleva dire
 * far compilare un modulo di vendita per dire «l'ho chiamata».
 *
 * La nota **non è obbligatoria** e non è legata al momento della chiusura: si
 * può scrivere prima di gestire, insieme al gestito, o correggere un mese
 * dopo. È la differenza che chiudiConEsito non poteva dare, perché là la nota
 * è il verbale di una chiusura e senza non si chiude.
 *
 * Autorizza il canale della richiesta, non le sezioni agenda/club come fa
 * chiudiConEsito: il responsabile del padel ha solo la propria sezione, e con
 * quella regola non poteva chiudere nemmeno le proprie richieste.
 */
export async function salvaGestione(input: {
  id: string
  gestito: boolean
  nota: string
}): Promise<Esito> {
  const canale = await canaleAutorizzato(input.id)
  if (!canale) return { ok: false, errore: 'Questa richiesta non è nelle tue sezioni.' }
  if (!eGestioneSemplice(canale)) {
    // Club e Family passa da chiudiConEsito, che scrive anche l'esito e tiene
    // insieme trattativa e agenda: da qui la riga risulterebbe lavorata senza
    // che nessuno abbia detto com'è andata.
    return { ok: false, errore: 'Questa richiesta si chiude con un esito, non con il gestito.' }
  }

  const email = emailCorrente()
  const supabase = createSupabaseServiceClient()

  // Vuota vuol dire nessuna nota, non una nota di spazi: `null` è ciò che
  // legge chi mostra la riga per decidere se c'è qualcosa da leggere.
  const nota = (input.nota ?? '').trim() || null

  // Togliendo il gestito si toglie anche chi e quando: lasciarli scritti
  // direbbe che la richiesta è stata gestita da qualcuno, mentre l'elenco la
  // rimette fra quelle da fare.
  const { error } = await supabase
    .from('form_contatti')
    .update({
      note: nota,
      gestito: input.gestito,
      gestito_da: input.gestito ? email : null,
      gestito_il: input.gestito ? new Date().toISOString() : null,
    })
    .eq('id', input.id)

  if (error) {
    console.error('Gestione non salvata:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a salvare. Riprova.' }
  }

  await registraLog(email, input.gestito ? 'contatto_gestito' : 'contatto_riaperto', {
    entita: 'form_contatti',
    entitaId: input.id,
    dettagli: { canale: canale.chiave, con_nota: !!nota },
  })

  revalidatePath('/dashboard/richieste', 'layout')
  revalidatePath('/dashboard')
  return { ok: true }
}
