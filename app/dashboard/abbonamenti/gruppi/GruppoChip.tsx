'use client'

import { useState, useTransition } from 'react'
import { eliminaGruppo } from './actions'

/**
 * Il chip di un gruppo esistente, con la sua "×" per cancellarlo — solo se
 * non ha più prodotti assegnati (vedi eliminaGruppo in actions.ts, che fa il
 * controllo vero). Qui si mostra solo l'errore che torna, non si ricalcola
 * da soli il conteggio dei prodotti: l'unica fonte di verità è il database
 * al momento del click, non una lettura fatta prima e magari non più valida.
 */
export default function GruppoChip({ id, nome }: { id: string; nome: string }) {
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function elimina() {
    if (!confirm(`Eliminare il gruppo "${nome}"?`)) return
    setErrore(null)
    startTransition(async () => {
      const esito = await eliminaGruppo(id)
      if (!esito.ok) setErrore(esito.errore)
    })
  }

  return (
    // Contenitore a colonna e non il chip stesso: il chip resta "nowrap"
    // (è lo stile condiviso da tutti i filtri della pagina), l'eventuale
    // errore sotto deve invece poter andare a capo, altrimenti un messaggio
    // lungo si allargherebbe fuori schermo invece di restare sotto il chip.
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.3rem' }}>
      <span className="chip" style={{ cursor: 'default' }}>
        {nome}
        <button
          type="button"
          className="chip-elimina"
          onClick={elimina}
          disabled={inCorso}
          aria-label={`Elimina gruppo ${nome}`}
          title="Elimina gruppo"
        >
          ×
        </button>
      </span>
      {errore && (
        <span className="field-hint" style={{ color: 'var(--error)', whiteSpace: 'normal', maxWidth: '220px' }}>
          {errore}
        </span>
      )}
    </span>
  )
}
