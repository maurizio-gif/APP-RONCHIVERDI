'use client'

import { useState, useTransition } from 'react'
import type { VoceAgenda } from '@/lib/agenda'
import { annullaVoce, completaVoce, riapriVoce, segnaContattoGestito } from './actions'

// I comandi su una singola voce. Le richieste arrivate dal sito non si
// annullano né si cancellano da qui: non sono impegni nostri, sono richieste
// di una persona — si segnano lavorate, e basta.
export function AzioniVoce({ voce }: { voce: VoceAgenda }) {
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function esegui(azione: () => Promise<{ ok: true } | { ok: false; errore: string }>) {
    setErrore(null)
    startTransition(async () => {
      const esito = await azione()
      if (!esito.ok) setErrore(esito.errore)
    })
  }

  const daSito = voce.origine === 'form_contatti'

  return (
    <div className="voce-azioni">
      {voce.daFare ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={inCorso}
          onClick={() =>
            esegui(() => (daSito ? segnaContattoGestito(voce.id, true) : completaVoce(voce.id, null)))
          }
        >
          Segna fatto
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={inCorso}
          onClick={() =>
            esegui(() => (daSito ? segnaContattoGestito(voce.id, false) : riapriVoce(voce.id)))
          }
        >
          Riapri
        </button>
      )}

      {!daSito && voce.stato !== 'annullato' && (
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={inCorso}
          onClick={() => {
            if (!confirm(`Annullare «${voce.titolo}»? Lo slot torna prenotabile dal sito.`)) return
            esegui(() => annullaVoce(voce.id))
          }}
        >
          Annulla
        </button>
      )}

      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)', flexBasis: '100%' }}>
          {errore}
        </p>
      )}
    </div>
  )
}
