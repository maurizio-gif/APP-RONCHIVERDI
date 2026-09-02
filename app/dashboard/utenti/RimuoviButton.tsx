'use client'

import { useState, useTransition } from 'react'
import { rimuoviStaff } from './actions'

export function RimuoviButton({
  email,
  disabilitato = false,
}: {
  email: string
  disabilitato?: boolean
}) {
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function rimuovi() {
    // Conferma esplicita: la riga sparisce dalla tabella e la persona perde
    // l'accesso al pannello al primo caricamento successivo.
    if (!confirm(`Togliere l'accesso al pannello a ${email}?`)) return
    setErrore(null)
    startTransition(async () => {
      const esito = await rimuoviStaff(email)
      if (!esito.ok) setErrore(esito.errore)
    })
  }

  return (
    <div>
      <button
        type="button"
        className="btn btn-danger btn-sm"
        onClick={rimuovi}
        disabled={disabilitato || inCorso}
      >
        {inCorso ? 'Rimozione…' : 'Rimuovi'}
      </button>
      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)' }}>
          {errore}
        </p>
      )}
    </div>
  )
}
