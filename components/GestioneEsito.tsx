'use client'

import { useId, useState, useTransition } from 'react'
import {
  DURATA_PREDEFINITA,
  ETICHETTE_ESITO,
  OPZIONI_TIPO,
  OPZIONI_TIPO_PROGRAMMABILI,
  eAppuntamentoVero,
  eTipoValido,
  oggiRoma,
  type TipoVoce,
} from '@/lib/agenda'
import {
  chiudiConEsito,
  correggiEsito,
  rimuoviVoce,
  riprogrammaVoce,
  type EventoDaProgrammare,
  type OrigineVoce,
} from '@/app/dashboard/agenda/esito-actions'

// La chiusura di una voce, uguale in agenda e nelle richieste dal sito: si
// dice com'è andata e si scrive il perché. Il pannello è uno solo perché il
// gesto è lo stesso — due copie avrebbero preso strade diverse alla prima
// modifica.
//
// Il programmatore di seguiti non è più qui. Chiudere e creare l'evento
// successivo erano due cose nello stesso riquadro, e l'evento si poteva
// creare da due posti — questo e il pannello Eventi della trattativa — che
// facevano esattamente la stessa insert. Adesso gli eventi nascono in un
// posto solo: il pannello Eventi se c'è una trattativa, «Aggiungi in agenda»
// se si è in agenda.

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

/** "3 set 14:20" — quando una nota è stata scritta, accanto a chi l'ha scritta. */
function dataOraBreve(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
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
  chiusa = false,
  esitoCorrente = null,
  notaCorrente = null,
  firma = null,
  firmaIl = null,
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
  /**
   * Se la voce è già stata chiusa. Cambia il verbo del pannello: su una voce
   * aperta si chiude, su una chiusa si **corregge** — e correggere non deve
   * costare una riapertura, che la rimetterebbe fra le cose da fare e negli
   * arretrati mentre qualcuno guarda l'agenda.
   */
  chiusa?: boolean
  /** L'esito già scelto: la correzione parte da lì, non da un pannello vuoto. */
  esitoCorrente?: 'eseguita' | 'fallita' | null
  /** La nota già scritta, da rileggere e correggere invece che riscrivere. */
  notaCorrente?: string | null
  /** Chi ha scritto quella nota, già come nome e cognome, e quando. */
  firma?: string | null
  firmaIl?: string | null
}) {
  const [gruppo, setGruppo] = useState<Gruppo | null>(null)
  // Su una voce chiusa il campo parte da quello che c'è scritto: una
  // correzione è quasi sempre un'aggiunta, e ridigitare la nota da capo per
  // cambiarne una riga la fa riscrivere più corta di com'era.
  const [nota, setNota] = useState(chiusa ? (notaCorrente ?? '') : '')
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  // Salvata la correzione, il server rilegge la riga e rimanda le prop nuove;
  // lo stato locale resterebbe quello di prima e il pannello continuerebbe a
  // mostrare la nota vecchia sopra un dato già cambiato.
  const [ultimaNota, setUltimaNota] = useState(notaCorrente)
  if (ultimaNota !== notaCorrente) {
    setUltimaNota(notaCorrente)
    setNota(chiusa ? (notaCorrente ?? '') : '')
  }

  // Si parte da dov'è adesso: chi rinvia sposta di qualche giorno, e
  // ridigitare la data da zero è lavoro in più per arrivare vicino a quella
  // che c'era già.
  const [nuovaData, setNuovaData] = useState(dataCorrente || oggiRoma())
  const [nuovaOra, setNuovaOra] = useState(oraCorrente ?? '')

  function esegui(azione: () => Promise<{ ok: true } | { ok: false; errore: string }>) {
    setErrore(null)
    startTransition(async () => {
      const esito = await azione()
      if (esito.ok) {
        setGruppo(null)
        // Su una voce chiusa la nota non si svuota: resta quella corretta, che
        // è ciò che si rilegge riaprendo il pannello. Le prop la riallineano
        // al valore appena salvato non appena il server rilegge la riga.
        if (!chiusa) setNota('')
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

  function chiudi() {
    if (!gruppo || gruppo === 'annullata' || gruppo === 'riprogrammata') return
    if (!nota.trim()) return setErrore('La nota è obbligatoria: scrivi com’è andata.')
    esegui(() => chiudiConEsito({ origine, id, esito: gruppo, nota }))
  }

  /** Riscrive esito e nota su una voce già chiusa, senza riaprirla. */
  function correggi() {
    if (!gruppo || gruppo === 'annullata' || gruppo === 'riprogrammata') return
    if (!nota.trim()) return setErrore('La nota è obbligatoria: scrivi com’è andata.')
    esegui(() => correggiEsito({ origine, id, esito: gruppo, nota }))
  }

  function rimuovi() {
    if (!nota.trim()) return setErrore('La nota è obbligatoria: scrivi perché la rimuovi.')
    if (!confirm(`Rimuovere definitivamente «${titolo}»? L’operazione non si annulla.`)) return
    esegui(() => rimuoviVoce({ origine, id, nota }))
  }

  return (
    <div className="esito">
      <div className="esito-titolo">{chiusa ? 'Esito' : 'Chiudi con esito'}</div>

      {/* Su una voce chiusa: com'è andata, chi l'ha scritto e quando — prima
          dei pulsanti, perché è quello che si viene a leggere. Chi vuole
          correggere lo fa dopo aver visto cosa c'era. */}
      {chiusa && (
        <p className="esito-firma">
          {esitoCorrente ? ETICHETTE_ESITO[esitoCorrente] : 'Chiusa senza esito'}
          {firma ? ` da ${firma}` : ''}
          {firmaIl ? ` il ${dataOraBreve(firmaIl)}` : ''}
          {!firma && !firmaIl && ' — firma non registrata'}
        </p>
      )}

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
            {/* Su una voce chiusa la scelta che c'è già si riconosce prima di
                cliccarla: senza la spunta si rischia di «correggere» in
                eseguita qualcosa che era già eseguita, credendo di cambiarla. */}
            {chiusa && esitoCorrente === g.chiave && (
              <span aria-hidden="true" style={{ marginRight: '0.35em' }}>
                ✓
              </span>
            )}
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
              <div className="esito-azioni">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={inCorso}
                  onClick={() => (chiusa ? correggi() : chiudi())}
                >
                  {inCorso
                    ? 'Salvataggio…'
                    : chiusa
                      ? `Salva: ${gruppo}`
                      : `Chiudi ${gruppo}`}
                </button>

                {chiusa && (
                  <p className="field-hint">
                    La voce resta chiusa e non torna fra quelle da fare: cambiano solo l’esito e la
                    nota, con la tua firma.
                  </p>
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

/**
 * I campi di un evento, senza contorno: gli stessi qui, dove si programma un
 * seguito chiudendo una voce, e nel pannello Eventi di una richiesta Club e
 * Family, dove si modifica un evento già fissato. Due copie avrebbero preso
 * strade diverse alla prima aggiunta di un campo.
 */
export function CampiEvento({
  riga,
  operatori,
  onCambia,
  soloProgrammabili = true,
}: {
  riga: EventoDaProgrammare
  operatori: string[]
  onCambia: (campi: Partial<EventoDaProgrammare>) => void
  /**
   * Se la tendina dei tipi deve escludere email e WhatsApp, che non si
   * programmano (vedi TIPI_SOLO_REGISTRATI). Vero per il programmatore dei
   * seguiti, che guarda solo avanti; falso quando si sta registrando qualcosa
   * di già fatto.
   */
  soloProgrammabili?: boolean
}) {
  // Un id per istanza: più datalist con lo stesso id sono documento invalido,
  // e il browser non garantisce a quale si agganci l'input.
  const idOperatori = useId()
  const tipo: TipoVoce = eTipoValido(riga.tipo) ? riga.tipo : 'task'
  // Solo gli appuntamenti hanno un'ora: gli altri tipi sono impegni della
  // giornata, e dargli un'orario occuperebbe una fascia che il sito può
  // ancora offrire a chi prenota.
  const conOrario = eAppuntamentoVero(tipo)

  return (
    <>
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
            {(soloProgrammabili ? OPZIONI_TIPO_PROGRAMMABILI : OPZIONI_TIPO).map((o) => (
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
            list={idOperatori}
            value={riga.assegnatoA ?? ''}
            onChange={(e) => onCambia({ assegnatoA: e.target.value })}
            placeholder="lascia vuoto per te"
          />
          <datalist id={idOperatori}>
            {operatori.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </div>

        <div className="field" style={{ flexBasis: '100%' }}>
          <label>Note</label>
          <input
            type="text"
            value={riga.note ?? ''}
            onChange={(e) => onCambia({ note: e.target.value })}
            placeholder="Facoltative: cosa ricordarsi prima di chiamare"
          />
        </div>
      </div>
    </>
  )
}
