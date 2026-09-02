'use client'

import { useState, useTransition } from 'react'
import { DURATA_PREDEFINITA, OPZIONI_TIPO, eTipoValido } from '@/lib/agenda'
import { creaVoce } from './actions'

// Il form si apre solo su richiesta: l'agenda si guarda molto più spesso di
// quanto ci si aggiunga qualcosa, e un form sempre aperto in cima ruberebbe
// lo spazio alla giornata.
export function NuovaVoce({ giornoPredefinito, operatori }: { giornoPredefinito: string; operatori: string[] }) {
  const [aperto, setAperto] = useState(false)
  const [tipo, setTipo] = useState('appuntamento_in_sede')
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  const durataSuggerita = eTipoValido(tipo) ? DURATA_PREDEFINITA[tipo] : 10

  function invia(formData: FormData) {
    setErrore(null)
    startTransition(async () => {
      const esito = await creaVoce(formData)
      if (esito.ok) setAperto(false)
      else setErrore(esito.errore)
    })
  }

  if (!aperto) {
    return (
      <button type="button" className="btn" onClick={() => setAperto(true)}>
        Aggiungi in agenda
      </button>
    )
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Nuova voce</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAperto(false)}>
          Chiudi
        </button>
      </div>

      {errore && <p className="error-banner">{errore}</p>}

      <form action={invia}>
        <div className="form-row">
          <div className="field" style={{ flexBasis: '100%' }}>
            <label htmlFor="titolo">Titolo</label>
            <input id="titolo" name="titolo" type="text" required autoComplete="off" />
          </div>
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="tipo">Tipo</label>
            <select id="tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {OPZIONI_TIPO.map((o) => (
                <option key={o.valore} value={o.valore}>
                  {o.etichetta}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="data">Giorno</label>
            <input id="data" name="data" type="date" required defaultValue={giornoPredefinito} />
          </div>
          <div className="field">
            <label htmlFor="ora">Ora</label>
            <input id="ora" name="ora" type="time" />
            <p className="field-hint">Vuota = entro la giornata, senza occupare uno slot.</p>
          </div>
          <div className="field">
            <label htmlFor="durata_minuti">Durata (min)</label>
            <input
              id="durata_minuti"
              name="durata_minuti"
              type="number"
              min={5}
              max={480}
              step={5}
              key={tipo}
              defaultValue={durataSuggerita}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="assegnato_a">Assegnata a</label>
            <input
              id="assegnato_a"
              name="assegnato_a"
              type="text"
              list="elenco-operatori"
              placeholder="lascia vuoto per te"
              autoComplete="off"
            />
            <datalist id="elenco-operatori">
              {operatori.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </div>
          <div className="field" style={{ flexBasis: '100%' }}>
            <label htmlFor="note">Note</label>
            <input id="note" name="note" type="text" autoComplete="off" />
          </div>
        </div>

        <button type="submit" className="btn" disabled={inCorso}>
          {inCorso ? 'Salvataggio…' : 'Salva in agenda'}
        </button>
      </form>
    </div>
  )
}
