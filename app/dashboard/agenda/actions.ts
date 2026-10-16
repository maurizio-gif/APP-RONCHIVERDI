'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { puoCancellare } from '@/lib/auth/permessi'
import { registraLog } from '@/lib/audit'
import { preparaEvento, type EventoDaProgrammare, type ModoEvento } from '@/lib/eventi'
import { ETICHETTE_TIPO, adessoRoma, dataBreve, oggiRoma, type TipoVoce } from '@/lib/agenda'
import {
  AVVISO_TRATTATIVA,
  assegnaTrattativaDaEvento,
  trattativaPerEvento,
  type EsitoAssegnazioneLead,
} from '@/lib/trattative-server'
import {
  FONTE_MANUALE,
  nomePersona,
  senzaRecapiti,
  validaNuovoContatto,
  type ContattoDaCreare,
} from '@/lib/persone'
import { mappaNomiStaff, nomeDiEmail, type RigaStaff } from '@/lib/staff'
import { dividiTestoContatto } from './nuovo-contatto'
import type { ContattoScegliibile } from './NuovaVoce'

// Risultato come valore di ritorno, non un throw: in produzione Next.js
// oscura il messaggio di un errore lanciato da una Server Action.
//
// `avviso` è un successo che va comunque detto: la voce è salvata, ma non
// esattamente come chi scriveva se l'aspettava — il caso vero è il contatto
// «nuovo» che in anagrafica c'era già.
export type Esito = { ok: true; avviso?: string } | { ok: false; errore: string }

// Anche chi arriva dalla scorciatoia Phone In / Email In deve poter salvare:
// quel permesso apre una pagina che finisce su questa stessa azione, e un
// utente che ha solo quello (senza 'agenda' generico) non deve trovarsi un
// salvataggio rifiutato dopo aver compilato il form.
async function autorizzato(): Promise<boolean> {
  return (await utenteHaSezione('agenda')) || (await utenteHaSezione('phone-email-in'))
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
  //
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
  revalidatePath('/dashboard/agenda-test')
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

// ─────────────────────────────────────────────── Phone In / Email In

/** Cosa si registra: la telefonata ricevuta o l'email arrivata. */
const TIPI_REGISTRA_INBOUND: TipoVoce[] = ['appuntamento_telefonico', 'email']
/** Cosa si può programmare dopo: richiamare, o fissare il tour in sede. */
const TIPI_PROGRAMMA_INBOUND: TipoVoce[] = ['appuntamento_telefonico', 'appuntamento_in_sede']

/**
 * Registra una telefonata o un'email arrivate alla segreteria, e
 * facoltativamente programma il seguito.
 *
 * Il form ha tre sezioni (vedi phone-email-in/PhoneEmailInForm.tsx), e questa
 * azione le ricontrolla tutte prima di scrivere qualunque cosa:
 *
 *  - **contatto**: scelto dopo la verifica, o nuovo con nome, cognome e
 *    cellulare; più il commerciale a cui va il lead, obbligatorio;
 *  - **registra**: tipo e note. Giorno e ora sono adesso — si registra
 *    quello che è appena successo, e chiederli invitava a scriverli a caso —
 *    e l'esito è «eseguita»: la telefonata c'è stata, l'email è arrivata;
 *  - **programma**, facoltativo: una telefonata o un tour in sede, con giorno,
 *    ora e durata scelti, in agenda del commerciale a cui va il lead — è lui
 *    che richiama o accoglie, non la segreteria.
 *
 * Le due voci si validano insieme **prima** di toccare l'anagrafica, come in
 * creaVoce: un seguito con l'ora nel passato non deve lasciare dietro di sé
 * un contatto nuovo senza la telefonata per cui era stato creato.
 */
export async function registraPhoneEmailIn(formData: FormData): Promise<Esito> {
  if (!(await autorizzato())) return { ok: false, errore: 'Non hai accesso all’agenda.' }

  const email = emailCorrente()
  const supabase = createSupabaseServiceClient()

  // ── Contatto ────────────────────────────────────────────────────────────
  const contattoNuovo = String(formData.get('contatto_modo') ?? '') === 'nuovo'
  const personaScelta = String(formData.get('persona_id') ?? '').trim()

  let titolo: string
  if (contattoNuovo) {
    // Validato qui solo per avere il nome da dare alle voci; lo rivalida
    // creaContattoAMano prima di scrivere, con la stessa funzione.
    const validato = validaNuovoContatto(
      {
        nome: String(formData.get('nuovo_nome') ?? ''),
        cognome: String(formData.get('nuovo_cognome') ?? ''),
        email: String(formData.get('nuovo_email') ?? ''),
        cellulare: String(formData.get('nuovo_cellulare') ?? ''),
        prefisso: String(formData.get('nuovo_prefisso') ?? ''),
      },
      { completo: true }
    )
    if ('errore' in validato) return { ok: false, errore: validato.errore }
    titolo = nomePersona(validato.contatto)
  } else {
    if (!personaScelta) {
      return {
        ok: false,
        errore: 'Prima verifica se il contatto c’è già: cercalo e sceglilo, o crealo dopo la ricerca.',
      }
    }
    const { data: persona } = await supabase
      .from('persone')
      .select('id, nome, cognome, email, cellulare')
      .eq('id', personaScelta)
      .maybeSingle()
    if (!persona) return { ok: false, errore: 'Contatto non trovato: rifai la verifica.' }
    titolo = nomePersona(persona)
  }

  // Il commerciale a cui va il lead: uno dei commerciali, non un indirizzo
  // qualsiasi arrivato nel form. Senza, una telefonata registrata qui apriva
  // una trattativa di nessuno, che restava lì finché qualcuno non passava a
  // prenderla.
  const assegnatario = String(formData.get('assegna_lead_a') ?? '').trim().toLowerCase()
  if (!assegnatario) return { ok: false, errore: 'Scegli a quale commerciale assegnare il lead.' }
  const { data: righeCommerciali } = await supabase
    .from('staff_users')
    .select('email, nome, cognome')
    .eq('commerciale', true)
  const commerciali = (righeCommerciali ?? []) as RigaStaff[]
  if (!commerciali.some((c) => c.email.toLowerCase() === assegnatario)) {
    return { ok: false, errore: 'Il lead si assegna a un commerciale: riscegli dall’elenco.' }
  }
  const nomi = mappaNomiStaff(commerciali)

  // ── Registra ────────────────────────────────────────────────────────────
  const tipoRegistrato = String(formData.get('tipo') ?? '')
  if (!TIPI_REGISTRA_INBOUND.includes(tipoRegistrato as TipoVoce)) {
    return { ok: false, errore: 'Scegli cosa registrare: telefonata o email.' }
  }
  const note = String(formData.get('note') ?? '').trim()
  if (!note) {
    return { ok: false, errore: 'Scrivi le note: cosa ha chiesto o scritto, e cosa succede adesso.' }
  }

  const adesso = adessoRoma()
  const oraAdesso = `${String(adesso.getUTCHours()).padStart(2, '0')}:${String(adesso.getUTCMinutes()).padStart(2, '0')}`
  const registrato = preparaEvento(
    {
      titolo,
      tipo: tipoRegistrato,
      data: oggiRoma(),
      ora: oraAdesso,
      note,
      modo: 'registra',
      esito: 'eseguita',
      notaEsito: note,
    },
    email
  )
  if ('errore' in registrato) return { ok: false, errore: registrato.errore }

  // ── Programma (facoltativo) ─────────────────────────────────────────────
  const conProgramma = String(formData.get('programma') ?? '') === '1'
  let programmato: Record<string, unknown> | null = null
  if (conProgramma) {
    const tipoProgramma = String(formData.get('prog_tipo') ?? '')
    if (!TIPI_PROGRAMMA_INBOUND.includes(tipoProgramma as TipoVoce)) {
      return { ok: false, errore: 'Scegli cosa programmare: telefonata o tour in sede.' }
    }
    const data = String(formData.get('prog_data') ?? '').trim()
    const ora = String(formData.get('prog_ora') ?? '').trim()
    if (!data || !ora) {
      return { ok: false, errore: 'Per programmare servono giorno e ora.' }
    }
    const preparato = preparaEvento(
      {
        titolo,
        tipo: tipoProgramma,
        data,
        ora,
        durataMinuti: Number(String(formData.get('prog_durata') ?? '')) || null,
        // Le note del seguito, se ci sono; altrimenti quelle della telefonata
        // appena registrata, che sono proprio ciò che serve sapere a chi
        // richiama.
        note: String(formData.get('prog_note') ?? '').trim() || note,
        assegnatoA: assegnatario,
        modo: 'programma',
      },
      email
    )
    if ('errore' in preparato) return { ok: false, errore: preparato.errore }
    programmato = preparato.riga
  }

  // ── Scrittura ───────────────────────────────────────────────────────────
  const contatto = contattoNuovo
    ? await creaContattoAMano(formData, email, true)
    : await contattoDallElenco(personaScelta)
  if ('errore' in contatto) return { ok: false, errore: contatto.errore }

  const collegamento = { entita: 'persona', entita_id: contatto.id }
  const righe = [{ ...registrato.riga, ...collegamento }]
  if (programmato) righe.push({ ...programmato, ...collegamento })
  // Un insert solo per le due voci: o entrano tutte e due, o nessuna.
  const { error } = await supabase.from('task').insert(righe)
  if (error) {
    console.error('Phone In / Email In non registrato:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a salvare. Riprova.' }
  }

  const lead = await assegnaTrattativaDaEvento(
    contatto.id,
    assegnatario,
    email,
    tipoRegistrato === 'email' ? 'email' : 'telefonata'
  )

  await registraLog(email, 'evento_registrato', {
    entita: 'persona',
    entitaId: contatto.id,
    dettagli: {
      titolo,
      tipo: tipoRegistrato,
      phone_email_in: true,
      contatto_creato: contatto.creato,
      lead_assegnato_a: assegnatario,
      lead_gia_di: lead?.giaDi ?? null,
      trattativa: lead?.azione ?? null,
      programmato: programmato
        ? { tipo: programmato.tipo, data: programmato.data, ora: programmato.ora }
        : null,
    },
  })

  revalidatePath('/dashboard/agenda')
  revalidatePath('/dashboard/agenda-test')
  revalidatePath('/dashboard/richieste/richieste-club')
  revalidatePath('/dashboard')
  if (contatto.creato) revalidatePath('/dashboard/persone', 'layout')

  const avvisoProgramma = programmato
    ? `${ETICHETTE_TIPO[programmato.tipo as TipoVoce]} programmata per ${dataBreve(String(programmato.data))} alle ${programmato.ora}, in agenda di ${nomeDiEmail(assegnatario, nomi)}.`
    : null
  const avvisi = [contatto.avviso, avvisoLead(lead, assegnatario, nomi), avvisoProgramma]
    .filter(Boolean)
    .join(' ')
  return avvisi ? { ok: true, avviso: avvisi } : { ok: true }
}

/**
 * Cosa dire dopo un Phone In / Email In sul lead: a chi è andato, o perché non
 * è andato a chi era stato scelto. Il caso da non tacere è il lead già seguito
 * da un collega: chi ha scelto un commerciale si aspetta che sia suo.
 */
function avvisoLead(
  lead: EsitoAssegnazioneLead | null,
  assegnatario: string,
  nomi: Record<string, string>
): string | null {
  if (!lead) {
    return 'La trattativa non si è aperta: assegna il lead dalla scheda del contatto.'
  }
  if (lead.giaDi) {
    return `La trattativa di questo contatto la segue già ${nomeDiEmail(lead.giaDi, nomi)}: resta a chi la segue, non è stata riassegnata.`
  }
  const chi = nomeDiEmail(assegnatario, nomi)
  switch (lead.azione) {
    case 'creata':
      return `Aperta la trattativa di questo contatto, assegnata a ${chi}.`
    case 'presa_in_carico':
      return `La trattativa di questo contatto era libera: ora è assegnata a ${chi}.`
    case 'avviata':
      return `La trattativa di questo contatto, già di ${chi}, è passata in gestione.`
    default:
      return null
  }
}

/** Quanti contatti mostra al più la verifica: oltre, si chiede di restringere. */
const RISULTATI_VERIFICA = 20

export type EsitoVerifica =
  | { ok: true; contatti: ContattoScegliibile[]; altri: boolean }
  | { ok: false; errore: string }

/**
 * La verifica «c'è già?» di Phone In / Email In, su **tutta** l'anagrafica.
 *
 * Il form dell'agenda filtra in memoria i 300 contatti più recenti: per
 * scegliere chi ha appena scritto va bene, per dire «non esiste» no — in
 * anagrafica ce ne sono più di ventimila, compresi tutti i soci Info4U, e un
 * «nessun risultato» su un elenco parziale faceva creare il doppione di un
 * socio.
 *
 * Nome e cognome (in qualsiasi ordine) ed email passano da cerca_persone, la
 * stessa ricerca della sezione Contatti. Il cellulare no: là si confronta il
 * testo, e «333 123 4567» non trova «+39 3331234567». Qui si cercano le
 * ultime nove cifre fra le sole cifre del cellulare (cerca_persone_per_cellulare,
 * scripts/sql/2026-10-14-cerca-persone-per-cellulare.sql) — non su
 * `cellulare_norm`, che per quasi tutti i soci Info4U è vuoto.
 */
export async function cercaContattiPerVerifica(testo: string): Promise<EsitoVerifica> {
  if (!(await autorizzato())) return { ok: false, errore: 'Non hai accesso all’agenda.' }

  const cercato = testo.trim()
  if (cercato.length < 3) {
    return { ok: false, errore: 'Scrivi almeno tre caratteri: nome e cognome, email o cellulare.' }
  }

  const supabase = createSupabaseServiceClient()
  const campi = dividiTestoContatto(cercato)

  if (campi.cellulare) {
    // Le ultime nove: tolgono il prefisso internazionale, scritto o no, e
    // bastano a riconoscere un cellulare italiano.
    const cifre = campi.cellulare.replace(/\D/g, '').slice(-9)
    const { data, error } = await supabase.rpc('cerca_persone_per_cellulare', {
      p_cifre: cifre,
      p_limite: RISULTATI_VERIFICA + 1,
    })
    if (error) {
      console.error('Verifica contatto per cellulare non riuscita:', error.message)
      return { ok: false, errore: 'La ricerca non è riuscita. Riprova.' }
    }
    const righe = (data ?? []) as ContattoScegliibile[]
    return { ok: true, contatti: righe.slice(0, RISULTATI_VERIFICA), altri: righe.length > RISULTATI_VERIFICA }
  }

  const { data, error } = await supabase.rpc('cerca_persone', {
    p_query: cercato,
    p_limite: RISULTATI_VERIFICA + 1,
  })
  if (error) {
    console.error('Verifica contatto non riuscita:', error.message)
    return { ok: false, errore: 'La ricerca non è riuscita. Riprova.' }
  }
  const righe = ((data ?? []) as ContattoScegliibile[]).map((r) => ({
    id: r.id,
    nome: r.nome,
    cognome: r.cognome,
    email: r.email,
    cellulare: r.cellulare,
  }))
  return { ok: true, contatti: righe.slice(0, RISULTATI_VERIFICA), altri: righe.length > RISULTATI_VERIFICA }
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
  email: string | null,
  completo = false
): Promise<ContattoRisolto | { errore: string }> {
  const validato = validaNuovoContatto(
    {
      nome: String(formData.get('nuovo_nome') ?? ''),
      cognome: String(formData.get('nuovo_cognome') ?? ''),
      email: String(formData.get('nuovo_email') ?? ''),
      cellulare: String(formData.get('nuovo_cellulare') ?? ''),
      // Solo Phone In / Email In manda il prefisso della tendina: altrove il
      // numero arriva com'è stato scritto.
      prefisso: String(formData.get('nuovo_prefisso') ?? ''),
    },
    { completo }
  )
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
  // Stessa funzione di lookup che usa trova_o_crea_persona (nome+cognome,
  // cellulare a disambiguare gli omonimi — vedi
  // scripts/sql/2026-09-23-dedup-nome-cognome.sql): rifare qui il confronto a
  // mano, sull'email o sul cellulare come sono stati scritti, direbbe spesso
  // una cosa diversa da quella che decide davvero il database.
  const { data: idEsistente } = await supabase.rpc('trova_persona_per_nome_e_cellulare', {
    p_nome: dati.nome,
    p_cognome: dati.cognome,
    p_cellulare: dati.cellulare,
  })
  const { data: esistente } = idEsistente
    ? await supabase
        .from('persone')
        .select('id, nome, cognome, email, cellulare')
        .eq('id', idEsistente as string)
        .maybeSingle()
    : { data: null }

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
