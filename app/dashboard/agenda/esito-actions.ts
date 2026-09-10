'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { puoCancellare } from '@/lib/auth/permessi'
import { registraLog } from '@/lib/audit'
import {
  eAppuntamentoVero,
  eEsitoValido,
  eTipoValido,
  normalizzaOra,
  tipoDaAzione,
  type Esito as EsitoLavorazione,
  type TipoVoce,
} from '@/lib/agenda'
import {
  campiEvento,
  eDataValida,
  eEntitaValida,
  rigaEvento,
  type CollegamentoEvento,
  type EventoDaProgrammare,
} from '@/lib/eventi'
import type { Esito } from './actions'

// Chiudere una voce dicendo com'è andata, correggerla dopo, spostarla,
// rimuoverla. Vale per le due sorgenti dell'agenda — le voci della segreteria
// (task) e le richieste arrivate dal sito (form_contatti) — perché per chi
// lavora sono la stessa cosa: qualcosa da chiudere con un esito.
//
// Con un'eccezione, che è la ragione per cui questo file non copre tutto: un
// **messaggio** arrivato dal sito non si chiude con un esito. Non si esegue e
// non fallisce — o l'hai visto o no — e la sua gestione è l'interruttore di
// salvaGestione (app/dashboard/richieste/actions.ts). Com'è andata lo dicono
// gli eventi che ne seguono; come è finita lo dice la trattativa.

// EventoDaProgrammare e le regole di normalizzazione stanno in lib/eventi.ts:
// le usa anche la creazione a mano in agenda (creaVoce), che prima ne aveva
// una copia propria.
export type { EventoDaProgrammare } from '@/lib/eventi'

export type OrigineVoce = 'task' | 'form_contatti'

/**
 * Se questa richiesta è un appuntamento o una telefonata davvero prenotati.
 *
 * Solo quelli sono impegni presi per un giorno e un'ora, e solo quelli si
 * chiudono dicendo com'è andata. Un messaggio è il fatto che ha aperto la
 * trattativa: si segna gestito (salvaGestione) e il seguito sono gli eventi.
 */
async function eAppuntamentoPrenotato(id: string): Promise<boolean> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('form_contatti')
    .select('azione')
    .eq('id', id)
    .maybeSingle()
  return eAppuntamentoVero(tipoDaAzione(data?.azione as string | null))
}

/** Le sezioni che vedono queste voci: chi non ha nemmeno una non può chiudere nulla. */
async function autorizzato(): Promise<boolean> {
  const [agenda, club] = await Promise.all([
    utenteHaSezione('agenda'),
    utenteHaSezione('richieste-club'),
  ])
  return agenda || club
}

// Le pagine che mostrano queste voci: dopo una chiusura vanno tutte rilette,
// altrimenti l'agenda continua a mostrare come da fare qualcosa che nelle
// richieste risulta chiusa.
function rinfresca(): void {
  revalidatePath('/dashboard/agenda')
  revalidatePath('/dashboard/richieste/richieste-club')
  revalidatePath('/dashboard')
}

/**
 * Chiude una voce dicendo com'è andata. La nota è obbligatoria: un esito senza
 * il perché non si rilegge — fra un mese "fallita" da solo non dice se non ha
 * risposto, se ha rifiutato o se era il numero sbagliato.
 *
 * Chiudere e basta: il seguito, se c'è, si fissa dal pannello Eventi della
 * trattativa o da «Aggiungi in agenda». Prima si poteva programmare anche da
 * qui, e lo stesso evento nasceva da due porte diverse che facevano la
 * medesima insert — con in più, qui, il rischio di lasciare la voce chiusa e i
 * suoi seguiti mai creati, perché senza transazioni le due scritture non
 * potevano riuscire o fallire insieme.
 */
export async function chiudiConEsito(input: {
  origine: OrigineVoce
  id: string
  esito: string
  nota: string
}): Promise<Esito> {
  if (!(await autorizzato())) return { ok: false, errore: 'Non hai accesso a questa sezione.' }

  const nota = (input.nota ?? '').trim()
  if (!nota) return { ok: false, errore: 'La nota è obbligatoria: scrivi com’è andata.' }
  if (!eEsitoValido(input.esito)) return { ok: false, errore: 'Esito non valido.' }

  const esito: EsitoLavorazione = input.esito
  const email = emailCorrente()
  const supabase = createSupabaseServiceClient()
  const adesso = new Date().toISOString()

  // Un messaggio arrivato dal sito non si chiude con un esito: non si esegue
  // e non fallisce. Il controllo è qui e non solo nell'interfaccia perché la
  // regola è del modello — senza, una chiamata diretta rimetterebbe sulla
  // richiesta l'esito che abbiamo tolto, e l'ambiguità tornerebbe dalla
  // porta di servizio.
  if (input.origine === 'form_contatti' && !(await eAppuntamentoPrenotato(input.id))) {
    return {
      ok: false,
      errore:
        'Un messaggio dal sito non si chiude con un esito: segnalo gestito, e programma il seguito dalla trattativa.',
    }
  }

  if (input.origine === 'task') {
    const { error } = await supabase
      .from('task')
      .update({
        stato: 'completato',
        completato_il: adesso,
        esito_tipo: esito,
        esito: nota,
        // Chi ha scritto la nota, sulla riga: senza, l'unico modo di saperlo
        // era cercare nel registro operatori l'azione con l'orario giusto.
        esito_da: email,
        esito_il: adesso,
      })
      .eq('id', input.id)
    if (error) {
      console.error('Chiusura voce non riuscita:', error.message)
      return { ok: false, errore: 'Non siamo riusciti a chiudere la voce. Riprova.' }
    }
  } else {
    const { error } = await supabase
      .from('form_contatti')
      .update({
        esito_tipo: esito,
        esito: nota,
        // La firma della nota è sua e non si confonde con quella del gestito:
        // correggendo la nota dopo (vedi correggiEsito) cambia questa, mentre
        // gestito_da continua a dire chi aveva chiuso la richiesta.
        esito_da: email,
        esito_il: adesso,
        // `gestito` resta il segno che la richiesta è stata lavorata: è quello
        // che leggono l'agenda e i contatori delle richieste, e una richiesta
        // chiusa con un esito è lavorata per definizione.
        gestito: true,
        gestito_da: email,
        gestito_il: adesso,
      })
      .eq('id', input.id)
    if (error) {
      console.error('Chiusura richiesta non riuscita:', error.message)
      return { ok: false, errore: 'Non siamo riusciti a chiudere la richiesta. Riprova.' }
    }
  }

  await registraLog(email, esito === 'eseguita' ? 'esito_eseguita' : 'esito_fallita', {
    entita: input.origine,
    entitaId: input.id,
    dettagli: { nota },
  })

  rinfresca()
  return { ok: true }
}

/**
 * Corregge l'esito e la nota di una voce **già chiusa**, senza riaprirla.
 *
 * Serve perché una chiusura non è l'ultima parola. Si segna «eseguita» dopo
 * la telefonata, e il giorno dopo si scopre che la persona non aveva capito e
 * bisogna richiamarla; oppure la nota era di corsa e va completata con quello
 * che è stato detto davvero. Prima l'unica strada era riaprire la voce — che
 * azzera l'esito, la rimette fra quelle da fare e la fa ricomparire negli
 * arretrati — e poi richiuderla: tre gesti, e nel mezzo la voce dice il falso
 * a chiunque guardi l'agenda.
 *
 * Non riapre e non tocca `completato_il`: quando è stata chiusa resta quello.
 * Cambia la nota, chi l'ha scritta e quando — perché è la nota che si sta
 * leggendo, e attribuirla a chi aveva chiuso per primo sarebbe falso.
 *
 * La nota resta obbligatoria: correggere una chiusura cancellandone il perché
 * lascerebbe una voce chiusa e muta, che è esattamente ciò che l'obbligo
 * serve a evitare.
 */
export async function correggiEsito(input: {
  origine: OrigineVoce
  id: string
  esito: string
  nota: string
}): Promise<Esito> {
  if (!(await autorizzato())) return { ok: false, errore: 'Non hai accesso a questa sezione.' }

  const nota = (input.nota ?? '').trim()
  if (!nota) return { ok: false, errore: 'La nota è obbligatoria: scrivi com’è andata.' }
  if (!eEsitoValido(input.esito)) return { ok: false, errore: 'Esito non valido.' }

  const esito: EsitoLavorazione = input.esito
  const email = emailCorrente()
  const supabase = createSupabaseServiceClient()
  const adesso = new Date().toISOString()

  // Solo su una voce già chiusa: su una aperta questo sarebbe un secondo modo
  // di chiudere, senza la traccia della chiusura (`completato_il`, `gestito`)
  // che tutto il resto del pannello legge per sapere cosa è finito.
  const { data: riga, error: erroreLettura } = await supabase
    .from(input.origine)
    .select(input.origine === 'task' ? 'stato, esito_tipo' : 'gestito, esito_tipo')
    .eq('id', input.id)
    .maybeSingle()

  if (erroreLettura || !riga) {
    console.error('Voce da correggere non letta:', erroreLettura?.message)
    return { ok: false, errore: 'Non abbiamo trovato la voce da correggere.' }
  }

  const dati = riga as Record<string, unknown>
  const chiusa = input.origine === 'task' ? dati.stato === 'completato' : dati.gestito === true
  if (!chiusa) {
    return { ok: false, errore: 'Questa voce non è chiusa: usa «Chiudi con esito».' }
  }

  const esitoPrima = eEsitoValido(dati.esito_tipo as string) ? (dati.esito_tipo as string) : null

  const { error } = await supabase
    .from(input.origine)
    .update({ esito_tipo: esito, esito: nota, esito_da: email, esito_il: adesso })
    .eq('id', input.id)

  if (error) {
    console.error('Correzione dell’esito non riuscita:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a salvare la correzione. Riprova.' }
  }

  // La correzione è un'azione sua nel registro: «esito_eseguita» due volte
  // sulla stessa voce non direbbe che la seconda ha riscritto la prima.
  await registraLog(email, 'esito_corretto', {
    entita: input.origine,
    entitaId: input.id,
    dettagli: { da: esitoPrima, a: esito, nota },
  })

  rinfresca()
  return { ok: true }
}

/**
 * Sposta una voce a un altro giorno (e a un'altra ora, se è un appuntamento)
 * senza chiuderla: l'incontro non è andato come previsto, ma non è né
 * eseguito né fallito — è stato rinviato.
 *
 * Senza questa via, un rinvio costava due gesti sbagliati: chiudere "fallita"
 * qualcosa che non è fallito, e poi programmare un evento nuovo. Lo storico
 * ne usciva con una sconfitta che non c'è stata.
 *
 * La nota resta obbligatoria: fra un mese "spostato al 12" senza il perché
 * non dice se ha chiesto lui, se non si è presentato, o se eravamo noi a non
 * poter esserci.
 */
export async function riprogrammaVoce(input: {
  origine: OrigineVoce
  id: string
  nota: string
  data: string
  ora?: string | null
}): Promise<Esito> {
  if (!(await autorizzato())) return { ok: false, errore: 'Non hai accesso a questa sezione.' }

  const nota = (input.nota ?? '').trim()
  if (!nota) return { ok: false, errore: 'La nota è obbligatoria: scrivi perché la riprogrammi.' }
  if (!eDataValida(input.data ?? '')) return { ok: false, errore: 'La nuova data non è valida.' }

  const email = emailCorrente()
  const supabase = createSupabaseServiceClient()

  // Se accetta un'ora lo decide la riga, non il client: il tipo sta sul
  // database, e fidarsi di quello che arriva vorrebbe dire poter mettere un
  // orario su un'email — che occuperebbe una fascia che il sito offre ancora.
  const { data: riga, error: erroreLettura } = await supabase
    .from(input.origine)
    .select(input.origine === 'task' ? 'tipo, data, ora' : 'azione, data_scelta, ora_scelta')
    .eq('id', input.id)
    .maybeSingle()

  if (erroreLettura || !riga) {
    console.error('Voce da riprogrammare non letta:', erroreLettura?.message)
    return { ok: false, errore: 'Non abbiamo trovato la voce da riprogrammare.' }
  }

  const dati = riga as Record<string, unknown>
  const conOrario =
    input.origine === 'task'
      ? eTipoValido(dati.tipo as string) && eAppuntamentoVero(dati.tipo as TipoVoce)
      : dati.azione === 'appuntamento' || dati.azione === 'telefonata'

  const oraGrezza = conOrario ? (input.ora ?? '') : ''
  const ora = oraGrezza ? normalizzaOra(oraGrezza) : null
  if (oraGrezza && !ora) return { ok: false, errore: 'L’ora non è valida (formato HH:MM).' }

  const prima = {
    data: String(dati[input.origine === 'task' ? 'data' : 'data_scelta'] ?? '').slice(0, 10) || null,
    ora: normalizzaOra(dati[input.origine === 'task' ? 'ora' : 'ora_scelta'] as string),
  }

  // La nota si accumula invece di sostituire: una voce rinviata due volte ha
  // due ragioni, e tenere solo l'ultima cancella la prima.
  const riga_nota = `Riprogrammata${prima.data ? ` dal ${prima.data}${prima.ora ? ` ${prima.ora}` : ''}` : ''} al ${input.data}${ora ? ` ${ora}` : ''}: ${nota}`

  const { error } = await supabase
    .from(input.origine)
    .update(
      input.origine === 'task'
        ? { data: input.data, ora, note: riga_nota, stato: 'aperto', completato_il: null }
        : { data_scelta: input.data, ora_scelta: ora }
    )
    .eq('id', input.id)

  if (error) {
    console.error('Riprogrammazione non riuscita:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a riprogrammare la voce. Riprova.' }
  }

  await registraLog(email, 'voce_riprogrammata', {
    entita: input.origine,
    entitaId: input.id,
    dettagli: { da: prima, a: { data: input.data, ora }, nota },
  })

  rinfresca()
  return { ok: true }
}

/**
 * Rimuove del tutto una voce: serve per gli errori e le prove, che non vanno
 * chiuse con un esito ma cancellate — un test rimasto in giro falsa i
 * conteggi di quanto è stato eseguito e quanto è fallito.
 *
 * La nota finisce nel registro operatori prima della cancellazione: la riga
 * spariesce, il perché no.
 */
export async function rimuoviVoce(input: {
  origine: OrigineVoce
  id: string
  nota: string
}): Promise<Esito> {
  if (!(await autorizzato())) return { ok: false, errore: 'Non hai accesso a questa sezione.' }

  const nota = (input.nota ?? '').trim()
  if (!nota) return { ok: false, errore: 'La nota è obbligatoria: scrivi perché la rimuovi.' }

  const email = emailCorrente()
  if (!(await puoCancellare(email))) {
    return { ok: false, errore: 'Non hai il permesso di cancellare.' }
  }

  // Prima il registro, poi la cancellazione: al contrario, un errore di
  // scrittura del log lascerebbe la riga sparita e nessuna traccia del perché.
  await registraLog(email, 'voce_rimossa', {
    entita: input.origine,
    entitaId: input.id,
    dettagli: { nota },
  })

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from(input.origine).delete().eq('id', input.id)
  if (error) {
    console.error('Rimozione non riuscita:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a rimuovere la voce. Riprova.' }
  }

  rinfresca()
  return { ok: true }
}

/**
 * Crea un evento agganciato a una richiesta o a un contatto, senza chiudere
 * niente.
 *
 * Prima si poteva solo chiudendo con esito: per aggiungere una seconda
 * telefonata a una trattativa aperta bisognava chiuderla e riaprirla, oppure
 * andare in Agenda — dove però il collegamento non si poteva creare, e
 * l'evento nasceva orfano.
 *
 * Il collegamento è obbligatorio, ed è il parametro stesso a imporlo: un
 * evento senza contatto non compare nella scheda di nessuno, e in agenda è un
 * titolo senza il perché.
 *
 * Autorizzazione come per la chiusura: chi lavora Club e Family programma e
 * registra i propri eventi anche senza avere la sezione Agenda.
 */
export async function programmaEvento(input: {
  collegamento: CollegamentoEvento
  evento: EventoDaProgrammare
}): Promise<Esito> {
  if (!(await autorizzato())) return { ok: false, errore: 'Non hai accesso a questa sezione.' }

  if (!eEntitaValida(input.collegamento?.entita) || !input.collegamento?.id) {
    return { ok: false, errore: 'Scegli il contatto a cui agganciare l’evento.' }
  }

  const email = emailCorrente()
  const esitoRiga = rigaEvento(input.evento, email, input.collegamento)
  if ('errore' in esitoRiga) return { ok: false, errore: esitoRiga.errore }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('task').insert(esitoRiga.riga)
  if (error) {
    console.error('Evento non creato:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a salvare l’evento. Riprova.' }
  }

  await registraLog(
    email,
    input.evento.modo === 'registra' ? 'evento_registrato' : 'evento_programmato',
    {
      entita: input.collegamento.entita,
      entitaId: input.collegamento.id,
      dettagli: { titolo: esitoRiga.riga.titolo, data: esitoRiga.riga.data },
    }
  )

  rinfresca()
  return { ok: true }
}

/**
 * Modifica un evento già fissato: titolo, tipo, giorno, ora, durata,
 * assegnatario e note.
 *
 * Distinta da riprogrammaVoce, che sposta e basta chiedendo il perché: qui si
 * corregge una voce sbagliata (tipo errato, titolo poco chiaro, persona
 * sbagliata), e chiedere una nota per una correzione riempirebbe lo storico
 * di "corretto un errore di battitura".
 *
 * Stato ed esito non si toccano: chiudere passa solo da "Chiudi con esito",
 * o esisterebbero due modi di chiudere la stessa voce, uno col perché e uno
 * senza.
 */
export async function modificaEvento(input: {
  id: string
  evento: EventoDaProgrammare
}): Promise<Esito> {
  if (!(await autorizzato())) return { ok: false, errore: 'Non hai accesso a questa sezione.' }

  const email = emailCorrente()
  const esito = campiEvento(input.evento, email)
  if ('errore' in esito) return { ok: false, errore: esito.errore }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('task').update(esito.campi).eq('id', input.id)
  if (error) {
    console.error('Evento non modificato:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a salvare le modifiche. Riprova.' }
  }

  await registraLog(email, 'evento_modificato', {
    entita: 'task',
    entitaId: input.id,
    dettagli: esito.campi,
  })

  rinfresca()
  return { ok: true }
}

/**
 * Riporta fra quelle da fare un evento già chiuso.
 *
 * Esiste già in Agenda (riapriVoce), ma là l'autorizzazione è la sezione
 * Agenda: chi lavora Club e Family può chiudere un evento con esito e poi non
 * potrebbe disfare la chiusura sbagliata che ha appena fatto.
 *
 * L'esito si azzera insieme allo stato: una voce riaperta che si portasse
 * dietro il giudizio della lavorazione annullata direbbe il falso.
 */
export async function riapriEvento(id: string): Promise<Esito> {
  if (!(await autorizzato())) return { ok: false, errore: 'Non hai accesso a questa sezione.' }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('task')
    .update({ stato: 'aperto', completato_il: null, esito_tipo: null, esito: null })
    .eq('id', id)

  if (error) {
    console.error('Evento non riaperto:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a riaprire l’evento. Riprova.' }
  }

  await registraLog(emailCorrente(), 'agenda_voce_riaperta', { entita: 'task', entitaId: id })

  rinfresca()
  return { ok: true }
}
