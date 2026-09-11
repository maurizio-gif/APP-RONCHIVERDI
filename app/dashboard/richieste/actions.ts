'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { canaleDiRichiesta, eGestioneSemplice, type Canale } from '@/lib/richieste'
import { eAppuntamentoVero, tipoDaAzione } from '@/lib/agenda'
import { AVVISO_PRESA_CHIUDENDO, prendiChiudendoEvento } from '@/lib/trattative-server'

export type Esito = { ok: true; avviso?: string } | { ok: false; errore: string }

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
async function canaleAutorizzato(
  idRichiesta: string
): Promise<{ canale: Canale; azione: string | null } | null> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('form_contatti')
    .select('attivita, settore, origine, azione')
    .eq('id', idRichiesta)
    .maybeSingle()
  if (!data) return null

  const canale = canaleDiRichiesta(data)
  if (!canale) return null

  const sezioni = await getSezioniConsentite(emailCorrente())
  if (!sezioni.includes(canale.chiave)) return null

  // L'azione serve a distinguere un messaggio da un appuntamento prenotato:
  // su Club e Family i due si lavorano in modi diversi (vedi salvaGestione).
  return { canale, azione: (data.azione as string) ?? null }
}

async function puoLavorare(idRichiesta: string): Promise<boolean> {
  return !!(await canaleAutorizzato(idRichiesta))
}

/**
 * Se questa richiesta si lavora con l'**interruttore** invece che con l'esito.
 *
 * Due casi, che sembrano diversi e sono la stessa cosa:
 *
 *  - i canali a gestione semplice (Young School, Summer Camp, Chinesis,
 *    padel, Fitness Manager), dove non esiste una trattativa;
 *  - i **messaggi** di Club e Family, dove la trattativa esiste ma il
 *    messaggio non è il lavoro: è il fatto che l'ha aperta.
 *
 * Il secondo caso è la correzione di un equivoco. Un messaggio dal sito aveva
 * un esito suo — «eseguita», «fallita» — che però non faceva avanzare la
 * trattativa di un millimetro: due chiusure scollegate sulla stessa
 * telefonata, e la richiesta finiva per sembrare essa stessa l'opportunità.
 * Un messaggio non si esegue e non fallisce: o l'hai visto o no. Com'è andata
 * lo dicono gli eventi che ne seguono, e come è finita lo dice la trattativa.
 *
 * Gli appuntamenti e le telefonate prenotati dal sito restano fuori: quelli
 * sono impegni veri, presi per un giorno e un'ora, e un impegno si chiude
 * dicendo com'è andato.
 */
function conInterruttore(canale: Canale, azione: string | null): boolean {
  if (eGestioneSemplice(canale)) return true
  return !eAppuntamentoVero(tipoDaAzione(azione))
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
 * La nota **è obbligatoria**, come lo è ovunque si dica che qualcosa è stato
 * lavorato: una richiesta segnata gestita e muta, fra un mese, non dice se la
 * persona si è iscritta, se ci ripensa, o se il numero era sbagliato — e chi
 * la ritrova deve richiamarla per scoprirlo. Resta però **sempre
 * modificabile**, e questa è la differenza con chiudiConEsito: là la nota è
 * il verbale di una chiusura, qui è la nota della richiesta, e si corregge
 * senza riaprire niente.
 *
 * Porta anche la firma di chi l'ha scritta (`note_da`, `note_il`), distinta
 * da `gestito_da`: la nota si corregge senza toccare il gestito, e dopo una
 * correzione le due firme sono davvero di due persone diverse.
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
  const autorizzato = await canaleAutorizzato(input.id)
  if (!autorizzato) return { ok: false, errore: 'Questa richiesta non è nelle tue sezioni.' }
  const { canale, azione } = autorizzato
  if (!conInterruttore(canale, azione)) {
    // Un appuntamento o una telefonata prenotati dal sito sono impegni presi
    // per un giorno e un'ora: si chiudono dicendo com'è andata (chiudiConEsito),
    // o da qui risulterebbero lavorati senza che nessuno l'abbia detto.
    return { ok: false, errore: 'Questo appuntamento si chiude con un esito, non con il gestito.' }
  }

  const nota = (input.nota ?? '').trim()
  if (!nota) {
    return {
      ok: false,
      errore: input.gestito
        ? 'La nota è obbligatoria: scrivi com’è andata.'
        : 'La nota è obbligatoria: scrivi perché la rimetti fra quelle da fare.',
    }
  }

  const email = emailCorrente()
  const supabase = createSupabaseServiceClient()
  const adesso = new Date().toISOString()

  // Togliendo il gestito si toglie anche chi e quando: lasciarli scritti
  // direbbe che la richiesta è stata gestita da qualcuno, mentre l'elenco la
  // rimette fra quelle da fare. La firma della nota invece resta e si
  // aggiorna: quella nota l'ha scritta qualcuno, gestita o no.
  const { error } = await supabase
    .from('form_contatti')
    .update({
      note: nota,
      note_da: email,
      note_il: adesso,
      gestito: input.gestito,
      gestito_da: input.gestito ? email : null,
      gestito_il: input.gestito ? adesso : null,
    })
    .eq('id', input.id)

  if (error) {
    console.error('Gestione non salvata:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a salvare. Riprova.' }
  }

  await registraLog(email, input.gestito ? 'contatto_gestito' : 'contatto_riaperto', {
    entita: 'form_contatti',
    entitaId: input.id,
    dettagli: { canale: canale.chiave, nota },
  })

  // Chi segna gestita la richiesta si prende la trattativa, se non la
  // seguiva nessuno — la stessa regola della chiusura con esito (vedi
  // prendiChiudendoEvento). Solo chiudendo: **riaprire** una richiesta non
  // intesta niente a nessuno, o la si riaprirebbe per prendersi il contatto.
  //
  // Sui canali a gestione semplice non c'è nessuna trattativa da prendere e
  // la funzione esce subito: là il responsabile è uno, ed è chi sta leggendo.
  const presa = input.gestito
    ? await prendiChiudendoEvento('form_contatti', input.id, email)
    : false

  revalidatePath('/dashboard/richieste', 'layout')
  revalidatePath('/dashboard/persone', 'layout')
  revalidatePath('/dashboard')
  return presa ? { ok: true, avviso: AVVISO_PRESA_CHIUDENDO } : { ok: true }
}
