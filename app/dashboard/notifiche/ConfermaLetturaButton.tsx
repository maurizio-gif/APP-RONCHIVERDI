'use client'

import { useState, useTransition } from 'react'
import { confermaLettura } from './actions'

// Riusato sia nell'avviso in evidenza sia nel dettaglio di un messaggio
// nell'elenco: stessa azione e stesso comportamento nei due punti in cui la
// lettura si può confermare.
export function ConfermaLetturaButton({
  id,
  onConfermata,
  className = 'btn btn-sm',
}: {
  id: number
  onConfermata?: () => void
  className?: string
}) {
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  return (
    <div>
      <button
        type="button"
        className={className}
        disabled={inCorso}
        onClick={() => {
          setErrore(null)
          startTransition(async () => {
            const esito = await confermaLettura(id)
            if (esito.ok) onConfermata?.()
            else setErrore(esito.errore)
          })
        }}
      >
        {inCorso ? 'Confermo…' : 'Confermo di aver letto'}
      </button>
      {errore && <p className="error-banner">{errore}</p>}
    </div>
  )
}
