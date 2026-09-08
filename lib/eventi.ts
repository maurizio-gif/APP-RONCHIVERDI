// Le regole di un evento di agenda: cosa serve per crearne uno, come si
// normalizzano i campi e cosa distingue un evento *programmato* da uno
// *registrato*.
//
// Stavano in due posti — la creazione a mano in agenda (creaVoce) e la
// programmazione dei seguiti alla chiusura di una voce (chiudiConEsito) — con
// gli stessi vincoli scritti due volte. Alla prima divergenza uno dei due
// avrebbe accettato quello che l'altro rifiutava.
//
// Nessun import server-only: lo importano sia le Server Action sia i moduli
// client che disegnano i campi.

import {
  DURATA_PREDEFINITA,
  ETICHETTE_TIPO,
  eAppuntamentoVero,
  eEsitoValido,
  eGiaAvvenuto,
  eSoloRegistrato,
  eTipoValido,
  normalizzaOra,
  type Esito,
  type TipoVoce,
} from './agenda'

/**
 * Un evento nasce in due modi diversi, e confonderli è ciò che rendeva
 * l'agenda inaffidabile:
 *
 *  - `programma` — un impegno futuro. Nasce «da fare» e qualcuno lo chiuderà.
 *  - `registra`  — qualcosa che è già avvenuto e che si sta solo annotando
 *    (una telefonata appena fatta, un'email appena scritta). Nasce chiusa,
 *    con l'esito e il perché.
 *
 * Prima la differenza la indovinava il sistema dalla data (vedi eGiaAvvenuto
 * in lib/agenda.ts): una telefonata registrata a fine giornata restava «da
 * fare» se l'operatore la datava al giorno dopo per sbaglio, e un impegno
 * fissato per stamattina alle 9 nasceva già chiuso. Ora lo dice chi scrive.
 */
export const MODI = ['programma', 'registra'] as const
export type ModoEvento = (typeof MODI)[number]

export const ETICHETTE_MODO: Record<ModoEvento, string> = {
  programma: 'Programma',
  registra: 'Registra',
}

export const SPIEGAZIONI_MODO: Record<ModoEvento, string> = {
  programma: 'Un impegno da tenere: nasce da fare, e resta in agenda finché non lo chiudi.',
  registra: 'Qualcosa che hai già fatto: nasce chiusa, con l’esito e la nota di com’è andata.',
}

export function eModoValido(v: string | null | undefined): v is ModoEvento {
  return !!v && (MODI as readonly string[]).includes(v)
}

/**
 * A cosa è agganciato un evento. **Sempre a qualcosa**: un evento senza
 * contatto è una riga che nessuno ritrova — non compare nella scheda di
 * nessuno, e in agenda è un titolo senza il perché.
 *
 *  - `form_contatti` — la richiesta dal sito da cui l'evento nasce. La usa il
 *    pannello Eventi delle richieste Club e Family.
 *  - `persona` — il contatto in anagrafica. È l'ancora degli eventi creati a
 *    mano dall'agenda: la trattativa è della persona e si chiude e riapre nel
 *    tempo, mentre la persona resta — agganciarli all'opportunità aperta oggi
 *    li farebbe orfani alla prossima.
 */
export const ENTITA_COLLEGAMENTO = ['form_contatti', 'persona'] as const
export type EntitaCollegamento = (typeof ENTITA_COLLEGAMENTO)[number]

/**
 * `task` non si può scegliere: è l'eredità delle voci create prima che il
 * collegamento fosse obbligatorio, e resta solo come ripiego quando si chiude
 * una di quelle e se ne programma il seguito — vedi chiudiConEsito.
 */
export type EntitaEvento = EntitaCollegamento | 'task'

export type CollegamentoEvento = { entita: EntitaEvento; id: string }

export function eEntitaValida(v: string | null | undefined): v is EntitaCollegamento {
  return !!v && (ENTITA_COLLEGAMENTO as readonly string[]).includes(v)
}

/** I dati con cui si crea o si corregge un evento. */
export type EventoDaProgrammare = {
  titolo: string
  tipo: string
  /** 'YYYY-MM-DD' */
  data: string
  /** Solo per gli appuntamenti veri; per gli altri tipi viene ignorata. */
  ora?: string | null
  durataMinuti?: number | null
  assegnatoA?: string | null
  note?: string | null
  /**
   * Assente = si applica la vecchia regola implicita (eGiaAvvenuto): la usano
   * i seguiti programmati chiudendo una voce, che per definizione guardano
   * avanti e non hanno un interruttore da mostrare.
   */
  modo?: ModoEvento
  /** Solo per `registra`: com'è andata. */
  esito?: string | null
  /** Solo per `registra`: la nota obbligatoria di com'è andata. */
  notaEsito?: string | null
}

export function eDataValida(s: string | null | undefined): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s ?? '')
}

/**
 * Vero se quel momento è passato per davvero.
 *
 * Diverso da eGiaAvvenuto, che considera avvenuto anche ciò che cade nella
 * mezz'ora successiva: quella tolleranza serve a non lasciare «da fare» una
 * cosa appena fatta, ma qui servirebbe al contrario — rifiuterebbe di
 * programmare una telefonata fra dieci minuti, che è esattamente il caso più
 * frequente in segreteria.
 */
export function eNelPassato(data: string, ora: string | null): boolean {
  const adesso = new Date()
  const oggi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(adesso)
  if (data > oggi) return false
  if (data < oggi) return true

  // Stesso giorno: senza orario la voce vale «entro la giornata», e la
  // giornata non è ancora finita.
  const pulita = normalizzaOra(ora)
  if (!pulita) return false

  const oraAdesso = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(adesso)
  return pulita < oraAdesso
}

/**
 * Normalizza i campi comuni di un evento: l'ora solo agli appuntamenti veri,
 * la durata dal tipo quando non è indicata, l'assegnatario a chi scrive
 * quando lo lascia vuoto. Ritorna i campi validati o un messaggio d'errore.
 */
export function campiEvento(
  evento: EventoDaProgrammare,
  email: string | null
): { campi: Record<string, unknown>; tipo: TipoVoce; ora: string | null } | { errore: string } {
  const titolo = (evento.titolo ?? '').trim()
  if (!titolo) return { errore: 'Ogni evento ha bisogno di un titolo.' }
  if (!eDataValida(evento.data)) return { errore: `Data non valida per «${titolo}».` }
  if (!eTipoValido(evento.tipo)) return { errore: `Tipo non valido per «${titolo}».` }

  const tipo: TipoVoce = evento.tipo
  // Un'ora su un'email o su una cosa da fare occuperebbe una fascia che il
  // sito può ancora offrire a chi prenota: il vincolo sta qui, non nel form.
  const oraGrezza = eAppuntamentoVero(tipo) ? (evento.ora ?? '') : ''
  const ora = oraGrezza ? normalizzaOra(oraGrezza) : null
  if (oraGrezza && !ora) return { errore: `Ora non valida per «${titolo}» (formato HH:MM).` }

  const durata = Number(evento.durataMinuti)
  const durataMinuti =
    Number.isFinite(durata) && durata > 0 && durata <= 480
      ? Math.round(durata)
      : DURATA_PREDEFINITA[tipo]

  return {
    tipo,
    ora,
    campi: {
      titolo,
      tipo,
      data: evento.data,
      ora,
      durata_minuti: durataMinuti,
      note: (evento.note ?? '').trim() || null,
      // Chi non indica un assegnatario se lo prende in carico: un'agenda con
      // voci di nessuno non si lavora.
      assegnato_a: (evento.assegnatoA ?? '').trim() || email,
    },
  }
}

/**
 * La riga da inserire in `task` per un evento nuovo, con il collegamento a
 * ciò da cui nasce e lo stato che deriva dal modo scelto.
 */
export function rigaEvento(
  evento: EventoDaProgrammare,
  email: string | null,
  collegamento: CollegamentoEvento
): { riga: Record<string, unknown> } | { errore: string } {
  const base = campiEvento(evento, email)
  if ('errore' in base) return base

  // Un'email o un WhatsApp si registrano dopo averli mandati, non si
  // programmano: vedi TIPI_SOLO_REGISTRATI in lib/agenda.ts. Il vincolo sta
  // qui e non solo nel form, così vale anche per i seguiti programmati
  // chiudendo una voce — dove il modo non è nemmeno dichiarato.
  if (eSoloRegistrato(base.tipo) && evento.modo !== 'registra') {
    return {
      errore: `${ETICHETTE_TIPO[base.tipo]} non si programma: mandala e poi registrala, con com'è andata.`,
    }
  }

  if (evento.modo === 'registra') {
    if (!eEsitoValido(evento.esito)) {
      return { errore: 'Per registrare un evento scegli com’è andata: eseguita o fallita.' }
    }
    const nota = (evento.notaEsito ?? '').trim()
    // La stessa nota obbligatoria di ogni altra chiusura: fra un mese
    // «fallita» da solo non dice se non ha risposto, se ha rifiutato o se era
    // il numero sbagliato.
    if (!nota) return { errore: 'La nota è obbligatoria: scrivi com’è andata.' }

    const esito: Esito = evento.esito
    return {
      riga: {
        ...base.campi,
        creato_da: email,
        stato: 'completato',
        completato_il: new Date().toISOString(),
        esito_tipo: esito,
        esito: nota,
        entita: collegamento.entita,
        entita_id: collegamento.id,
      },
    }
  }

  // Programmato: se il momento è già passato non è un impegno, è un appunto —
  // e nascerebbe «da fare» senza che nessuno lo chiuda mai. Meglio dirlo che
  // chiuderlo di nascosto, come faceva la regola implicita.
  if (evento.modo === 'programma' && eNelPassato(evento.data, base.ora)) {
    return {
      errore:
        'Quel momento è già passato: se è una cosa che hai già fatto usa «Registra», altrimenti scegli una data futura.',
    }
  }

  // Senza modo dichiarato resta la vecchia regola: la usano i seguiti creati
  // chiudendo una voce, dove non c'è un interruttore da mostrare.
  const giaAvvenuto = evento.modo ? false : eGiaAvvenuto(evento.data, base.ora)

  return {
    riga: {
      ...base.campi,
      creato_da: email,
      stato: giaAvvenuto ? 'completato' : 'aperto',
      completato_il: giaAvvenuto ? new Date().toISOString() : null,
      entita: collegamento.entita,
      entita_id: collegamento.id,
    },
  }
}
