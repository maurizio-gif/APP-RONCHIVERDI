'use client'

import { useState, useTransition } from 'react'
import { SEZIONI } from '@/lib/auth/sezioni'
import { impostaSezioni } from './actions'

// Le sezioni visibili a un utente: ogni casella salva subito, senza un
// pulsante "Salva" che si può dimenticare di premere.
export function SezioniToggle({
  email,
  sezioniIniziali,
  disabilitato = false,
}: {
  email: string
  sezioniIniziali: string[]
  disabilitato?: boolean
}) {
  const [sezioni, setSezioni] = useState<string[]>(sezioniIniziali)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function cambia(chiave: string, attiva: boolean) {
    const precedenti = sezioni
    const nuove = attiva ? [...sezioni, chiave] : sezioni.filter((s) => s !== chiave)
    setSezioni(nuove)
    setErrore(null)
    startTransition(async () => {
      const esito = await impostaSezioni(email, nuove)
      if (!esito.ok) {
        setSezioni(precedenti)
        setErrore(esito.errore)
      }
    })
  }

  return (
    <div>
      <div className="permessi-griglia">
        {SEZIONI.map((s) => (
          <label
            key={s.chiave}
            className={`check-riga${disabilitato ? ' is-disabled' : ''}`}
          >
            <input
              type="checkbox"
              checked={sezioni.includes(s.chiave)}
              disabled={disabilitato || inCorso}
              onChange={(e) => cambia(s.chiave, e.target.checked)}
            />
            <span>
              {s.label}
              {s.inArrivo && <span className="badge badge-off" style={{ marginLeft: '0.4rem' }}>in arrivo</span>}
            </span>
          </label>
        ))}
      </div>
      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)' }}>
          {errore}
        </p>
      )}
    </div>
  )
}
