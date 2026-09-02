'use client'

import { useState, useTransition } from 'react'
import { correggiTimbratura, eliminaTimbratura } from './actions'

/**
 * Correzione di un singolo timbro. Il campo è un datetime-local
 * precompilato con l'orario attuale: correggere un'uscita sbagliata è
 * spostarla di qualche ora, non riscriverla da zero.
 */
export function CorreggiTimbratura({
  id,
  valoreLocale,
  puoEliminare,
}: {
  id: number
  valoreLocale: string
  puoEliminare: boolean
}) {
  const [aperto, setAperto] = useState(false)
  const [quando, setQuando] = useState(valoreLocale)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function esegui(azione: () => Promise<{ ok: true } | { ok: false; errore: string }>) {
    setErrore(null)
    startTransition(async () => {
      const esito = await azione()
      if (esito.ok) setAperto(false)
      else setErrore(esito.errore)
    })
  }

  if (!aperto) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAperto(true)}>
        Correggi
      </button>
    )
  }

  return (
    <span className="correggi">
      <input
        type="datetime-local"
        value={quando}
        onChange={(e) => setQuando(e.target.value)}
        aria-label="Nuova data e ora"
      />
      <button
        type="button"
        className="btn btn-sm"
        disabled={inCorso || !quando}
        onClick={() =>
          // L'input dà un orario locale senza fuso: lo si interpreta con il
          // fuso del browser, che è quello di chi sta correggendo.
          esegui(() => correggiTimbratura(id, new Date(quando).toISOString()))
        }
      >
        {inCorso ? 'Salvo…' : 'Salva'}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAperto(false)}>
        Annulla
      </button>
      {puoEliminare && (
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={inCorso}
          onClick={() => {
            if (!confirm('Eliminare questa timbratura? Il contenuto resta nel log.')) return
            esegui(() => eliminaTimbratura(id))
          }}
        >
          Elimina
        </button>
      )}
      {errore && (
        <span className="field-hint" style={{ color: 'var(--error)', flexBasis: '100%' }}>
          {errore}
        </span>
      )}
    </span>
  )
}
