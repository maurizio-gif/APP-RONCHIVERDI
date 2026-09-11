'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ETICHETTE_ESITO,
  ETICHETTE_TIPO_BREVI,
  dataBreve,
  dataOra,
  eAppuntamentoVero,
  eEsitoValido,
  tipoDaAzione,
} from '@/lib/agenda'
import { CLASSE_BADGE_STATO, CLASSE_RIGA_STATO, ETICHETTE_STATO } from '@/lib/pipeline'
import { provenienzaTrattativa } from '@/lib/provenienza'
import { CLASSE_URGENZA, fraseAttesa, giorniDa, urgenzaAttesa } from '@/lib/attesa'
import { inizialiPersona } from '@/lib/persone'
import { nomeDiEmail } from '@/lib/staff'
import { GestioneEvento } from '@/components/GestioneEvento'
import type { EventoCollegato } from './EventiTrattativa'
import type { DatiTrattativa } from './Trattativa'

export type Richiesta = {
  id: string
  created_at: string
  /** Da quale form del sito arriva: distingue i moduli inline di pagina. */
  origine: string | null
  operatore: string | null
  nome: string | null
  cognome: string | null
  email: string | null
  cellulare: string | null
  /** Data di nascita di chi scrive: la chiede il form del Fitness Manager. */
  data_nascita: string | null
  attivita_label: string | null
  settore: string | null
  azione: string | null
  data_scelta: string | null
  ora_scelta: string | null
  messaggio: string | null
  dettagli: string[] | null
  minore_nome: string | null
  minore_cognome: string | null
  minore_data_nascita: string | null
  marketing: boolean | null
  gestito: boolean
  gestito_da: string | null
  gestito_il: string | null
  note: string | null
  /** Chi ha scritto l'ultima versione di `note`, e quando: la firma della nota. */
  note_da: string | null
  note_il: string | null
  esito_tipo: string | null
  esito: string | null
  /** Chi ha scritto la nota di chiusura, e quando. Distinta da gestito_da. */
  esito_da: string | null
  esito_il: string | null
  /** La pagina del sito da cui è partito il form: non l'attività scelta, ma dove si trovava. */
  pagina: string | null
  /** Il pulsante che ha aperto il form: «Prenota un tour», «Richiedi informazioni»… */
  cta: string | null
  /** adulti o junior: lo manda il percorso Young School, e cambia con chi si parla. */
  audience: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  /** First touch: la campagna che l'aveva portato sul sito la prima volta. */
  first_utm_source: string | null
  first_utm_campaign: string | null
  /** La pagina di atterraggio e il sito da cui è arrivato, della visita che ha convertito. */
  landing_page: string | null
  referrer: string | null
  opportunita_id: string | null
  /** Di chi è il lavoro: l'assegnatario della trattativa (vedi il trigger
   *  assegna_eventi_della_trattativa). Distinto da gestito_da/esito_da, che
   *  dicono chi l'ha chiusa. */
  assegnato_a?: string | null
  /** La persona riconosciuta dal database: è la chiave con cui si contano le richieste ripetute. */
  persona_id: string | null
}

/** Diritti e anagrafica del team, passati dal Server Component. */
export type ContestoTrattativa = {
  io: string | null
  sonoCommerciale: boolean
  possoRiassegnare: boolean
  commerciali: string[]
  /** Le trattative per id: una sola riga anche se la persona ha più richieste. */
  trattative: Record<string, DatiTrattativa>
}

export function RigaRichiesta({
  r,
  contesto,
  nomiStaff = {},
  operatori = [],
  puoCancellare = false,
  storico,
  eventi = [],
  gestioneSemplice = false,
  apriSubito = false,
}: {
  r: Richiesta
  contesto?: ContestoTrattativa
  /**
   * Email → "Nome Cognome" dello staff. Sul database le lavorazioni sono
   * firmate con l'email, che è la chiave e sopravvive alla persona; a schermo
   * si legge il nome — su un pannello dove tutti sono @ronchiverdi.it
   * l'indirizzo è la forma meno riconoscibile di una persona.
   *
   * Fuori da `contesto` perché serve a tutti i canali: le trattative sono di
   * Club e Family, le firme delle note sono di chiunque lavori una richiesta.
   */
  nomiStaff?: Record<string, string>
  /** Chi può essere assegnatario di un evento programmato chiudendo la richiesta. */
  operatori?: string[]
  puoCancellare?: boolean
  /**
   * Come si lavora questa richiesta (vedi eGestioneSemplice in
   * lib/richieste.ts). Vero per Young School, Summer Camp, Chinesis, corsi
   * padel e Fitness Manager: là non c'è una trattativa da far avanzare, e la
   * gestione è un interruttore più una nota. Falso per Club e Family, dove
   * la richiesta si chiude con un esito motivato e il suo seguito in agenda.
   */
  gestioneSemplice?: boolean
  /** Che numero è questa richiesta nella storia della persona. */
  storico?: { ordinale: number; totale: number; precedenteIl: string | null }
  /**
   * Gli eventi di agenda nati da questa trattativa. Vuoto dove le trattative
   * non esistono: negli altri canali il responsabile chiama e chiude, non c'è
   * un seguito da programmare.
   */
  eventi?: EventoCollegato[]
  /**
   * La richiesta indicata nell'indirizzo (?richiesta=<id>): si apre da sola e
   * si porta sotto gli occhi. È come ci arriva chi clicca «Accedi al CRM»
   * nell'email che il sito manda al responsabile dell'attività.
   */
  apriSubito?: boolean
}) {
  // Aperta di suo quando si arriva dal link di un'email (vedi
  // app/dashboard/richiesta/[id]): chi ha cliccato «Accedi al CRM» vuole
  // leggere quella richiesta, non cercarla in un elenco di duecento.
  const [aperta, setAperta] = useState(apriSubito)
  const riferimento = useRef<HTMLLIElement>(null)

  // In un elenco lungo la riga giusta può essere sotto la piega: aprirla e
  // lasciarla fuori schermo sarebbe come non averla aperta.
  useEffect(() => {
    if (apriSubito) riferimento.current?.scrollIntoView({ block: 'center' })
  }, [apriSubito])

  const nome = [r.nome, r.cognome].filter(Boolean).join(' ') || '—'
  // Chi è passato dal banco (guest register) va riconosciuto prima di
  // chiamare: non ha scritto dal sito, era qui, e probabilmente ha già
  // parlato con qualcuno della segreteria.
  const walkIn = r.origine === 'walk-in'
  const minore = [r.minore_nome, r.minore_cognome].filter(Boolean).join(' ')

  /**
   * Da dove è entrata la richiesta: Sito, Guest Register, Altro.
   *
   * Diversa da `provenienza` qui sopra, che è la **campagna** (utm_source,
   * utm_medium): quella dice da quale annuncio è arrivato il clic, questa da
   * quale porta è entrata la persona — e sono due cose che si guardano in
   * momenti diversi. Stessa targhetta e stessi colori della dashboard e
   * della scheda contatto.
   */
  const daDove = provenienzaTrattativa({ origineRichiesta: r.origine, haRichiesta: true })

  /** Se la richiesta è in carico a chi sta guardando. */
  const mia = !!r.assegnato_a && r.assegnato_a === contesto?.io

  /**
   * Chi l'ha effettivamente lavorata, col nome per esteso. Su un appuntamento
   * la firma è `esito_da`, su un messaggio `gestito_da`: sono le due chiusure
   * diverse (chiudiConEsito e salvaGestione).
   */
  const chiLHaFatta = nomeDiEmail(r.esito_da ?? r.gestito_da, nomiStaff)

  // Una richiesta ripetuta va detta prima di chiamare: il database riusa la
  // trattativa già aperta senza cambiare niente, quindi in elenco questa riga
  // sarebbe indistinguibile da un contatto nuovo. Chi la prende in mano
  // rischia di ripresentarsi come se fosse il primo contatto — o di
  // richiamare qualcuno che un collega sta già seguendo.
  const ripetuta = !!storico && storico.ordinale > 1
  const trattativa = r.opportunita_id ? contesto?.trattative[r.opportunita_id] : undefined
  const giaSeguitaDa = trattativa?.stato === 'in_gestione' ? trattativa.assegnato_a : null


  // ── Cosa deve dire la riga prima di essere aperta ─────────────────────
  //
  // Le righe erano tutte uguali: nome in nero, tre metadati in grigio
  // separati da puntini, e due pulsanti. Per sapere se una richiesta era da
  // lavorare, se aveva un appuntamento preso, se era Club o Family o da
  // quanto aspettava bisognava aprirla — su venti righe, venti aperture.
  //
  // Ora la riga porta quattro classificazioni, e ognuna ha una forma sua:
  // la banda di colore a sinistra (stato della trattativa), il badge di
  // lavorazione, le targhette di contenuto, e l'attesa colorata.

  /**
   * L'appuntamento preso dal sito: il dato che cambia la giornata di chi è al
   * banco. Null se la persona ha solo lasciato un messaggio — `tipoDaAzione`
   * ne dà comunque un tipo d'agenda (`messaggio`), ma qui serve sapere se c'è
   * uno slot da tenere, non che tipo di voce è.
   */
  const tipo = tipoDaAzione(r.azione)
  const tipoAppuntamento = eAppuntamentoVero(tipo) ? tipo : null

  /**
   * Se questa richiesta si lavora con l'**interruttore** invece che con
   * l'esito. Vero sui canali senza trattativa, e vero anche sui **messaggi**
   * di Club e Family.
   *
   * Un messaggio dal sito aveva un esito suo — «eseguita», «fallita» — che
   * però non faceva avanzare la trattativa di un millimetro: due chiusure
   * scollegate sulla stessa telefonata, e la richiesta finiva per sembrare
   * essa stessa l'opportunità. Ma un messaggio non si esegue e non
   * fallisce: o l'hai visto o no. Com'è andata lo dicono gli eventi che ne
   * seguono, e come è finita lo dice la trattativa.
   *
   * Gli appuntamenti prenotati dal sito restano con l'esito: quelli sono
   * impegni presi per un giorno e un'ora, e un impegno si chiude dicendo
   * com'è andato. La stessa regola sta lato server in conInterruttore
   * (app/dashboard/richieste/actions.ts): qui decide cosa si disegna, là cosa
   * si può salvare.
   */
  const conInterruttore = gestioneSemplice || !tipoAppuntamento

  const oraScelta = r.ora_scelta ? String(r.ora_scelta).slice(0, 5) : null

  // Da quanto aspetta. Su una richiesta chiusa non vuol dire niente: è
  // storia, non una cosa che sta aspettando qualcuno.
  const giorni = giorniDa(r.created_at)
  const giorniAttesa = giorni !== null && !r.gestito ? giorni : null

  // La banda di colore. Dove le trattative non esistono (tutti i canali
  // tranne Club e Family) la riga si colora con la propria lavorazione: da
  // lavorare o chiusa, che lì è tutto il ciclo di vita.
  const classeBanda = trattativa
    ? CLASSE_RIGA_STATO[trattativa.stato]
    : r.gestito
      ? 'stato-chiuso'
      : 'stato-nuovo'

  return (
    <li
      ref={riferimento}
      className={`richiesta riga-stato ${classeBanda}${r.gestito ? ' is-gestita' : ''}${
        aperta ? ' is-aperta' : ''
      }${apriSubito ? ' is-indicata' : ''}`}
    >
      {/* Tutta la testa apre e chiude: è il bersaglio che si colpisce
          naturalmente col mouse. Il pulsante in fondo è quello che la rende
          raggiungibile da tastiera e che annuncia se è aperta. */}
      <div className="richiesta-testa" onClick={() => setAperta((v) => !v)}>
        <div className="richiesta-identita">
          {/* Le iniziali: un punto d'appoggio per l'occhio quando si scorre un
              elenco lungo, lo stesso pallino dell'anagrafica. */}
          <span className="richiesta-iniziali" aria-hidden="true">
            {inizialiPersona(r) || '·'}
          </span>

          <div className="richiesta-corpo">
            <strong className="richiesta-nome">{nome}</strong>
            {minore && <span className="muted"> · per {minore}</span>}

            {/* Quando è arrivata e da quanto aspetta, insieme: la data da sola
                va sottratta a mente, riga per riga. */}
            <div className="richiesta-quando muted">
              <span>{dataOra(r.created_at)}</span>
              {giorniAttesa !== null && (
                <span className={`attesa ${CLASSE_URGENZA[urgenzaAttesa(giorniAttesa)]}`}>
                  · {fraseAttesa(giorniAttesa)}
                </span>
              )}
            </div>

            {/* Le targhette: cosa è questa richiesta. Tonde e in tondo
                minuscolo, per non somigliare ai comandi — che sono
                rettangolari, maiuscoli e si cliccano. */}
            <div className="tag-fila">
              {/* La lavorazione della richiesta è cosa diversa dallo stato
                  della trattativa: una persona in gestione può avere una
                  richiesta nuova ancora da chiudere, ed è quella la cosa da
                  fare adesso.

                  Le parole sono quelle del canale: dove si chiude con un
                  esito la richiesta è «chiusa», dove si gestisce con
                  l'interruttore è «gestita» — la stessa parola scritta sul
                  comando che la muove, o si cercherebbe un pulsante «chiudi»
                  che non c'è. */}
              {r.gestito ? (
                <span className="badge badge-off badge-punto">
                  {conInterruttore ? 'gestita' : 'chiusa'}
                </span>
              ) : (
                <span className="badge badge-warn badge-punto badge-stato">
                  {conInterruttore ? 'da gestire' : 'da lavorare'}
                </span>
              )}

              {/* Lo stato della trattativa, dove prima c'era il pannello
                  intero — etichetta, assegnatario, tendina dei colleghi e
                  cinque pulsanti — aperto su ogni riga dell'elenco. Il
                  pannello sta nei Dettagli; in riga ne resta il fatto, che è
                  quello che serve per scegliere quale riga aprire. */}
              {trattativa && (
                <span
                  className={`badge badge-stato badge-punto ${CLASSE_BADGE_STATO[trattativa.stato]}`}
                >
                  trattativa {ETICHETTE_STATO[trattativa.stato].toLowerCase()}
                </span>
              )}

              {eEsitoValido(r.esito_tipo) && (
                <span
                  className={`badge badge-punto ${
                    r.esito_tipo === 'eseguita' ? 'badge-ok' : 'badge-ko'
                  }`}
                >
                  {ETICHETTE_ESITO[r.esito_tipo]}
                </span>
              )}

              {/* Club o Family, scuola o competizione: la classificazione
                  principale, e prima era un pezzo di riga grigia fra due
                  puntini. */}
              {r.attivita_label && <span className="tag tag-canale">{r.attivita_label}</span>}
              {r.settore && <span className="tag">settore {r.settore}</span>}

              {/* L'appuntamento preso: giorno e ora sulla riga, senza aprire
                  niente. Per chi sta al banco è l'informazione più utile
                  dell'elenco. */}
              {tipoAppuntamento && r.data_scelta && (
                <span className="tag tag-appuntamento">
                  {ETICHETTE_TIPO_BREVI[tipoAppuntamento]} · {dataBreve(r.data_scelta)}
                  {oraScelta && ` ore ${oraScelta}`}
                </span>
              )}
              {r.azione && !tipoAppuntamento && <span className="tag">{r.azione}</span>}

              {/* Da dove arriva, nella stessa targhetta e con gli stessi
                  colori della dashboard e della scheda contatto: Sito, Guest
                  Register, Altro (vedi lib/provenienza.ts). Prima qui c'era
                  solo «Walk-in», cioè il caso raro marcato e il caso normale
                  taciuto — e chi passa da una pagina all'altra del pannello
                  trovava due modi di dire lo stesso fatto. */}
              <span className={`tag-provenienza ${daDove.classe}`}>{daDove.etichetta}</span>

              {/* Di chi è il lavoro, e detto **sempre**. Su una richiesta già
                  lavorata il dato giusto è un altro — chi l'ha fatta — perché
                  sono due fasi distinte: prima si assegna, poi si esegue, e
                  di una ancora aperta non si può sapere chi la farà. Stessa
                  regola di EventiElenco. */}
              {r.gestito && chiLHaFatta ? (
                <span className="tag-assegnato e-fatta">Fatta da {chiLHaFatta}</span>
              ) : (
                <span
                  className={`tag-assegnato${
                    r.assegnato_a ? (mia ? ' e-mio' : ' e-altrui') : ' e-nessuno'
                  }`}
                >
                  {r.assegnato_a
                    ? mia
                      ? 'In carico a te'
                      : `In carico a ${nomeDiEmail(r.assegnato_a, nomiStaff)}`
                    : 'Non assegnato'}
                </span>
              )}

              {ripetuta && (
                <span className="tag tag-avviso">{storico!.ordinale}ª richiesta</span>
              )}

              {/* Che ci sia una nota va visto senza aprire: dove la nota è
                  l'unica cosa che si scrive, una riga muta e una riga con
                  dentro «richiama dopo le 18» si somigliano troppo. */}
              {conInterruttore && r.note && <span className="tag tag-nota">con nota</span>}

              {/* La campagna sta nei Dettagli, sotto «Provenienza», dove era
                  già scritta per esteso: un identificativo di diciotto cifre
                  in riga occupava metà delle targhette e non si legge
                  scorrendo — lo si va a cercare quando serve. */}
            </div>

            {ripetuta && (
              <div className="richiesta-meta richiesta-ripetuta">
                Ha già scritto {storico!.totale === 2 ? 'una volta' : `${storico!.totale - 1} volte`}
                {storico!.precedenteIl && ` · la precedente il ${dataOra(storico!.precedenteIl)}`}
                {giaSeguitaDa && ` · trattativa già seguita da ${giaSeguitaDa}`}
              </div>
            )}

            {walkIn && r.operatore && (
              <div className="richiesta-meta muted">Registrata in sede da {r.operatore}</div>
            )}

          </div>
        </div>

        <div className="richiesta-azioni">
          {/* Un comando solo: apre. «Riapri» stava qui, ma era un comando che
              esisteva in Eventi Core e non in dashboard — ora sta dentro
              l'espansione, accanto alla riga che dice che la richiesta è
              chiusa e da chi, che è dove si finisce a cercarlo. */}
          <button
            type="button"
            className="btn btn-ghost btn-sm richiesta-espandi"
            aria-expanded={aperta}
            onClick={(e) => {
              e.stopPropagation()
              setAperta((v) => !v)
            }}
          >
            {aperta ? 'Chiudi' : 'Apri'}
            {/* La freccia dice da che parte si apre, e ruota una volta
                aperta: una parola da sola non lascia capire se porta altrove
                o mostra qualcosa qui sotto. */}
            <span className="richiesta-caret" aria-hidden="true">
              ▾
            </span>
          </button>
        </div>
      </div>

      {/* L'espansione, una sola: a che punto è la trattativa, chi chiamare,
          cosa ha chiesto, come si chiude questo evento, cosa resta da fare.
          Erano tre pannelli da aprire uno per volta — Dettagli, Gestione,
          Eventi — cioè tre clic per sapere di una richiesta quello che si
          vuole sapere nel momento in cui la si apre, e tre posti in cui
          cercare il comando giusto. La dashboard e l'agenda aprono
          esattamente questo blocco, con gli stessi comandi nello stesso
          ordine. */}
      {aperta && (
        <div className="richiesta-dettagli">
          <GestioneEvento
            r={r}
            trattativa={trattativa}
            contesto={contesto}
            eventi={eventi}
            nomiStaff={nomiStaff}
            operatori={operatori}
            puoCancellare={puoCancellare}
            gestioneSemplice={gestioneSemplice}
          />
        </div>
      )}
    </li>
  )
}
