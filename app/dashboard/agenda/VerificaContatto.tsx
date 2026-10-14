'use client'

import { useState, useTransition } from 'react'
import { nomePersona } from '@/lib/persone'
import { dividiTestoContatto, type CampiIndovinati } from './nuovo-contatto'
import { cercaContattiPerVerifica } from './actions'
import type { ContattoScegliibile } from './NuovaVoce'

// Phone In / Email In: prima di tutto si verifica se la persona c'è già.
//
// Nel form dell'agenda «Dall'elenco» e «Nuovo contatto» sono due pulsanti
// affiancati, e il secondo si preme anche senza aver cercato: al telefono,
// con la persona in linea, è la strada più corta. Il risultato erano doppioni
// — soprattutto di soci Info4U, che nell'elenco parziale del form non ci sono.
// Qui il contatto nuovo si può creare solo dopo una ricerca su tutta
// l'anagrafica (cercaContattiPerVerifica), e solo per il testo cercato: se lo
// si cambia, si ricerca.

export function VerificaContatto({
  scelto,
  onScegli,
  onCreaNuovo,
}: {
  scelto: ContattoScegliibile | null
  onScegli: (contatto: ContattoScegliibile | null) => void
  /** Passa al contatto nuovo, con i campi indovinati dal testo cercato. */
  onCreaNuovo: (campi: CampiIndovinati) => void
}) {
  const [testo, setTesto] = useState('')
  // Il testo per cui valgono i risultati mostrati: null finché non si cerca,
  // e di nuovo null appena il testo cambia.
  const [cercatoPer, setCercatoPer] = useState<string | null>(null)
  const [risultati, setRisultati] = useState<ContattoScegliibile[]>([])
  const [altri, setAltri] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function verifica() {
    const termine = testo.trim()
    setErrore(null)
    startTransition(async () => {
      const esito = await cercaContattiPerVerifica(termine)
      if (esito.ok) {
        setRisultati(esito.contatti)
        setAltri(esito.altri)
        setCercatoPer(termine)
      } else {
        setErrore(esito.errore)
      }
    })
  }

  if (scelto) {
    return (
      <div className="form-row">
        <div className="field" style={{ flexBasis: '100%' }}>
          <span className="campo-etichetta">
            Contatto <span aria-hidden="true">*</span>
          </span>
          <p className="campo-fisso">
            {nomePersona(scelto)}
            {scelto.email ? ` · ${scelto.email}` : ''}
            {scelto.cellulare ? ` · ${scelto.cellulare}` : ''}{' '}
            <button type="button" className="link-testo" onClick={() => onScegli(null)}>
              Cambia
            </button>
          </p>
          <input type="hidden" name="persona_id" value={scelto.id} />
        </div>
      </div>
    )
  }

  const verificato = cercatoPer !== null && cercatoPer === testo.trim()

  return (
    <div className="form-row">
      <div className="field" style={{ flexBasis: '100%' }}>
        <label htmlFor="cerca-contatto">
          Cerca contatto <span aria-hidden="true">*</span>
        </label>
        <div className="verifica-contatto">
          <input
            id="cerca-contatto"
            type="search"
            value={testo}
            onChange={(e) => {
              setTesto(e.target.value)
              setErrore(null)
            }}
            // Invio cerca, non salva: dentro il form, un Invio nel campo di
            // ricerca altrimenti proverebbe a registrare la voce.
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                verifica()
              }
            }}
            placeholder="Nome e cognome, email o cellulare"
            autoComplete="off"
          />
          <button
            type="button"
            className="btn btn-sm"
            onClick={verifica}
            disabled={inCorso || testo.trim().length < 3}
          >
            {inCorso ? 'Verifico…' : 'Verifica'}
          </button>
        </div>
        {errore && <p className="field-hint errore-campo">{errore}</p>}
        {!verificato && !errore && (
          <p className="field-hint">
            Obbligatorio: prima di creare un contatto si verifica che non ci sia già. La ricerca è
            su tutta l&apos;anagrafica, soci Info4U compresi.
          </p>
        )}

        {verificato && (
          <>
            {risultati.length > 0 ? (
              <ul className="verifica-risultati">
                {risultati.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="verifica-riga" onClick={() => onScegli(c)}>
                      <strong>{nomePersona(c)}</strong>
                      {c.email && <span className="muted"> · {c.email}</span>}
                      {c.cellulare && <span className="muted"> · {c.cellulare}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="field-hint">Nessun contatto trovato per «{cercatoPer}».</p>
            )}
            {altri && (
              <p className="field-hint">
                Ci sono altri risultati: aggiungi il cognome o cerca per cellulare per restringere.
              </p>
            )}
            <p className="field-hint">
              {risultati.length > 0 ? 'Non è nessuno di questi? ' : ''}
              <button
                type="button"
                className="link-testo"
                onClick={() => onCreaNuovo(dividiTestoContatto(cercatoPer ?? ''))}
              >
                Crea un contatto nuovo
              </button>
              .
            </p>
          </>
        )}
      </div>
    </div>
  )
}
