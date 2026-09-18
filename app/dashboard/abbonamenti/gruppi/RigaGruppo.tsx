'use client'

import { useState, useTransition } from 'react'
import { assegnaMacroSettore } from './actions'
import type { MacroSettore } from '@/lib/abbonamenti'

export default function RigaGruppo({
  gruppoId,
  nome,
  macroSettoreId,
  macroSettori,
}: {
  gruppoId: string
  nome: string
  macroSettoreId: string | null
  macroSettori: MacroSettore[]
}) {
  const [valore, setValore] = useState(macroSettoreId ?? '')
  const [inCorso, startTransition] = useTransition()
  const [errore, setErrore] = useState(false)

  function cambia(nuovoId: string) {
    setValore(nuovoId)
    setErrore(false)
    startTransition(async () => {
      const esito = await assegnaMacroSettore(gruppoId, nuovoId || null)
      if (!esito.ok) setErrore(true)
    })
  }

  return (
    <tr>
      <td>{nome}</td>
      <td>
        <select
          className={`cella-gruppo${errore ? ' has-errore' : ''}`}
          value={valore}
          onChange={(e) => cambia(e.target.value)}
          disabled={inCorso}
        >
          <option value="">— Nessun macro settore —</option>
          {macroSettori.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </select>
      </td>
    </tr>
  )
}
