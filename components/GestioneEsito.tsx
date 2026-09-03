'use client'

import { useState, useTransition } from 'react'
import {
  DURATA_PREDEFINITA,
  OPZIONI_TIPO,
  eAppuntamentoVero,
  eTipoValido,
  oggiRoma,
  type TipoVoce,
} from '@/lib/agenda'
import {
  chiudiConEsito,
  rimuoviVoce,
  riprogrammaVoce,
  type EventoDaProgrammare,
  type OrigineVoce,
} from '@/app/dashboard/agenda/esito-actions'

// La chiusura di una voce, uguale in agenda e nelle richieste dal sito: si
// scrive com'è andata e, se serve, si fissa subito il seguito. Il pannello è
// uno solo perché il gesto è lo stesso — due copie avrebbero preso strade
// diverse alla prima modifica.

type Gruppo = 'eseguita' | 'fallita' | 'riprogrammata' | 'annullata'

const GRUPPI: { chiave: Gruppo; etichetta: string }[] = [
  { chiave: 'eseguita', etichetta: 'Eseguita' },
  { chiave: 'fallita', etichetta: 'Fallita' },
  // Riprogrammata non è un esito e non chiude niente: la voce resta aperta a
  // un'altra data. Sta qui perché è la terza cosa che si vuole fare aprendo
  // la gestione, e cercarla altrove avrebbe portato a chiudere "fallita"
  // qualcosa che è stato solo rinviato.
  { chiave: 'riprogrammata', etichetta: 'Riprogrammata' },
  { chiave: 'annullata', etichetta: 'Annullata' },
]

/** Una riga del programmatore, con un id locale per poterla togliere. */
type RigaEvento = EventoDaProgrammare & { chiaveLocale: number }

function rigaVuota(chiaveLocale: number): RigaEvento {
  return {
    chiaveLocale,
    titolo: '',
    tipo: 'appuntamento_telefonico',
    data: oggiRoma(),
    ora: '',
    durataMinuti: null,
    assegnatoA: '',
    note: '',
  }
}

export function GestioneEsito({
  origine,
  id,
  titolo,
  operatori,
  puoCancellare,
  conOrario = false,
  dataCorrente,
  oraCorrente,
}: {
  origine: OrigineVoce
  id: string
  /** Il nome della voce, per i messaggi di conferma e i titoli suggeriti. */
  titolo: string
  operatori: string[]
  puoCancellare: boolean
  /** Se la voce è un appuntamento vero: solo quelli si spostano anche di ora. */
  conOrario?: boolean
  /** Giorno e ora attuali, come punto di partenza della riprogrammazione. */
  dataCorrente?: string | null
  oraCorrente?: string | null
}) {
  const [gruppo, setGruppo] = useState<Gruppo | null>(null)
  const [nota, setNota] = useState('')
  const [eventi, setEventi] = useState<RigaEvento[]>([])
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  // Si parte da dov'è adesso: chi rinvia sposta di qualche giorno, e
  // ridigitare la data da zero è lavoro in più per arrivare vicino a quella
  // che c'era già.
  const [nuovaData, setNuovaData] = useState(dataCorrente || oggiRoma())
  const [nuovaOra, setNuovaOra] = useState(oraCorrente ?? '')

  // Il contatore non torna indietro: riusare l'indice come chiave farebbe
  // ereditare a una riga i valori di quella cancellata sopra di lei.
  const [prossimaChiave, setProssimaChiave] = useState(1)

  function aggiungiEvento() {
    setEventi((e) => [...e, rigaVuota(prossimaChiave)])
    setProssimaChiave((n) => n + 1)
  }

  function aggiorna(chiaveLocale: number, campi: Partial<RigaEvento>) {
    setEventi((e) => e.map((r) => (r.chiaveLocale === chiaveLocale ? { ...r, ...campi } : r)))
  }

  function esegui(azione: () => Promise<{ ok: true } | { ok: false; errore: string }>) {
    setErrore(null)
    startTransition(async () => {
      const esito = await azione()
      if (esito.ok) {
        setGruppo(null)
        setNota('')
        setEventi([])
      } else {
        setErrore(esito.errore)
      }
    })
  }

  function riprogramma() {
    if (!nota.trim()) return setErrore('La nota è obbligatoria: scrivi perché la riprogrammi.')
    if (!nuovaData) return setErrore('Scegli il nuovo giorno.')
    esegui(() =>
      riprogrammaVoce({ origine, id, nota, data: nuovaData, ora: conOrario ? nuovaOra : null })
    )
  }

  function chiudi(conEventi: boolean) {
    if (!gruppo || gruppo === 'annullata' || gruppo === 'riprogrammata') return
    if (!nota.trim()) return setErrore('La nota è obbligatoria: scrivi com’è andata.')
    if (conEventi && eventi.length === 0) {
      return setErrore('Aggiungi almeno un evento, oppure chiudi senza programmare.')
    }
    esegui(() =>
      chiudiConEsito({
        origine,
        id,
        esito: gruppo,
        nota,
        eventi: conEventi ? eventi.map(({ chiaveLocale, ...resto }) => resto) : [],
      })
    )
  }

  function rimuovi() {
    if (!nota.trim()) return setErrore('La nota è obbligatoria: scrivi perché la rimuovi.')
    if (!confirm(`Rimuovere definitivamente «${titolo}»? L’operazione non si annulla.`)) return
    esegui(() => rimuoviVoce({ origine, id, nota }))
  }

  return (
    <div className="esito">
      <div className="esito-titolo">Chiudi con esito</div>

      <div className="esito-gruppi" role="group" aria-label="Esito della lavorazione">
        {GRUPPI.map((g) => (
          <button
            key={g.chiave}
            type="button"
            className={`btn btn-sm${gruppo === g.chiave ? '' : ' btn-ghost'}`}
            aria-pressed={gruppo === g.chiave}
            onClick={() => {
              setErrore(null)
              setGruppo(gruppo === g.chiave ? null : g.chiave)
            }}
          >
            {g.etichetta}
          </button>
        ))}
      </div>

      {gruppo && (
        <>
          <div className="field">
            <label htmlFor={`nota-${origine}-${id}`}>
              Nota <span aria-hidden="true">*</span>
            </label>
            <textarea
              id={`nota-${origine}-${id}`}
              rows={3}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder={
                gruppo === 'fallita'
                  ? 'Perché non è andata: non ha risposto, non è più interessato…'
                  : gruppo === 'annullata'
                    ? 'Perché la rimuovi: creata per errore, prova, doppione…'
                    : gruppo === 'riprogrammata'
                      ? 'Perché si sposta: ha chiesto lui, non si è presentato, imprevisto nostro…'
                      : 'Cosa è stato detto e cosa succede adesso'
              }
            />
          </div>

          {gruppo === 'riprogrammata' ? (
            <>
              <div className="form-row">
                <div className="field">
                  <label htmlFor={`data-${origine}-${id}`}>Nuovo giorno</label>
                  <input
                    id={`data-${origine}-${id}`}
                    type="date"
                    value={nuovaData}
                    onChange={(e) => setNuovaData(e.target.value)}
                  />
                </div>
                {/* L'ora solo per gli appuntamenti veri, come in tutto il
                    resto: un'email o una cosa da fare si spostano di giorno. */}
                {conOrario && (
                  <div className="field">
                    <label htmlFor={`ora-${origine}-${id}`}>Nuova ora</label>
                    <input
                      id={`ora-${origine}-${id}`}
                      type="time"
                      value={nuovaOra}
                      onChange={(e) => setNuovaOra(e.target.value)}
                    />
                    <p className="field-hint">Vuota = entro la giornata.</p>
                  </div>
                )}
              </div>

              <div className="esito-azioni">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={inCorso}
                  onClick={riprogramma}
                >
                  {inCorso ? 'Spostamento…' : 'Riprogramma'}
                </button>
                <p className="field-hint">
                  La voce resta da fare e si sposta al nuovo giorno. Non viene chiusa: non è né
                  eseguita né fallita.
                </p>
              </div>
            </>
          ) : gruppo === 'annullata' ? (
            <div className="esito-azioni">
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={inCorso || !puoCancellare}
                title={puoCancellare ? undefined : 'Serve il permesso di cancellare'}
                onClick={rimuovi}
              >
                {inCorso ? 'Rimozione…' : 'Rimuovi'}
              </button>
              <p className="field-hint">
                La riga viene cancellata del tutto. La nota resta nel registro operatori.
              </p>
            </div>
          ) : (
            <>
              {eventi.length > 0 && (
                <div className="esito-eventi">
                  {eventi.map((riga, indice) => (
                    <RigaProgrammazione
                      key={riga.chiaveLocale}
                      riga={riga}
                      indice={indice}
                      operatori={operatori}
                      onCambia={(campi) => aggiorna(riga.chiaveLocale, campi)}
                      onRimuovi={() =>
                        setEventi((e) => e.filter((r) => r.chiaveLocale !== riga.chiaveLocale))
                      }
                    />
                  ))}
                </div>
              )}

              <div className="esito-azioni">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={inCorso}
                  onClick={() => chiudi(false)}
                >
                  {inCorso ? 'Salvataggio…' : `Chiudi ${gruppo}`}
                </button>

                <button type="button" className="btn btn-ghost btn-sm" onClick={aggiungiEvento}>
                  + Programma evento
                </button>

                {eventi.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={inCorso}
                    onClick={() => chiudi(true)}
                  >
                    {inCorso
                      ? 'Salvataggio…'
                      : `Chiudi ${gruppo} e programma ${eventi.length} ${eventi.length === 1 ? 'evento' : 'eventi'}`}
                  </button>
                )}
              </div>
            </>
          )}

          {errore && (
            <p className="field-hint" style={{ color: 'var(--error)' }}>
              {errore}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function RigaProgrammazione({
  riga,
  indice,
  operatori,
  onCambia,
  onRimuovi,
}: {
  riga: RigaEvento
  indice: number
  operatori: string[]
  onCambia: (campi: Partial<RigaEvento>) => void
  onRimuovi: () => void
}) {
  const tipo: TipoVoce = eTipoValido(riga.tipo) ? riga.tipo : 'task'
  // Solo gli appuntamenti hanno un'ora: gli altri tipi sono impegni della
  // giornata, e dargli un'orario occuperebbe una fascia che il sito può
  // ancora offrire a chi prenota.
  const conOrario = eAppuntamentoVero(tipo)

  return (
    <div className="esito-evento">
      <div className="esito-evento-testa">
        <span className="esito-evento-numero">Evento {indice + 1}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRimuovi}>
          Togli
        </button>
      </div>

      <div className="form-row">
        <div className="field" style={{ flexBasis: '100%' }}>
          <label>Titolo</label>
          <input
            type="text"
            value={riga.titolo}
            onChange={(e) => onCambia({ titolo: e.target.value })}
            placeholder="Es. richiamare per confermare l’iscrizione"
          />
        </div>
      </div>

      <div className="form-row">
        <div className="field">
          <label>Tipo</label>
          <select
            value={tipo}
            onChange={(e) =>
              // Cambiando tipo l'ora si azzera: restava quella di un
              // appuntamento anche passando a un'email, che non ne ha una.
              onCambia({ tipo: e.target.value, ora: '', durataMinuti: null })
            }
          >
            {OPZIONI_TIPO.map((o) => (
              <option key={o.valore} value={o.valore}>
                {o.etichetta}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Giorno</label>
          <input
            type="date"
            value={riga.data}
            onChange={(e) => onCambia({ data: e.target.value })}
          />
        </div>

        {conOrario && (
          <>
            <div className="field">
              <label>Ora</label>
              <input
                type="time"
                value={riga.ora ?? ''}
                onChange={(e) => onCambia({ ora: e.target.value })}
              />
              <p className="field-hint">Vuota = entro la giornata.</p>
            </div>
            <div className="field">
              <label>Durata (min)</label>
              <input
                type="number"
                min={5}
                max={480}
                step={5}
                value={riga.durataMinuti ?? DURATA_PREDEFINITA[tipo]}
                onChange={(e) => onCambia({ durataMinuti: Number(e.target.value) })}
              />
            </div>
          </>
        )}

        <div className="field">
          <label>Assegnato a</label>
          <input
            type="text"
            list="elenco-operatori-esito"
            value={riga.assegnatoA ?? ''}
            onChange={(e) => onCambia({ assegnatoA: e.target.value })}
            placeholder="lascia vuoto per te"
          />
          <datalist id="elenco-operatori-esito">
            {operatori.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </div>
      </div>
    </div>
  )
}
