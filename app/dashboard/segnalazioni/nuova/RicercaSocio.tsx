'use client'

import { useState, useTransition } from 'react'
import { nomePersona } from '@/lib/persone'
import { cercaSocio, type SocioTrovato } from '../actions'

// Il socio che segnala, cercato nell'anagrafica (soci Info4U compresi) per
// nome e cognome, email o cellulare. Si sceglie dai risultati: così le
// segnalazioni di una stessa persona stanno sotto un solo nome. Per chi non è
// in anagrafica (un ospite, «le socie della lezione») si può scrivere il nome
// a mano: è facoltativo, il socio non sempre si presenta.

export type SocioScelto = { personaId: string | null; nome: string }

export function RicercaSocio({
  valore,
  onChange,
}: {
  valore: SocioScelto | null
  onChange: (socio: SocioScelto | null) => void
}) {
  const [testo, setTesto] = useState('')
  // Il testo per cui valgono i risultati mostrati: null finché non si cerca,
  // e di nuovo null appena il testo cambia.
  const [cercatoPer, setCercatoPer] = useState<string | null>(null)
  const [risultati, setRisultati] = useState<SocioTrovato[]>([])
  const [altri, setAltri] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [aMano, setAMano] = useState(false)
  const [inCorso, startTransition] = useTransition()

  function cerca() {
    const termine = testo.trim()
    setErrore(null)
    startTransition(async () => {
      const esito = await cercaSocio(termine)
      if (esito.ok) {
        setRisultati(esito.soci)
        setAltri(esito.altri)
        setCercatoPer(termine)
      } else {
        setErrore(esito.errore)
      }
    })
  }

  function ricomincia() {
    onChange(null)
    setTesto('')
    setCercatoPer(null)
    setRisultati([])
    setAMano(false)
    setErrore(null)
  }

  if (valore) {
    return (
      <div className="field">
        <span className="campo-etichetta">Socio</span>
        <p className="campo-fisso">
          {valore.nome}
          {valore.personaId ? '' : ' (scritto a mano, non in anagrafica)'}{' '}
          <button type="button" className="link-testo" onClick={ricomincia}>
            Cambia
          </button>
        </p>
      </div>
    )
  }

  if (aMano) {
    return (
      <div className="field">
        <label htmlFor="sg-socio-mano">Socio (nome scritto a mano)</label>
        <input
          id="sg-socio-mano"
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
          onBlur={() => testo.trim() && onChange({ personaId: null, nome: testo.trim().slice(0, 160) })}
          maxLength={160}
          placeholder="Nome e cognome, o «le socie della lezione»"
          autoFocus
        />
        <p className="field-hint">
          <button
            type="button"
            className="link-testo"
            onClick={() => {
              if (testo.trim()) onChange({ personaId: null, nome: testo.trim().slice(0, 160) })
            }}
          >
            Conferma il nome
          </button>
          {' · '}
          <button type="button" className="link-testo" onClick={ricomincia}>
            Torna alla ricerca
          </button>
        </p>
      </div>
    )
  }

  const verificato = cercatoPer !== null && cercatoPer === testo.trim()

  return (
    <div className="field">
      <label htmlFor="sg-cerca-socio">Socio (se si è presentato)</label>
      <div className="verifica-contatto">
        <input
          id="sg-cerca-socio"
          type="search"
          value={testo}
          onChange={(e) => {
            setTesto(e.target.value)
            setErrore(null)
          }}
          // Invio cerca, non registra: dentro il form un Invio nel campo di
          // ricerca altrimenti proverebbe a salvare la segnalazione.
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (testo.trim().length >= 3) cerca()
            }
          }}
          placeholder="Nome e cognome, email o cellulare"
          autoComplete="off"
        />
        <button type="button" className="btn btn-sm" onClick={cerca} disabled={inCorso || testo.trim().length < 3}>
          {inCorso ? 'Cerco…' : 'Cerca'}
        </button>
      </div>
      {errore && <p className="field-hint errore-campo">{errore}</p>}
      {!verificato && !errore && (
        <p className="field-hint">
          La ricerca è su tutta l’anagrafica, soci Info4U compresi.{' '}
          <button
            type="button"
            className="link-testo"
            onClick={() => {
              setTesto('')
              setAMano(true)
            }}
          >
            Il socio non c’è o non è un socio: scrivo il nome
          </button>
        </p>
      )}

      {verificato && (
        <>
          {risultati.length > 0 ? (
            <ul className="verifica-risultati">
              {risultati.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="verifica-riga"
                    onClick={() => onChange({ personaId: s.id, nome: nomePersona(s) })}
                  >
                    <strong>{nomePersona(s)}</strong>
                    {s.email && <span className="muted"> · {s.email}</span>}
                    {s.cellulare && <span className="muted"> · {s.cellulare}</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="field-hint">Nessuno trovato per «{cercatoPer}».</p>
          )}
          {altri && (
            <p className="field-hint">Ci sono altri risultati: aggiungi il cognome o cerca per cellulare per restringere.</p>
          )}
          <p className="field-hint">
            {risultati.length > 0 ? 'Non è nessuno di questi? ' : ''}
            <button
              type="button"
              className="link-testo"
              onClick={() => {
                setTesto(cercatoPer ?? '')
                setAMano(true)
              }}
            >
              Scrivo il nome a mano
            </button>
            .
          </p>
        </>
      )}
    </div>
  )
}
