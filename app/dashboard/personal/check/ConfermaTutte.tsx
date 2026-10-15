'use client'

import { useState, useTransition } from 'react'
import { confermaSessioni } from '../actions'

// A fine mese le sessioni da confermare sono decine: dopo averle scorse, una
// conferma sola per tutte quelle in attesa che la pagina sta mostrando —
// filtri compresi, così si può confermare un trainer alla volta.
export function ConfermaTutte({ ids }: { ids: string[] }) {
  const [errore, setErrore] = useState<string | null>(null)
  const [fatto, setFatto] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  if (ids.length === 0) return null

  return (
    <div className="pt-conferma-tutte">
      <button
        type="button"
        className="btn btn-sm"
        disabled={inCorso}
        onClick={() => {
          const quante = ids.length === 1 ? 'la sessione in attesa' : `le ${ids.length} sessioni in attesa`
          if (!confirm(`Confermare ${quante} mostrate qui sotto?`)) return
          setErrore(null)
          setFatto(null)
          startTransition(async () => {
            try {
              const esito = await confermaSessioni(ids)
              if (esito.ok) setFatto(esito.messaggio)
              else setErrore(esito.errore)
            } catch {
              setErrore('Conferma non riuscita: controlla la connessione e riprova.')
            }
          })
        }}
      >
        {inCorso ? 'Conferma…' : `Conferma tutte (${ids.length})`}
      </button>
      {errore && <p className="error-banner">{errore}</p>}
      {fatto && <p className="ok-banner">{fatto}</p>}
    </div>
  )
}
