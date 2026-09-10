'use client'

import { useState, useTransition } from 'react'
import {
  CLASSE_TIPO,
  ETICHETTE_TIPO_BREVI,
  dataBreve,
  eAppuntamentoVero,
  eSoloRegistrato,
  eTipoValido,
  etichettaStato,
  intervalloOrario,
  oggiRoma,
  type VoceAgenda,
} from '@/lib/agenda'
import { nomeDiEmail } from '@/lib/staff'
import { CampiEvento, GestioneEsito } from '@/components/GestioneEsito'
import { ETICHETTE_MODO, MODI, SPIEGAZIONI_MODO, type EventoDaProgrammare, type ModoEvento } from '@/lib/eventi'
import { modificaEvento, programmaEvento, riapriEvento } from '@/app/dashboard/agenda/esito-actions'

/** Un evento di agenda nato da una richiesta, con la richiesta da cui viene. */
export type EventoCollegato = VoceAgenda & { richiestaId: string | null }

// Il seguito di una trattativa, dentro la riga della richiesta.
//
// Gli eventi vivevano solo in Agenda: da qui si potevano creare (chiudendo
// con esito) e poi si perdevano di vista — per sapere se la telefonata di
// richiamo era stata fatta bisognava cercarla in un calendario di tutti.
// Chi lavora una trattativa deve vedere qui cosa ne è seguito, e poterlo
// sistemare senza cambiare pagina.
//
// Gli eventi sono quelli di tutta la trattativa, non solo della singola
// richiesta: la trattativa è della persona, e se ha scritto tre volte le tre
// righe mostrano lo stesso seguito — com'è già per il blocco Trattativa.

export function EventiTrattativa({
  eventi,
  richiestaId,
  titoloSuggerito,
  operatori,
  puoCancellare,
  nomiStaff = {},
}: {
  eventi: EventoCollegato[]
  /** La richiesta a cui si aggancia un evento nuovo creato da qui. */
  richiestaId: string
  /** Il nome della persona: titolo di partenza di un evento nuovo. */
  titoloSuggerito: string
  operatori: string[]
  puoCancellare: boolean
  /** Email → "Nome Cognome" dello staff, per firmare le note di chiusura. */
  nomiStaff?: Record<string, string>
}) {
  // Prima quelli da fare, dal più vicino: è il prossimo passo della
  // trattativa, ed è la ragione per cui si apre il pannello. I chiusi
  // scendono sotto, dal più recente — sono storia, si leggono a ritroso.
  const ordinati = [...eventi].sort((a, b) => {
    if (a.daFare !== b.daFare) return a.daFare ? -1 : 1
    return a.daFare ? a.data.localeCompare(b.data) : b.data.localeCompare(a.data)
  })

  const [nuovo, setNuovo] = useState<EventoDaProgrammare | null>(null)
  const [inModifica, setInModifica] = useState<string | null>(null)
  const [inGestione, setInGestione] = useState<string | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function esegui(azione: () => Promise<{ ok: true } | { ok: false; errore: string }>, poi?: () => void) {
    setErrore(null)
    startTransition(async () => {
      const esito = await azione()
      if (esito.ok) poi?.()
      else setErrore(esito.errore)
    })
  }

  return (
    <div className="eventi">
      <div className="eventi-testa">
        <span className="eventi-titolo">
          Eventi della trattativa {eventi.length > 0 && <span className="muted">({eventi.length})</span>}
        </span>
        {!nuovo && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setErrore(null)
              setNuovo({
                titolo: `Richiamare ${titoloSuggerito}`,
                tipo: 'appuntamento_telefonico',
                data: oggiRoma(),
                ora: '',
                durataMinuti: null,
                assegnatoA: '',
                note: '',
                modo: 'programma',
                esito: 'eseguita',
                notaEsito: '',
              })
            }}
          >
            + Nuovo evento
          </button>
        )}
      </div>

      {eventi.length === 0 && !nuovo && (
        <p className="vuoto">
          Nessun evento fissato. Il seguito si programma da qui, oppure chiudendo la richiesta con
          un esito.
        </p>
      )}

      {eventi.length > 0 && (
        <ul className="eventi-elenco">
          {ordinati.map((evento) => {
            // La richiesta arrivata dal sito è il primo evento della
            // cronologia, ma non è un evento nostro: non l'abbiamo fissata noi.
            const daSito = evento.origine === 'form_contatti'
            // Sulla chiave e non sull'id: mescolando `task` e `form_contatti`
            // due righe di tabelle diverse possono avere lo stesso id, e
            // aprire la modifica di una aprirebbe anche quella dell'altra.
            const aperto = evento.chiave
            return (
            <li key={evento.chiave} className={`evento${evento.daFare ? '' : ' is-chiuso'}`}>
              <div className="evento-riga">
                <span className={`badge-tipo ${CLASSE_TIPO[evento.tipo]}`}>
                  {ETICHETTE_TIPO_BREVI[evento.tipo]}
                </span>

                <span className="evento-quando">
                  {dataBreve(evento.data)}
                  {intervalloOrario(evento.ora, evento.durataMinuti) && (
                    <> · {intervalloOrario(evento.ora, evento.durataMinuti)}</>
                  )}
                </span>

                <span className="evento-titolo">{evento.titolo}</span>

                <span className={`badge ${classeStato(evento)}`}>
                  {etichettaStato(evento.stato, evento.esitoTipo)}
                </span>
              </div>

              <div className="evento-meta muted">
                {daSito
                  ? 'arrivata dal sito'
                  : evento.assegnatoA
                    ? `assegnato a ${nomeDiEmail(evento.assegnatoA, nomiStaff)}`
                    : 'nessun assegnatario'}
                {/* L'evento nato da un'altra richiesta della stessa persona: senza
                    dirlo sembrerebbe fissato su questa. */}
                {evento.richiestaId && evento.richiestaId !== richiestaId && ' · da una richiesta precedente'}
              </div>

              {evento.note && <p className="evento-nota">{evento.note}</p>}
              {evento.esito && (
                <p className="evento-nota">
                  <strong>Esito:</strong> {evento.esito}
                </p>
              )}

              {/* I comandi valgono sugli eventi **nostri**. Quello che è
                  arrivato dal sito non si modifica (non l'abbiamo scritto noi)
                  e non si riapre da qui: è la richiesta stessa, e si gestisce
                  dal suo pannello, sopra. Resta la chiusura con esito, ma solo
                  se è un appuntamento davvero preso — un messaggio non si
                  esegue e non fallisce. */}
              <div className="evento-azioni">
                {!daSito && (
                  <button
                    type="button"
                    className={`btn btn-sm${inModifica === aperto ? '' : ' btn-ghost'}`}
                    aria-expanded={inModifica === aperto}
                    onClick={() => {
                      setErrore(null)
                      setInGestione(null)
                      setInModifica(inModifica === aperto ? null : evento.id)
                    }}
                  >
                    Modifica
                  </button>
                )}

                {evento.daFare ? (
                  (!daSito || eAppuntamentoVero(evento.tipo)) && (
                    <button
                      type="button"
                      className={`btn btn-sm${inGestione === aperto ? '' : ' btn-ghost'}`}
                      aria-expanded={inGestione === aperto}
                      onClick={() => {
                        setErrore(null)
                        setInModifica(null)
                        setInGestione(inGestione === aperto ? null : evento.id)
                      }}
                    >
                      Chiudi con esito
                    </button>
                  )
                ) : daSito ? null : (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={inCorso}
                    onClick={() => esegui(() => riapriEvento(evento.id))}
                  >
                    Riapri
                  </button>
                )}
              </div>

              {inModifica === aperto && (
                <ModuloEvento
                  valori={{
                    titolo: evento.titolo,
                    tipo: evento.tipo,
                    data: evento.data,
                    ora: evento.ora ?? '',
                    durataMinuti: evento.durataMinuti,
                    assegnatoA: evento.assegnatoA ?? '',
                    note: evento.note ?? '',
                  }}
                  operatori={operatori}
                  etichettaSalva="Salva le modifiche"
                  inCorso={inCorso}
                  onSalva={(valori) =>
                    esegui(() => modificaEvento({ id: evento.id, evento: valori }), () =>
                      setInModifica(null)
                    )
                  }
                  onAnnulla={() => setInModifica(null)}
                />
              )}

              {inGestione === aperto && (
                <GestioneEsito
                  origine={evento.origine}
                  id={evento.id}
                  titolo={evento.titolo}
                  operatori={operatori}
                  puoCancellare={puoCancellare}
                  conOrario={eAppuntamentoVero(evento.tipo)}
                  dataCorrente={evento.data}
                  oraCorrente={evento.ora}
                  // Un evento già chiuso si corregge, non si richiude: la
                  // strada di prima passava da «Riapri», che lo rimetteva fra
                  // quelli da fare e lo faceva ricomparire negli arretrati
                  // dell'agenda solo per cambiare una nota.
                  chiusa={!evento.daFare && evento.stato !== 'annullato'}
                  esitoCorrente={evento.esitoTipo}
                  notaCorrente={evento.esito}
                  firma={nomeDiEmail(evento.esitoDa, nomiStaff)}
                  firmaIl={evento.esitoIl}
                />
              )}
            </li>
            )
          })}
        </ul>
      )}

      {nuovo && (
        <ModuloEvento
          valori={nuovo}
          operatori={operatori}
          etichettaSalva="Salva l’evento"
          conModo
          inCorso={inCorso}
          onSalva={(valori) =>
            esegui(
              () =>
                programmaEvento({
                  collegamento: { entita: 'form_contatti', id: richiestaId },
                  evento: valori,
                }),
              () => setNuovo(null)
            )
          }
          onAnnulla={() => setNuovo(null)}
        />
      )}

      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)' }}>
          {errore}
        </p>
      )}
    </div>
  )
}

/**
 * Il colore dello stato. Non basta "chiuso o no": un evento annullato non è
 * mai avvenuto, e in verde direbbe che è andata bene; uno fallito è avvenuto
 * male, e va distinto da uno eseguito.
 */
function classeStato(evento: EventoCollegato): string {
  if (evento.stato === 'annullato') return 'badge-off'
  if (evento.daFare) return 'badge-warn'
  return evento.esitoTipo === 'fallita' ? 'badge-ko' : 'badge-ok'
}

// Gli stessi campi della programmazione in "Chiudi con esito" (CampiEvento):
// creare un evento e correggerne uno sono lo stesso modulo con due pulsanti
// diversi, non due moduli da tenere allineati a mano.
function ModuloEvento({
  valori,
  operatori,
  etichettaSalva,
  conModo = false,
  inCorso,
  onSalva,
  onAnnulla,
}: {
  valori: EventoDaProgrammare
  operatori: string[]
  etichettaSalva: string
  /**
   * L'interruttore programma/registra si mostra solo creando: correggere una
   * voce esistente non deve poterla chiudere o riaprire di rimbalzo — per
   * quello ci sono «Chiudi con esito» e «Riapri».
   */
  conModo?: boolean
  inCorso: boolean
  onSalva: (valori: EventoDaProgrammare) => void
  onAnnulla: () => void
}) {
  const [bozza, setBozza] = useState<EventoDaProgrammare>(valori)

  // Email e WhatsApp non si programmano: scegliendoli, il modo diventa
  // "Registra" e l'altro pulsante sparisce invece di restare lì a promettere
  // qualcosa che il server rifiuterebbe.
  const soloRegistrabile = eTipoValido(bozza.tipo) && eSoloRegistrato(bozza.tipo)
  const modo: ModoEvento = soloRegistrabile || bozza.modo === 'registra' ? 'registra' : 'programma'
  const registra = conModo && modo === 'registra'

  return (
    <div className="esito-evento">
      {conModo && (
        <div className="modo-evento">
          <div className="esito-gruppi" role="group" aria-label="Programma o registra">
            {MODI.filter((m) => !(soloRegistrabile && m === 'programma')).map((m) => (
              <button
                key={m}
                type="button"
                className={`btn btn-sm${modo === m ? '' : ' btn-ghost'}`}
                aria-pressed={modo === m}
                onClick={() => setBozza((b) => ({ ...b, modo: m }))}
              >
                {ETICHETTE_MODO[m]}
              </button>
            ))}
          </div>
          <p className="field-hint">{SPIEGAZIONI_MODO[modo]}</p>
        </div>
      )}

      <CampiEvento
        riga={bozza}
        operatori={operatori}
        onCambia={(campi) => setBozza((b) => ({ ...b, ...campi }))}
        // Registrando si può scegliere anche email e WhatsApp: sono cose già
        // mandate. Programmando no.
        soloProgrammabili={conModo ? modo === 'programma' : !soloRegistrabile}
      />

      {/* Registrare è chiudere: servono l'esito e la nota, gli stessi che
          chiede «Chiudi con esito» — un evento nato chiuso senza il perché
          fra un mese non si rilegge. */}
      {registra && (
        <div className="form-row">
          <div className="field">
            <label>Com&apos;è andata</label>
            <select
              value={bozza.esito ?? 'eseguita'}
              onChange={(e) => setBozza((b) => ({ ...b, esito: e.target.value }))}
            >
              <option value="eseguita">Eseguita</option>
              <option value="fallita">Fallita</option>
            </select>
          </div>
          <div className="field" style={{ flexBasis: '100%' }}>
            <label>
              Nota <span aria-hidden="true">*</span>
            </label>
            <textarea
              rows={2}
              value={bozza.notaEsito ?? ''}
              onChange={(e) => setBozza((b) => ({ ...b, notaEsito: e.target.value }))}
              placeholder={
                bozza.esito === 'fallita'
                  ? 'Perché non è andata: non ha risposto, non è più interessato…'
                  : 'Cosa è stato detto e cosa succede adesso'
              }
            />
          </div>
        </div>
      )}

      <div className="esito-azioni">
        <button
          type="button"
          className="btn btn-sm"
          disabled={inCorso || !bozza.titolo.trim() || (registra && !(bozza.notaEsito ?? '').trim())}
          onClick={() => onSalva(bozza)}
        >
          {inCorso ? 'Salvataggio…' : conModo ? `${ETICHETTE_MODO[modo]} l’evento` : etichettaSalva}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={inCorso} onClick={onAnnulla}>
          Annulla
        </button>
      </div>
    </div>
  )
}
