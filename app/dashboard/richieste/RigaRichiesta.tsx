'use client'

import { useState, useTransition } from 'react'
import {
  ETICHETTE_ESITO,
  ETICHETTE_TIPO_BREVI,
  dataBreve,
  eAppuntamentoVero,
  eEsitoValido,
  tipoDaAzione,
  voceDaContatto,
} from '@/lib/agenda'
import { CLASSE_RIGA_STATO } from '@/lib/pipeline'
import { dominioDi, percorsoBreve, primoContattoDi, provenienzaRichiesta } from '@/lib/percorsoSito'
import { CLASSE_URGENZA, fraseAttesa, giorniDa, urgenzaAttesa } from '@/lib/attesa'
import { inizialiPersona } from '@/lib/persone'
import { nomeDiEmail } from '@/lib/staff'
import { GestioneEsito } from '@/components/GestioneEsito'
import { PercorsoSito } from '@/components/PercorsoSito'
import { ContattiRapidi } from '../ContattiRapidi'
import { riapriRichiesta } from './actions'
import { EventiTrattativa, type EventoCollegato } from './EventiTrattativa'
import { GestioneSemplice } from './GestioneSemplice'
import { Trattativa, type DatiTrattativa } from './Trattativa'

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

function dataOra(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// L'ordine delle domande del questionario (il form del Fitness Manager, in
// src/pages/attivita/personal-training.astro nel repo del sito). Le risposte
// arrivano gia' in quest'ordine, ma il database non lo garantisce: qui si
// legge sempre obiettivo, poi livello, poi frequenza, e una voce che non
// riconosciamo resta in fondo invece di sparire.
const ORDINE_RISPOSTE = ['Obiettivo', 'Livello', 'Frequenza']

function ordinaRisposte(risposte: string[]): string[] {
  const posizione = (r: string) => {
    const i = ORDINE_RISPOSTE.findIndex((etichetta) => r.startsWith(`${etichetta}:`))
    return i === -1 ? ORDINE_RISPOSTE.length : i
  }
  return [...risposte].sort((a, b) => posizione(a) - posizione(b))
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
}) {
  const [aperta, setAperta] = useState(false)
  const [gestioneAperta, setGestioneAperta] = useState(false)
  const [eventiAperti, setEventiAperti] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  const nome = [r.nome, r.cognome].filter(Boolean).join(' ') || '—'
  const eQuestionario = r.origine === 'fitness-manager-inline'
  // Chi è passato dal banco (guest register) va riconosciuto prima di
  // chiamare: non ha scritto dal sito, era qui, e probabilmente ha già
  // parlato con qualcuno della segreteria.
  const walkIn = r.origine === 'walk-in'
  const minore = [r.minore_nome, r.minore_cognome].filter(Boolean).join(' ')
  const provenienza = provenienzaRichiesta(r)
  const primoContatto = primoContattoDi(r)

  // Una richiesta ripetuta va detta prima di chiamare: il database riusa la
  // trattativa già aperta senza cambiare niente, quindi in elenco questa riga
  // sarebbe indistinguibile da un contatto nuovo. Chi la prende in mano
  // rischia di ripresentarsi come se fosse il primo contatto — o di
  // richiamare qualcuno che un collega sta già seguendo.
  const ripetuta = !!storico && storico.ordinale > 1
  const trattativa = r.opportunita_id ? contesto?.trattative[r.opportunita_id] : undefined
  const giaSeguitaDa = trattativa?.stato === 'in_gestione' ? trattativa.assegnato_a : null
  // Il pannello esiste solo dove esistono le trattative: è il loro seguito.
  const conEventi = !!trattativa

  /**
   * La cronologia della trattativa, con **la richiesta stessa in testa**.
   *
   * La richiesta non è il contorno degli eventi: è il primo di essi. È il
   * momento in cui questa persona si è fatta viva, ed è ciò che ha aperto la
   * trattativa. Tenerla fuori dalla cronologia lasciava un elenco di
   * richiami che cominciavano dal nulla — si vedeva «Richiamato il 12» senza
   * vedere perché.
   *
   * Proiettata da `form_contatti`, non copiata in `task`: nessuna riga
   * duplicata da tenere allineata, e quello che è arrivato dal sito resta
   * scritto in un posto solo. È la stessa proiezione che usa l'agenda
   * (voceDaContatto), quindi le due viste non possono divergere.
   */
  const eventoDArrivo: EventoCollegato = { ...voceDaContatto(r), richiestaId: r.id }
  const cronologia = [...eventi, eventoDArrivo]
  const eventiDaFare = eventi.filter((e) => e.daFare).length

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

  /** Chi ha firmato la nota di chiusura, col nome per esteso. */
  const firmaEsito = nomeDiEmail(r.esito_da, nomiStaff)
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

  function esegui(azione: () => Promise<{ ok: true } | { ok: false; errore: string }>) {
    setErrore(null)
    startTransition(async () => {
      const esito = await azione()
      if (!esito.ok) setErrore(esito.errore)
    })
  }

  return (
    <li
      className={`richiesta riga-stato ${classeBanda}${r.gestito ? ' is-gestita' : ''}${
        aperta || gestioneAperta || eventiAperti ? ' is-aperta' : ''
      }`}
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

              {/* Era in reception, non ha scritto dal sito: cambia come ci
                  si presenta a chi si richiama, e va visto senza aprire
                  niente. */}
              {walkIn && <span className="tag tag-walkin">Walk-in</span>}

              {ripetuta && (
                <span className="tag tag-avviso">{storico!.ordinale}ª richiesta</span>
              )}

              {/* Che ci sia una nota va visto senza aprire: dove la nota è
                  l'unica cosa che si scrive, una riga muta e una riga con
                  dentro «richiama dopo le 18» si somigliano troppo. */}
              {conInterruttore && r.note && <span className="tag tag-nota">con nota</span>}

              {r.utm_campaign && <span className="tag">campagna {r.utm_campaign}</span>}
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

            {/* Chiama, WhatsApp, Email: erano dentro «Dettagli», cioè due
                passaggi per il gesto che in segreteria si ripete venti volte
                al giorno. */}
            <ContattiRapidi email={r.email} cellulare={r.cellulare} spiegaSeVuoto />
          </div>
        </div>

        <div className="richiesta-azioni">
          {/* Solo la riapertura: prendere in carico segnava la richiesta
              lavorata senza esito e senza il perché, e "Chiudi con esito" —
              nei dettagli qui sotto — continuava a proporla da chiudere. La
              stessa richiesta risultava fatta in agenda e ancora aperta nel
              pannello dell'esito.

              Il click non deve arrivare alla testa, o riaprire la richiesta
              aprirebbe anche il dettaglio. */}
          {/* Nella gestione semplice non c'è: l'interruttore dentro Gestione
              va nei due sensi, e un secondo comando che fa la stessa cosa
              lascia chiedersi in cosa differiscano. */}
          {r.gestito && !conInterruttore && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={inCorso}
              onClick={(e) => {
                e.stopPropagation()
                esegui(() => riapriRichiesta(r.id))
              }}
            >
              Riapri
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm richiesta-espandi"
            aria-expanded={aperta}
            onClick={(e) => {
              e.stopPropagation()
              setAperta((v) => !v)
            }}
          >
            Dettagli
            {/* La freccia dice da che parte si apre, e ruota una volta
                aperta: "Dettagli" da solo non lascia capire se porta altrove
                o mostra qualcosa qui sotto. */}
            <span className="richiesta-caret" aria-hidden="true">
              ▾
            </span>
          </button>

          <button
            type="button"
            className={`btn btn-sm richiesta-espandi${gestioneAperta ? '' : ' btn-ghost'}`}
            aria-expanded={gestioneAperta}
            onClick={(e) => {
              e.stopPropagation()
              setGestioneAperta((v) => !v)
            }}
          >
            Gestione
            <span className="richiesta-caret" aria-hidden="true">
              ▾
            </span>
          </button>

          {/* Il seguito della trattativa: quante cose restano da fare si vede
              dal pulsante, senza aprirlo. Un conteggio muto («3») direbbe
              quanti eventi ci sono in tutto, che a trattativa chiusa è un
              numero che non chiede niente a nessuno. */}
          {conEventi && (
            <button
              type="button"
              className={`btn btn-sm richiesta-espandi${eventiAperti ? '' : ' btn-ghost'}`}
              aria-expanded={eventiAperti}
              onClick={(e) => {
                e.stopPropagation()
                setEventiAperti((v) => !v)
              }}
            >
              Eventi
              {eventiDaFare > 0 && <span className="richiesta-conteggio">{eventiDaFare}</span>}
              <span className="richiesta-caret" aria-hidden="true">
                ▾
              </span>
            </button>
          )}
        </div>
      </div>

      {/* La trattativa è della persona: compare solo su Club e Family, dove
          esiste un team che se la prende in carico. */}
      {contesto && r.opportunita_id && contesto.trattative[r.opportunita_id] && (
        <Trattativa
          t={contesto.trattative[r.opportunita_id]}
          io={contesto.io}
          sonoCommerciale={contesto.sonoCommerciale}
          possoRiassegnare={contesto.possoRiassegnare}
          commerciali={contesto.commerciali}
          nomiStaff={nomiStaff}
        />
      )}

      {/* Non è un comando ma il fatto già avvenuto: chi l'ha chiusa e quando.
          Diceva "presa in carico" quando la si prendeva in carico a mano; su
          Club e Family ora `gestito` lo scrive solo la chiusura con esito,
          sugli altri canali l'interruttore della gestione semplice. */}
      {r.gestito && (
        <p className="richiesta-meta muted" style={{ margin: '0.35rem 0 0' }}>
          {conInterruttore ? 'Gestita' : 'Chiusa'}
          {r.gestito_da && ` da ${nomeDiEmail(r.gestito_da, nomiStaff)}`}
          {r.gestito_il && ` il ${dataOra(r.gestito_il)}`}
        </p>
      )}

      {aperta && (
        <div className="richiesta-dettagli">
          <dl className="dettagli-lista">
            {/* I recapiti per intero. I comandi Chiama/WhatsApp/Email stanno
                sulla riga (ContattiRapidi), ma qui serve il valore scritto:
                per leggerlo al telefono, per copiarlo, per accorgersi di un
                numero sbagliato. */}
            {r.email && (
              <>
                <dt>Email</dt>
                <dd>
                  <a href={`mailto:${r.email}`}>{r.email}</a>
                </dd>
              </>
            )}
            {r.cellulare && (
              <>
                <dt>Cellulare</dt>
                <dd>{r.cellulare}</dd>
              </>
            )}
            {r.data_nascita && (
              <>
                <dt>Data di nascita</dt>
                <dd>{r.data_nascita}</dd>
              </>
            )}
            {minore && (
              <>
                <dt>Bambino/a</dt>
                <dd>
                  {minore}
                  {r.minore_data_nascita && ` · nato/a il ${r.minore_data_nascita}`}
                </dd>
              </>
            )}
            {r.azione && (
              <>
                <dt>Richiesta</dt>
                <dd>
                  {r.azione}
                  {r.data_scelta && ` · ${r.data_scelta}`}
                  {r.ora_scelta && ` ore ${String(r.ora_scelta).slice(0, 5)}`}
                </dd>
              </>
            )}
            {r.dettagli && r.dettagli.length > 0 && (
              <>
                {/* Per il Fitness Manager quelle righe sono le risposte a
                    domande precise (obiettivo, livello, frequenza), non le
                    caselle "cosa ti interessa" del form generico: chiamarle
                    Interessi le farebbe leggere come preferenze vaghe. */}
                <dt>{eQuestionario ? 'Questionario' : 'Interessi'}</dt>
                <dd>
                  {eQuestionario ? (
                    // Le risposte del questionario sono coppie domanda/valore:
                    // in fila su una riga sola si leggono come un elenco di
                    // interessi, e chi chiama deve rileggerle per capire quale
                    // e' l'obiettivo e quale la frequenza.
                    <ul className="dettagli-risposte">
                      {ordinaRisposte(r.dettagli).map((risposta, i) => {
                        const taglio = risposta.indexOf(':')
                        return taglio === -1 ? (
                          <li key={i}>{risposta}</li>
                        ) : (
                          <li key={i}>
                            <span className="muted">{risposta.slice(0, taglio + 1)}</span>{' '}
                            {risposta.slice(taglio + 1).trim()}
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    r.dettagli.join(', ')
                  )}
                </dd>
              </>
            )}
            {r.messaggio && (
              <>
                {/* Se la persona ha prenotato, quel testo è l'oggetto che ha
                    scritto scegliendo giorno e ora: chiamarlo "Messaggio" lo
                    farebbe sembrare un commento in più, non la ragione
                    dell'incontro. */}
                <dt>
                  {r.azione === 'appuntamento' || r.azione === 'telefonata' ? 'Oggetto' : 'Messaggio'}
                </dt>
                <dd>{r.messaggio}</dd>
              </>
            )}
            <dt>Marketing</dt>
            <dd>
              {r.marketing ? (
                <span className="tag tag-ok">acconsente</span>
              ) : (
                <span className="tag tag-avviso">nessun consenso</span>
              )}
            </dd>
            {/* Dove si trovava sul sito quando ha scritto, e cosa ha premuto.
                È la prima domanda di chi richiama — «mi ha scritto per il
                tennis o stava guardando gli abbonamenti?» — e finora era un
                dato che il sito mandava e il pannello buttava via. */}
            {(r.pagina || r.cta) && (
              <>
                <dt>Ha compilato</dt>
                <dd>
                  {r.pagina ?? 'pagina non registrata'}
                  {r.cta && ` · pulsante «${r.cta}»`}
                </dd>
              </>
            )}
            {r.audience && (
              <>
                <dt>Per chi</dt>
                <dd>{r.audience === 'junior' ? 'Young School (junior)' : r.audience}</dd>
              </>
            )}
            {(provenienza || r.referrer || r.landing_page) && (
              <>
                <dt>Provenienza</dt>
                <dd>
                  {provenienza || (dominioDi(r.referrer) ? `da ${dominioDi(r.referrer)}` : 'diretto')}
                  {/* Il primo contatto si dice solo se racconta un'altra
                      storia: quando coincide con l'ultimo è una ripetizione
                      che allunga la riga e non aggiunge niente. */}
                  {primoContatto && primoContatto !== provenienza && (
                    <span className="muted"> · primo contatto: {primoContatto}</span>
                  )}
                  {r.landing_page && (
                    <span className="muted" title={r.landing_page}>
                      {' '}
                      · atterrato su {percorsoBreve(r.landing_page)}
                    </span>
                  )}
                </dd>
              </>
            )}
            {eEsitoValido(r.esito_tipo) && (
              <>
                <dt>Esito</dt>
                <dd>{ETICHETTE_ESITO[r.esito_tipo]}</dd>
              </>
            )}
            {r.esito && (
              <>
                <dt>Nota di chiusura</dt>
                <dd>{r.esito}</dd>
                {/* Chi l'ha scritta. Le note chiuse prima che la firma
                    esistesse lo dicono, invece di attribuirsi a qualcuno. */}
                <dt>Scritta da</dt>
                <dd>
                  {firmaEsito
                    ? `${firmaEsito}${r.esito_il ? ` — ${dataOra(r.esito_il)}` : ''}`
                    : 'Firma non registrata'}
                </dd>
              </>
            )}
            {/* «Nota precedente» solo sugli appuntamenti prenotati di Club e
                Family: là la nota che conta è quella della chiusura con
                esito, e questa è la vecchia nota libera — leggibile, non più
                scrivibile. Ovunque ci sia l'interruttore (i corsi, e i
                messaggi di Club) è *la* nota: quella che si scrive e si
                corregge dalla gestione. */}
            {r.note && (
              <>
                <dt>{conInterruttore ? 'Nota' : 'Nota precedente'}</dt>
                <dd>{r.note}</dd>
              </>
            )}
          </dl>

          {/* Le pagine viste prima di scrivere. Sta dopo la lista e non dentro
              perché non è una coppia etichetta/valore: è un elenco, e in una
              griglia a due colonne si leggerebbe male. */}
          <PercorsoSito idRichiesta={r.id} paginaForm={r.pagina} apertoSubito />
        </div>
      )}

      {/* La gestione ha un'espansione sua, accanto ai dettagli e non dentro:
          chiudere una richiesta è l'azione più frequente, e nasconderla
          sotto i dati costava un clic in più ogni volta. */}
      {gestioneAperta && (
        <div className="richiesta-dettagli">
          {conInterruttore ? (
            // Un interruttore e una nota. Vale sui canali senza trattativa
            // (Young School, Summer Camp, Chinesis, padel, Fitness Manager) e
            // sui **messaggi** di Club e Family: un messaggio non si esegue e
            // non fallisce — o l'hai visto o no. Quello che ne segue sono gli
            // eventi della trattativa, e come finisce lo dice la trattativa.
            <GestioneSemplice
              id={r.id}
              gestito={r.gestito}
              nota={r.note}
              gestitoDa={nomeDiEmail(r.gestito_da, nomiStaff)}
              gestitoIl={r.gestito_il}
              notaDa={nomeDiEmail(r.note_da, nomiStaff)}
              notaIl={r.note_il}
            />
          ) : (
            // Club e Family: lo stesso pannello dell'agenda. Una richiesta dal
            // sito e una voce di segreteria si chiudono con lo stesso gesto, e
            // chi lavora la pipeline non deve imparare due schemi.
            <GestioneEsito
              origine="form_contatti"
              id={r.id}
              titolo={nome}
              operatori={operatori}
              puoCancellare={puoCancellare}
              // Appuntamento e telefonata sono gli unici che hanno un orario:
              // un messaggio non si sposta di ora perché non ne ha una.
              conOrario={!!tipoAppuntamento}
              dataCorrente={r.data_scelta}
              oraCorrente={r.ora_scelta ? String(r.ora_scelta).slice(0, 5) : null}
              // Già chiusa: il pannello passa da «chiudi» a «correggi», e
              // rivedere una nota non costa più una riapertura — che la
              // rimetterebbe fra quelle da lavorare mentre qualcuno guarda
              // l'elenco.
              chiusa={r.gestito}
              esitoCorrente={eEsitoValido(r.esito_tipo) ? r.esito_tipo : null}
              notaCorrente={r.esito}
              firma={firmaEsito}
              firmaIl={r.esito_il}
            />
          )}
        </div>
      )}

      {/* Gli eventi hanno un'espansione loro, accanto a dettagli e gestione:
          seguire una trattativa e chiudere una richiesta sono due lavori
          diversi, e mettere gli eventi dentro la gestione avrebbe voluto dire
          aprire il pannello di chiusura per controllare un richiamo. */}
      {conEventi && eventiAperti && (
        <div className="richiesta-dettagli">
          <EventiTrattativa
            eventi={cronologia}
            richiestaId={r.id}
            titoloSuggerito={nome}
            operatori={operatori}
            puoCancellare={puoCancellare}
            nomiStaff={nomiStaff}
          />
        </div>
      )}

      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)' }}>
          {errore}
        </p>
      )}
    </li>
  )
}
