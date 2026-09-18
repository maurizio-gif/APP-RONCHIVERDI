'use client'

import { useState, useTransition } from 'react'
import { creaGruppo } from './actions'

export default function NuovoGruppoForm() {
  const [nome, setNome] = useState('')
  const [inCorso, startTransition] = useTransition()
  const [errore, setErrore] = useState<string | null>(null)

  function crea() {
    const nomePulito = nome.trim()
    if (!nomePulito) return
    setErrore(null)
    startTransition(async () => {
      const esito = await creaGruppo(nomePulito)
      if (esito.ok) {
        setNome('')
      } else {
        setErrore(esito.errore)
      }
    })
  }

  return (
    <div className="form-row">
      <div className="field">
        <input
          type="text"
          placeholder="Nome nuovo gruppo (es. Soci Gold)"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') crea()
          }}
          disabled={inCorso}
        />
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={crea} disabled={inCorso || !nome.trim()}>
        Aggiungi gruppo
      </button>
      {errore && <p className="error-banner">{errore}</p>}
    </div>
  )
}
