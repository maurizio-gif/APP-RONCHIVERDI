'use client'

import { useState, useTransition } from 'react'
import { ETICHETTE_ESITO, eEsitoValido, tipoDaAzione } from '@/lib/agenda'
import { GestioneEsito } from '@/components/GestioneEsito'
import { riapriRichiesta } from './actions'
import { Trattativa, type DatiTrattativa } from './Trattativa'

export type Richiesta = {
  id: string
  created_at: string
  /** Da quale form del sito arriva: distingue i moduli inline di pagina. */
  origine: string | null
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
  esito_tipo: string | null
  esito: string | null
  utm_source: string | null
  utm_campaign: string | null
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

/** Numero pronto per wa.me: solo cifre, senza + né spazi. */
function soloCifre(numero: string): string {
  return numero.replace(/[^0-9]/g, '')
}

export function RigaRichiesta({
  r,
  contesto,
  operatori = [],
  puoCancellare = false,
  storico,
}: {
  r: Richiesta
  contesto?: ContestoTrattativa
  /** Chi può essere assegnatario di un evento programmato chiudendo la richiesta. */
  operatori?: string[]
  puoCancellare?: boolean
  /** Che numero è questa richiesta nella storia della persona. */
  storico?: { ordinale: number; totale: number; precedenteIl: string | null }
}) {
  const [aperta, setAperta] = useState(false)
  const [gestioneAperta, setGestioneAperta] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  const nome = [r.nome, r.cognome].filter(Boolean).join(' ') || '—'
  const eQuestionario = r.origine === 'fitness-manager-inline'
  const minore = [r.minore_nome, r.minore_cognome].filter(Boolean).join(' ')

  // Una richiesta ripetuta va detta prima di chiamare: il database riusa la
  // trattativa già aperta senza cambiare niente, quindi in elenco questa riga
  // sarebbe indistinguibile da un contatto nuovo. Chi la prende in mano
  // rischia di ripresentarsi come se fosse il primo contatto — o di
  // richiamare qualcuno che un collega sta già seguendo.
  const ripetuta = !!storico && storico.ordinale > 1
  const trattativa = r.opportunita_id ? contesto?.trattative[r.opportunita_id] : undefined
  const giaSeguitaDa = trattativa?.stato === 'in_gestione' ? trattativa.assegnato_a : null

  function esegui(azione: () => Promise<{ ok: true } | { ok: false; errore: string }>) {
    setErrore(null)
    startTransition(async () => {
      const esito = await azione()
      if (!esito.ok) setErrore(esito.errore)
    })
  }

  return (
    <li
      className={`richiesta${r.gestito ? ' is-gestita' : ''}${
        aperta || gestioneAperta ? ' is-aperta' : ''
      }`}
    >
      {/* Tutta la testa apre e chiude: è il bersaglio che si colpisce
          naturalmente col mouse. Il pulsante in fondo è quello che la rende
          raggiungibile da tastiera e che annuncia se è aperta. */}
      <div className="richiesta-testa" onClick={() => setAperta((v) => !v)}>
        <div>
          <strong>{nome}</strong>
          {minore && <span className="muted"> · per {minore}</span>}
          {ripetuta && (
            <span className="badge badge-warn" style={{ marginLeft: '0.5rem' }}>
              {storico!.ordinale}ª richiesta
            </span>
          )}
          <div className="richiesta-meta muted">
            {dataOra(r.created_at)}
            {r.attivita_label && ` · ${r.attivita_label}`}
            {r.settore && ` · settore ${r.settore}`}
            {r.utm_campaign && ` · campagna ${r.utm_campaign}`}
          </div>
          {ripetuta && (
            <div className="richiesta-meta richiesta-ripetuta">
              Ha già scritto {storico!.totale === 2 ? 'una volta' : `${storico!.totale - 1} volte`}
              {storico!.precedenteIl && ` · la precedente il ${dataOra(storico!.precedenteIl)}`}
              {giaSeguitaDa && ` · trattativa già seguita da ${giaSeguitaDa}`}
            </div>
          )}
        </div>

        <div className="richiesta-azioni">
          {/* Solo la riapertura: prendere in carico segnava la richiesta
              lavorata senza esito e senza il perché, e "Chiudi con esito" —
              nei dettagli qui sotto — continuava a proporla da chiudere. La
              stessa richiesta risultava fatta in agenda e ancora aperta nel
              pannello dell'esito.

              Il click non deve arrivare alla testa, o riaprire la richiesta
              aprirebbe anche il dettaglio. */}
          {r.gestito && (
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
        />
      )}

      {/* Non è un comando ma il fatto già avvenuto: chi l'ha chiusa e quando.
          Diceva "presa in carico" quando la si prendeva in carico a mano; ora
          `gestito` lo scrive solo la chiusura con esito. */}
      {r.gestito && (
        <p className="richiesta-meta muted" style={{ margin: '0.35rem 0 0' }}>
          Chiusa
          {r.gestito_da && ` da ${r.gestito_da}`}
          {r.gestito_il && ` il ${dataOra(r.gestito_il)}`}
        </p>
      )}

      {aperta && (
        <div className="richiesta-dettagli">
          <dl className="dettagli-lista">
            {/* Recapiti cliccabili: i pulsanti Chiama, WhatsApp ed Email non
                stanno più in riga, e un numero da ricopiare a mano sarebbe un
                passo indietro. Qui sono un tocco, ma senza occupare l'elenco. */}
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
                <dd>
                  <a href={`tel:${soloCifre(r.cellulare)}`}>{r.cellulare}</a>
                  {' · '}
                  <a
                    href={`https://wa.me/${soloCifre(r.cellulare)}`}
                    target="_blank"
                    rel="noopener"
                  >
                    WhatsApp
                  </a>
                </dd>
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
            <dd>{r.marketing ? 'acconsente' : 'no'}</dd>
            {r.utm_source && (
              <>
                <dt>Provenienza</dt>
                <dd>
                  {r.utm_source}
                  {r.utm_campaign && ` · ${r.utm_campaign}`}
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
              </>
            )}
            {/* Nota del vecchio riquadro "Note", che non esiste più: la nota
                ora è una sola e si scrive chiudendo l'esito. Le vecchie
                restano leggibili invece di sparire col riquadro. */}
            {r.note && (
              <>
                <dt>Nota precedente</dt>
                <dd>{r.note}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      {/* La gestione ha un'espansione sua, accanto ai dettagli e non dentro:
          chiudere una richiesta è l'azione più frequente, e nasconderla
          sotto i dati costava un clic in più ogni volta. */}
      {gestioneAperta && (
        <div className="richiesta-dettagli">
          {/* Lo stesso pannello dell'agenda: una richiesta dal sito e una voce
              di segreteria si chiudono con lo stesso gesto, e chi lavora non
              deve imparare due schemi. */}
          <GestioneEsito
            origine="form_contatti"
            id={r.id}
            titolo={nome}
            operatori={operatori}
            puoCancellare={puoCancellare}
            // Appuntamento e telefonata sono gli unici che hanno un orario:
            // un messaggio non si sposta di ora perché non ne ha una.
            conOrario={!!tipoDaAzione(r.azione)}
            dataCorrente={r.data_scelta}
            oraCorrente={r.ora_scelta ? String(r.ora_scelta).slice(0, 5) : null}
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
