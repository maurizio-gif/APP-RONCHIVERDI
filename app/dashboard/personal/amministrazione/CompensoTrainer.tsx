'use client'

import { useState, useTransition } from 'react'
import { impostaCompenso } from '../actions'

// Il compenso a sessione di un trainer, con la data da cui vale. Di norma il
// primo del mese che si sta guardando: alzare la tariffa da novembre non deve
// cambiare i conti di ottobre.
export function CompensoTrainer({
  trainerEmail,
  validoDalPredefinito,
  attuale,
}: {
  trainerEmail: string
  validoDalPredefinito: string
  attuale: number | null
}) {
  const [aperto, setAperto] = useState(false)
  const [compenso, setCompenso] = useState(attuale != null ? String(attuale).replace('.', ',') : '')
  const [validoDal, setValidoDal] = useState(validoDalPredefinito)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  if (!aperto) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAperto(true)}>
        {attuale == null ? 'Imposta compenso' : 'Cambia'}
      </button>
    )
  }

  return (
    <form
      className="pt-compenso-form"
      onSubmit={(e) => {
        e.preventDefault()
        setErrore(null)
        startTransition(async () => {
          try {
            const esito = await impostaCompenso({ trainerEmail, validoDal, compenso })
            if (esito.ok) setAperto(false)
            else setErrore(esito.errore)
          } catch {
            setErrore('Salvataggio non riuscito: controlla la connessione e riprova.')
          }
        })
      }}
    >
      <div className="field">
        <label htmlFor={`compenso-${trainerEmail}`}>€ a sessione</label>
        <input
          id={`compenso-${trainerEmail}`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="35,00"
          value={compenso}
          onChange={(e) => setCompenso(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`dal-${trainerEmail}`}>Vale dal</label>
        <input
          id={`dal-${trainerEmail}`}
          type="date"
          value={validoDal}
          onChange={(e) => setValidoDal(e.target.value)}
          required
        />
      </div>
      <div className="voce-azioni">
        <button type="submit" className="btn btn-sm" disabled={inCorso}>
          {inCorso ? 'Salvo…' : 'Salva'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={inCorso} onClick={() => setAperto(false)}>
          Annulla
        </button>
      </div>
      {errore && <p className="error-banner">{errore}</p>}
    </form>
  )
}
