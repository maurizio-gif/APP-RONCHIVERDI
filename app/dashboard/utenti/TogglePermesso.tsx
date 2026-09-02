'use client'

import { useState, useTransition } from 'react'

type Risultato = { ok: true } | { ok: false; errore: string }

// Casella di permesso che si salva da sé al click, con l'errore mostrato
// accanto invece di un alert: un solo componente per tutti i permessi
// booleani, così aggiungerne uno nuovo non vuol dire copiare un file.
export function TogglePermesso({
  email,
  valoreIniziale,
  etichetta,
  azione,
  disabilitato = false,
  motivoDisabilitato,
}: {
  email: string
  valoreIniziale: boolean
  etichetta: string
  azione: (email: string, valore: boolean) => Promise<Risultato>
  disabilitato?: boolean
  motivoDisabilitato?: string
}) {
  const [valore, setValore] = useState(valoreIniziale)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function cambia(nuovo: boolean) {
    // Ottimistico: la casella si muove subito e torna indietro solo se il
    // server rifiuta. Su un permesso il ritardo di rete si nota.
    setValore(nuovo)
    setErrore(null)
    startTransition(async () => {
      const esito = await azione(email, nuovo)
      if (!esito.ok) {
        setValore(!nuovo)
        setErrore(esito.errore)
      }
    })
  }

  return (
    <div>
      <label
        className={`check-riga${disabilitato ? ' is-disabled' : ''}`}
        title={disabilitato ? motivoDisabilitato : undefined}
      >
        <input
          type="checkbox"
          checked={valore}
          disabled={disabilitato || inCorso}
          onChange={(e) => cambia(e.target.checked)}
        />
        <span>{etichetta}</span>
      </label>
      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)' }}>
          {errore}
        </p>
      )}
    </div>
  )
}
