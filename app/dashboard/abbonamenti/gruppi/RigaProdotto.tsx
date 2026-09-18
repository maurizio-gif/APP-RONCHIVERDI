'use client'

import { useState, useTransition } from 'react'
import { assegnaProdotto } from './actions'
import type { Gruppo } from '@/lib/abbonamenti'

export default function RigaProdotto({
  prodotto,
  numeroVendite,
  ultimaVenditaTesto,
  gruppoId,
  gruppi,
}: {
  prodotto: string
  numeroVendite: number
  ultimaVenditaTesto: string
  gruppoId: string | null
  gruppi: Gruppo[]
}) {
  const [valore, setValore] = useState(gruppoId ?? '')
  const [inCorso, startTransition] = useTransition()
  const [errore, setErrore] = useState(false)

  function cambia(nuovoId: string) {
    setValore(nuovoId)
    setErrore(false)
    startTransition(async () => {
      const esito = await assegnaProdotto(prodotto, nuovoId || null)
      if (!esito.ok) setErrore(true)
    })
  }

  return (
    <tr>
      <td>{prodotto}</td>
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
    </tr>
  )
}
