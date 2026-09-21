'use client'

import { useState, useTransition } from 'react'
import { assegnaProdotto, impostaNoAbbonamento } from './actions'
import type { Gruppo } from '@/lib/abbonamenti'

export default function RigaProdotto({
  prodotto,
  numeroVendite,
  ultimaVenditaTesto,
  gruppoId,
  gruppi,
  noAbbonamento,
  varianti,
}: {
  prodotto: string
  numeroVendite: number
  ultimaVenditaTesto: string
  gruppoId: string | null
  gruppi: Gruppo[]
  noAbbonamento: boolean
  varianti: string[]
}) {
  const [valore, setValore] = useState(gruppoId ?? '')
  const [inCorso, startTransition] = useTransition()
  const [errore, setErrore] = useState(false)

  const [valoreNoAbbonamento, setValoreNoAbbonamento] = useState(noAbbonamento)
  const [inCorsoNoAbbonamento, startTransitionNoAbbonamento] = useTransition()
  const [erroreNoAbbonamento, setErroreNoAbbonamento] = useState(false)

  function cambia(nuovoId: string) {
    setValore(nuovoId)
    setErrore(false)
    startTransition(async () => {
      const esito = await assegnaProdotto(prodotto, nuovoId || null)
      if (!esito.ok) setErrore(true)
    })
  }

  function cambiaNoAbbonamento(spuntato: boolean) {
    setValoreNoAbbonamento(spuntato)
    setErroreNoAbbonamento(false)
    startTransitionNoAbbonamento(async () => {
      const esito = await impostaNoAbbonamento(prodotto, spuntato)
      if (!esito.ok) setErroreNoAbbonamento(true)
    })
  }

  return (
    <tr>
      <td>
        {prodotto}
        {varianti.length > 0 && (
          <div className="muted" style={{ fontSize: 'var(--text-2xs)' }}>
            Varianti: {varianti.join(', ')}
          </div>
        )}
      </td>
      <td>{numeroVendite}</td>
      <td>{ultimaVenditaTesto}</td>
      <td>
        <select
          className={`cella-gruppo${errore ? ' has-errore' : ''}`}
          value={valore}
          onChange={(e) => cambia(e.target.value)}
          disabled={inCorso}
        >
          <option value="">— Non categorizzato —</option>
          {gruppi.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nome}
            </option>
          ))}
        </select>
      </td>
      <td className="cella-centrata">
        <input
          type="checkbox"
          className={erroreNoAbbonamento ? 'has-errore' : ''}
          checked={valoreNoAbbonamento}
          onChange={(e) => cambiaNoAbbonamento(e.target.checked)}
          disabled={inCorsoNoAbbonamento}
          aria-label={`${prodotto}: non è un vero abbonamento`}
        />
      </td>
    </tr>
  )
}
