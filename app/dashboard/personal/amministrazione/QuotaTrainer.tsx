'use client'

import { useState, useTransition } from 'react'
import { ETICHETTE_TIPO_QUOTA, TIPI_QUOTA, type QuotaTrainer as Quota, type TipoQuota } from '@/lib/personal'
import { impostaQuota } from '../actions'

// La quota che un trainer versa a Ronchiverdi: oraria (un importo per ogni
// sessione confermata) o flat (un canone fisso al mese), con il mese da cui
// vale. Di norma il mese che si sta guardando: cambiare formula da novembre
// non deve riscrivere ottobre.
export function QuotaTrainer({
  trainerEmail,
  mesePredefinito,
  attuale,
}: {
  trainerEmail: string
  mesePredefinito: string
  attuale: Quota | null
}) {
  const [aperto, setAperto] = useState(false)
  const [tipo, setTipo] = useState<TipoQuota>(attuale?.tipo ?? 'oraria')
  const [importo, setImporto] = useState(attuale != null ? String(attuale.importo).replace('.', ',') : '')
  const [mese, setMese] = useState(mesePredefinito.slice(0, 7))
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  if (!aperto) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAperto(true)}>
        {attuale == null ? 'Imposta quota' : 'Cambia'}
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
            const esito = await impostaQuota({ trainerEmail, validoDal: mese, tipo, importo })
            if (esito.ok) setAperto(false)
            else setErrore(esito.errore)
          } catch {
            setErrore('Salvataggio non riuscito: controlla la connessione e riprova.')
          }
        })
      }}
    >
      <fieldset className="pt-fieldset pt-quota-tipo">
        <legend>Formula</legend>
        {TIPI_QUOTA.map((t) => (
          <label key={t} className="check-riga">
            <input type="radio" name={`tipo-${trainerEmail}`} checked={tipo === t} onChange={() => setTipo(t)} />
            <span>{ETICHETTE_TIPO_QUOTA[t]}</span>
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor={`importo-${trainerEmail}`}>{tipo === 'flat' ? '€ al mese' : '€ a sessione'}</label>
        <input
          id={`importo-${trainerEmail}`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder={tipo === 'flat' ? '400,00' : '15,00'}
          value={importo}
          onChange={(e) => setImporto(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`mese-${trainerEmail}`}>Vale dal mese</label>
        <input id={`mese-${trainerEmail}`} type="month" value={mese} onChange={(e) => setMese(e.target.value)} required />
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
