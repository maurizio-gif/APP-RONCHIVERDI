'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { puoCancellare } from '@/lib/auth/permessi'
import { registraLog } from '@/lib/audit'
import { preparaEvento, type EventoDaProgrammare, type ModoEvento } from '@/lib/eventi'
import { AVVISO_TRATTATIVA, trattativaPerEvento } from '@/lib/trattative-server'
import {
  FONTE_MANUALE,
  nomePersona,
  senzaRecapiti,
  validaNuovoContatto,
  type ContattoDaCreare,
} from '@/lib/persone'

// Risultato come valore di ritorno, non un throw: in produzione Next.js
// oscura il messaggio di un errore lanciato da una Server Action.
//
// `avviso` è un successo che va comunque detto: la voce è salvata, ma non
// esattamente come chi scriveva se l'aspettava — il caso vero è il contatto
// «nuovo» che in anagrafica c'era già.
export type Esito = { ok: true; avviso?: string } | { ok: false; errore: string }

async function autorizzato(): Promise<boolean> {
  return utenteHaSezione('agenda')
}

/**
 * Crea a mano una voce d'agenda.
 *
 * Tre cose la governano:
 *
 *  - **il contatto è obbligatorio**. Una voce senza contatto non compariva
 *    nella scheda di nessuno e in agenda era un titolo senza il perché: si
 *    ritrovava solo per caso, scorrendo il giorno giusto.
 *  - **se il contatto non c'è, si crea qui**. Al telefono o al banco arriva
 *    qualcuno che non ha mai compilato un form: prima l'appuntamento non si
 *    poteva fissare — l'unico modo era mandare quella persona sul sito a
 *    scrivere una richiesta per farsi esistere in anagrafica. Il contatto
 *    creato così nasce con fonte `inserimento_manuale`, che è il segno che
 *    lo distingue da chi è arrivato dal sito (vedi lib/persone.ts).
 *  - **programma o registra**, dichiarato. Prima lo indovinava la data (vedi
 *    eGiaAvvenuto): una telefonata appena fatta e annotata per domani restava
 *    «da fare», e un impegno fissato per stamattina nasceva già chiuso.
 *  - **l'evento apre la trattativa**. L'agenda la tiene il settore core, cioè
 *    gli adulti: se un commerciale scrive un evento su una persona, quella
 *    persona è una trattativa in corso, senza bisogno che l'abbia dichiarato
 *    scegliendo un'attività di interesse. Se non ne ha una aperta la apre
 *    l'evento, in gestione a chi l'ha scritto (vedi lib/trattative-server.ts).
 *
 * Le regole sui campi (l'ora ai soli appuntamenti, la durata dal tipo,
 * l'assegnatario a chi scrive) stanno in lib/eventi.ts, le stesse che valgono
 * per i seguiti programmati chiudendo una voce.
 */
export async function creaVoce(formData: FormData): Promise<Esito> {
  if (!(await autorizzato())) return { ok: false, errore: 'Non hai accesso all’agenda.' }

  const contattoNuovo = String(formData.get('contatto_modo') ?? 'elenco') === 'nuovo'
  const personaScelta = String(formData.get('persona_id') ?? '').trim()
  if (!contattoNuovo && !personaScelta) {
    return { ok: false, errore: 'Scegli il contatto a cui agganciare la voce, o creane uno nuovo.' }
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

  // Le note sono obbligatorie su una voce creata a mano, e il controllo sta
  // qui e non in campiEvento: là passano anche i seguiti programmati
  // chiudendo un esito e le correzioni di un evento già fissato, dove la nota
  // è facoltativa perché il contesto ce l'hanno addosso.
  //
  // Qui no: l'oggetto della voce è il nome del contatto e nient'altro (vedi
  // NuovaVoce), quindi senza note la riga dice **chi** e non dice niente su
  // cosa. Chi la trova in agenda fra tre giorni — e a volte non è chi l'ha
  // scritta — ha un nome e un'ora.
  if (!String(formData.get('note') ?? '').trim()) {
    return {
      ok: false,
      errore: 'Scrivi le note: servono a chi apre la voce per prepararsi, e a volte non sei tu.',
    }
  }

  const email = emailCorrente()

  // L'evento si valida **prima** di toccare l'anagrafica: se il titolo manca
  // o la data è nel passato, un contatto nuovo scritto qui resterebbe in
  // anagrafica senza la voce per cui era stato creato.
  const preparato = preparaEvento(evento, email)
  if ('errore' in preparato) return { ok: false, errore: preparato.errore }

  const supabase = createSupabaseServiceClient()

  const contatto = contattoNuovo
    ? await creaContattoAMano(formData, email)
    : await contattoDallElenco(personaScelta)
  if ('errore' in contatto) return { ok: false, errore: contatto.errore }

  const { error } = await supabase.from('task').insert({
    ...preparato.riga,
    entita: 'persona',
    entita_id: contatto.id,
  })

  if (error) {
    console.error('Voce di agenda non creata:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a salvare la voce. Riprova.' }
  }

  // Dopo l'insert e non prima: la trattativa segue l'evento, e aprirla per
  // un evento che poi non si salva lascerebbe in pipeline una persona che
  // nessuno ha messo in agenda. Non blocca il salvataggio se fallisce — vedi
  // trattativaPerEvento.
  const azioneTrattativa = await trattativaPerEvento(contatto.id, email)

  await registraLog(email, modo === 'registra' ? 'evento_registrato' : 'agenda_voce_creata', {
    entita: 'persona',
    entitaId: contatto.id,
    dettagli: {
      titolo: preparato.riga.titolo,
      tipo: preparato.riga.tipo,
      data: preparato.riga.data,
      ora: preparato.riga.ora,
      contatto_creato: contatto.creato,
      trattativa: azioneTrattativa,
    },
  })

  revalidatePath('/dashboard/agenda')
  revalidatePath('/dashboard/richieste/richieste-club')
  // La trattativa appena aperta compare fra le proprie nel Riepilogo: senza
  // questa, chi torna in dashboard non la trova finché non ricarica.
  revalidatePath('/dashboard')
  // Un contatto nuovo compare in anagrafica solo se la si ricalcola: la
  // pagina è dinamica, ma la scheda della persona resta in cache per la
  // navigazione.
  if (contatto.creato) revalidatePath('/dashboard/persone', 'layout')

  // Due cose da dire e un solo banner: il contatto «nuovo» che c'era già, e
  // la trattativa aperta dall'evento. Separate da uno spazio invece che
  // scegliendone una — sono due sorprese diverse, e tacerne una perché ce
  // n'è un'altra è il modo di non farla scoprire a nessuno.
  const avvisi = [contatto.avviso, azioneTrattativa && AVVISO_TRATTATIVA[azioneTrattativa]]
    .filter(Boolean)
    .join(' ')
  return avvisi ? { ok: true, avviso: avvisi } : { ok: true }
}

type ContattoRisolto = {
  id: string
  /** Vero se questa riga d'anagrafica è nata adesso. */
  creato: boolean
  /** Da dire a chi ha scritto, quando il risultato non è quello che chiedeva. */
  avviso?: string
}

/**
 * Il contatto scelto dalla tendina. Deve esistere: un id inventato creerebbe
 * una voce agganciata al nulla, che è il problema da cui siamo partiti.
 */
async function contattoDallElenco(id: string): Promise<ContattoRisolto | { errore: string }> {
  const supabase = createSupabaseServiceClient()
  const { data: persona } = await supabase.from('persone').select('id').eq('id', id).maybeSingle()
  if (!persona) return { errore: 'Contatto non trovato: riscegli dall’elenco.' }
  return { id, creato: false }
}

/**
 * Scrive in anagrafica il contatto che la segreteria ha davanti.
 *
 * Con un recapito passa da `trova_o_crea_persona`, la stessa funzione che usa
 * il trigger delle richieste dal sito: la deduplicazione la fa il database, e
 * rifarla qui — cercando per email e poi inserendo — vorrebbe dire una
 * seconda regola che al primo numero scritto in modo diverso divergerebbe da
 * quella.
 *
 * Ne segue una cosa buona e una da dire: se quella persona in anagrafica
 * c'era già (l'email o il cellulare corrispondono, anche scritti in modo
 * diverso) non nasce un duplicato — la voce va sulla riga che c'era. Ma chi
 * scriveva credeva di creare un contatto nuovo, e va avvisato: la sua nota,
 * fra un mese, sarà nella scheda di quella persona lì.
 *
 * Senza nessun recapito la riga si scrive diretta (vedi
 * inserisciContattoNuovo): non c'è niente su cui deduplicare, e
 * trova_o_crea_persona in quel caso non crea nulla — ritorna null di
 * proposito, perché per una richiesta dal sito una riga senza chiavi sarebbe
 * un duplicato garantito. Qui il caso è diverso: non è un form arrivato da
 * solo, è la segreteria che ha davanti una persona e la sta scrivendo.
 * Meglio una riga da ricontrollare che un appuntamento che non si può
 * prendere.
 */
async function creaContattoAMano(
  formData: FormData,
  email: string | null
): Promise<ContattoRisolto | { errore: string }> {
  const validato = validaNuovoContatto({
    nome: String(formData.get('nuovo_nome') ?? ''),
    cognome: String(formData.get('nuovo_cognome') ?? ''),
    email: String(formData.get('nuovo_email') ?? ''),
    cellulare: String(formData.get('nuovo_cellulare') ?? ''),
  })
  if ('errore' in validato) return validato

  const dati = validato.contatto
  const supabase = createSupabaseServiceClient()

  // Niente email e niente cellulare: non c'è nessuna chiave, e la riga si
  // scrive diretta. Chi si presenta al banco senza lasciare un numero deve
  // poter avere un appuntamento.
  if (senzaRecapiti(dati)) return inserisciContattoNuovo(dati, email)

  // Chi c'era già, guardato **prima** di chiamare la funzione: è l'unico modo
  // di sapere dopo se la riga è nata adesso o se è stata riconosciuta —
  // trova_o_crea_persona ritorna l'id nei due casi e non dice quale dei due
  // è.
  //
  // Il confronto qui è quello letterale, sul recapito come è stato scritto;
  // quello vero lo fa il database sulle cifre normalizzate del numero (vedi
  // normalizza_cellulare). Se ci sfugge, l'avviso non compare: la voce
  // finisce comunque sulla riga giusta, che è la cosa che conta.
  const vuoto = { data: null }
  const [{ data: perEmail }, { data: perCellulare }] = await Promise.all([
    dati.email
      ? supabase
          .from('persone')
          .select('id, nome, cognome, email, cellulare')
          .eq('email', dati.email)
          .maybeSingle()
      : Promise.resolve(vuoto),
    dati.cellulare
      ? supabase
          .from('persone')
          .select('id, nome, cognome, email, cellulare')
          .eq('cellulare', dati.cellulare)
          .limit(1)
          .maybeSingle()
      : Promise.resolve(vuoto),
  ])
  // L'email ha precedenza sul telefono, come nella deduplicazione del
  // database: è il dato che le persone scrivono in modo più stabile.
  const esistente = perEmail ?? perCellulare

  const { data: id, error } = await supabase.rpc('trova_o_crea_persona', {
    p_nome: dati.nome,
    p_cognome: dati.cognome,
    p_email: dati.email,
    p_cellulare: dati.cellulare,
    p_fonte: FONTE_MANUALE,
  })

  if (error) {
    console.error('Contatto non creato dall’agenda:', error.message)
    return {
      errore:
        'Non siamo riusciti a creare il contatto. Controlla email e cellulare, o cercalo in elenco: potrebbe esserci già.',
    }
  }

  // Nessun id senza errore vuol dire una cosa sola: il recapito scritto non
  // è servito da chiave — un numero troppo corto per essere un telefono
  // (vedi normalizza_cellulare). Il contatto entra comunque, come quelli
  // senza recapiti: il numero resta scritto dov'è, per chiamarlo, ma non
  // riconosce nessuno. Il conto di cosa vale come chiave lo fa il database e
  // non lo rifacciamo qui, dove divergerebbe alla prima modifica.
  if (!id) return inserisciContattoNuovo(dati, email)

  const contattoId = String(id)
  // La riga che c'era già, se è proprio quella che la funzione ha restituito.
  const riconosciuta = esistente && esistente.id === contattoId ? esistente : null

  if (!riconosciuta) {
    await registraLog(email, 'persona_creata_a_mano', {
      entita: 'persone',
      entitaId: contattoId,
      dettagli: {
        nome: dati.nome,
        cognome: dati.cognome,
        email: dati.email,
        cellulare: dati.cellulare,
      },
    })
  }

  return {
    id: contattoId,
    creato: !riconosciuta,
    avviso: riconosciuta
      ? `${nomePersona(riconosciuta)} era già in anagrafica: la voce è andata sulla sua scheda, senza creare un doppione.`
      : undefined,
  }
}

/**
 * La riga in anagrafica per un contatto su cui non c'è niente da
 * deduplicare: senza recapiti, o con un recapito che non fa da chiave.
 *
 * È l'unico punto in cui si scrive in `persone` senza passare da
 * trova_o_crea_persona, e ha una ragione precisa: quella funzione, senza
 * email né cellulare normalizzabile, non crea niente — per una richiesta
 * arrivata dal sito una riga senza chiavi sarebbe un duplicato garantito.
 * Qui invece c'è una persona vera davanti a qualcuno che la sta scrivendo.
 *
 * Il prezzo lo si dice a chi scrive, invece di nasconderlo: se in anagrafica
 * esiste già lo stesso nome, l'avviso lo segnala — sono quasi sempre due
 * righe della stessa persona, da unire.
 */
async function inserisciContattoNuovo(
  dati: ContattoDaCreare,
  email: string | null
): Promise<ContattoRisolto | { errore: string }> {
  const supabase = createSupabaseServiceClient()

  // Gli omonimi già in anagrafica: non impediscono niente — due Mario Rossi
  // esistono — ma senza un recapito nessuno potrà dire dopo se erano la
  // stessa persona, e va detto adesso, quando si ha ancora davanti.
  const query = supabase
    .from('persone')
    .select('id, nome, cognome, email, cellulare')
    .ilike('nome', dati.nome)
  const { data: omonimi } = await (dati.cognome
    ? query.ilike('cognome', dati.cognome)
    : query.is('cognome', null))

  const { data: creata, error } = await supabase
    .from('persone')
    .insert({
      nome: dati.nome,
      cognome: dati.cognome,
      // Quello che è stato scritto si scrive, anche se non fa da chiave: un
      // numero troppo corto serve comunque a chiamare, e `cellulare_norm`
      // resta nullo — il calcolo di cosa è una chiave è del database
      // (normalizza_cellulare), non di questo file. L'email qui è sempre
      // vuota (un indirizzo qualsiasi è già una chiave, e quel giro è
      // finito prima), ma non la si butta via per principio.
      email: dati.email,
      cellulare: dati.cellulare,
      fonte: FONTE_MANUALE,
      // Non è uno «storico»: quello è chi è stato importato e mai
      // manifestatosi. Questa persona si è manifestata — è al banco.
      storico: false,
    })
    .select('id')
    .single()

  if (error || !creata) {
    console.error('Contatto senza recapiti non creato:', error?.message ?? 'nessun id')
    return { errore: 'Non siamo riusciti a creare il contatto. Riprova.' }
  }

  const id = String(creata.id)
  await registraLog(email, 'persona_creata_a_mano', {
    entita: 'persone',
    entitaId: id,
    dettagli: {
      nome: dati.nome,
      cognome: dati.cognome,
      cellulare: dati.cellulare,
      senza_chiavi: true,
      omonimi: (omonimi ?? []).length,
    },
  })

  const quanti = (omonimi ?? []).length
  // Il messaggio non dice «senza email né cellulare» ma «senza un recapito
  // che li distingua»: vale anche per chi ha lasciato un numero che non fa
  // da chiave, dove la prima frase sarebbe falsa.
  const quali =
    quanti === 1 ? 'c’era già un contatto con questo nome' : `c’erano già ${quanti} contatti con questo nome`
  return {
    id,
    creato: true,
    avviso: quanti
      ? `Contatto creato. In anagrafica ${quali}, e non abbiamo un recapito con cui distinguerli: controlla in Contatti che non sia la stessa persona.`
      : undefined,
  }
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
