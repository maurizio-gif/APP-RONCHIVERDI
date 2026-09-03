'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { puoCancellare } from '@/lib/auth/permessi'
import { registraLog } from '@/lib/audit'
import {
  DURATA_PREDEFINITA,
  eAppuntamentoVero,
  eEsitoValido,
  eGiaAvvenuto,
  eTipoValido,
  normalizzaOra,
  type Esito as EsitoLavorazione,
  type TipoVoce,
} from '@/lib/agenda'
import type { Esito } from './actions'

// Chiudere una voce dicendo com'è andata, e nello stesso gesto fissare quello
// che ne consegue. Vale per le due sorgenti dell'agenda — le voci della
// segreteria (task) e le richieste arrivate dal sito (form_contatti) — perché
// per chi lavora sono la stessa cosa: qualcosa da chiudere con un esito.

/** Un evento da fissare contestualmente alla chiusura. */
export type EventoDaProgrammare = {
  titolo: string
  tipo: string
  data: string
  /** Solo per gli appuntamenti veri; per gli altri tipi viene ignorata. */
  ora?: string | null
  durataMinuti?: number | null
  assegnatoA?: string | null
  note?: string | null
}

export type OrigineVoce = 'task' | 'form_contatti'

/** Le sezioni che vedono queste voci: chi non ha nemmeno una non può chiudere nulla. */
async function autorizzato(): Promise<boolean> {
  const [agenda, club] = await Promise.all([
    utenteHaSezione('agenda'),
    utenteHaSezione('richieste-club'),
  ])
  return agenda || club
}

function eDataValida(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
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
 * Normalizza un evento da programmare, applicando le stesse regole della
 * creazione a mano: l'ora solo agli appuntamenti, la durata dal tipo quando
 * non è indicata. Ritorna la riga da inserire, oppure un messaggio d'errore.
 */
function rigaEvento(
  evento: EventoDaProgrammare,
  email: string | null,
  collegamento: { entita: string | null; entitaId: string | null }
): { riga: Record<string, unknown> } | { errore: string } {
  const titolo = (evento.titolo ?? '').trim()
  if (!titolo) return { errore: 'Ogni evento programmato ha bisogno di un titolo.' }
  if (!eDataValida(evento.data ?? '')) return { errore: `Data non valida per «${titolo}».` }
  if (!eTipoValido(evento.tipo)) return { errore: `Tipo non valido per «${titolo}».` }

  const tipo: TipoVoce = evento.tipo
  const oraGrezza = eAppuntamentoVero(tipo) ? (evento.ora ?? '') : ''
  const ora = oraGrezza ? normalizzaOra(oraGrezza) : null
  if (oraGrezza && !ora) return { errore: `Ora non valida per «${titolo}» (formato HH:MM).` }

  const durata = Number(evento.durataMinuti)
  const durataMinuti =
    Number.isFinite(durata) && durata > 0 && durata <= 480
      ? Math.round(durata)
      : DURATA_PREDEFINITA[tipo]

  // Un evento fissato nel passato è già avvenuto: la stessa regola della
  // creazione a mano, altrimenti nascerebbe "da fare" e non lo chiuderebbe mai
  // nessuno.
  const giaAvvenuto = eGiaAvvenuto(evento.data, ora)

  return {
    riga: {
      titolo,
      tipo,
      data: evento.data,
      ora,
      durata_minuti: durataMinuti,
      note: (evento.note ?? '').trim() || null,
      assegnato_a: (evento.assegnatoA ?? '').trim() || email,
      creato_da: email,
      stato: giaAvvenuto ? 'completato' : 'aperto',
      completato_il: giaAvvenuto ? new Date().toISOString() : null,
      entita: collegamento.entita,
      entita_id: collegamento.entitaId,
    },
  }
}

/**
 * Chiude una voce con un esito e, se richiesto, fissa gli eventi che ne
 * seguono. La nota è obbligatoria: un esito senza il perché non si rilegge —
 * fra un mese "fallita" da solo non dice se non ha risposto, se ha rifiutato o
 * se era il numero sbagliato.
 */
export async function chiudiConEsito(input: {
  origine: OrigineVoce
  id: string
  esito: string
  nota: string
  eventi?: EventoDaProgrammare[]
}): Promise<Esito> {
  if (!(await autorizzato())) return { ok: false, errore: 'Non hai accesso a questa sezione.' }

  const nota = (input.nota ?? '').trim()
  if (!nota) return { ok: false, errore: 'La nota è obbligatoria: scrivi com’è andata.' }
  if (!eEsitoValido(input.esito)) return { ok: false, errore: 'Esito non valido.' }

  const esito: EsitoLavorazione = input.esito
  const email = emailCorrente()
  const supabase = createSupabaseServiceClient()
  const adesso = new Date().toISOString()

  // Gli eventi si validano prima di toccare il database: se uno è sbagliato,
  // meglio non aver chiuso niente che ritrovarsi la voce chiusa e i suoi
  // seguiti mai creati — senza transazioni, l'unica difesa è l'ordine.
  const eventi = input.eventi ?? []
  const collegamento =
    input.origine === 'form_contatti'
      ? { entita: 'form_contatti', entitaId: input.id }
      : { entita: 'task', entitaId: input.id }

  const righe: Record<string, unknown>[] = []
  for (const evento of eventi) {
    const esitoRiga = rigaEvento(evento, email, collegamento)
    if ('errore' in esitoRiga) return { ok: false, errore: esitoRiga.errore }
    righe.push(esitoRiga.riga)
  }

  if (input.origine === 'task') {
    const { error } = await supabase
      .from('task')
      .update({ stato: 'completato', completato_il: adesso, esito_tipo: esito, esito: nota })
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

  if (righe.length) {
    const { error } = await supabase.from('task').insert(righe)
    if (error) {
      console.error('Eventi programmati non creati:', error.message)
      // La voce è già chiusa: dirlo, invece di far credere che non sia
      // successo niente e far ripetere la chiusura.
      return {
        ok: false,
        errore:
          'La voce è stata chiusa, ma gli eventi programmati non sono stati salvati. Riprova ad aggiungerli.',
      }
    }
  }

  await registraLog(email, esito === 'eseguita' ? 'esito_eseguita' : 'esito_fallita', {
    entita: input.origine,
    entitaId: input.id,
    dettagli: { nota, eventi_programmati: righe.length },
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
