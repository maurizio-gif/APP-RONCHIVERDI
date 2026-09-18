'use client'

import { useState, useTransition } from 'react'
import { salvaObiettivoMensile } from './actions'
import { euro } from '@/lib/pipeline'

export default function ObiettivoMensile({
  mese,
  goalIniziale,
  fatturatoAdOggi,
}: {
  mese: string
  goalIniziale: number | null
  fatturatoAdOggi: number
}) {
  const [valore, setValore] = useState(goalIniziale != null ? String(goalIniziale) : '')
  const [inCorso, startTransition] = useTransition()
  const [errore, setErrore] = useState(false)

  function salva() {
    const testo = valore.trim()
    const numero = testo === '' ? null : Number(testo)
    if (numero !== null && (!Number.isFinite(numero) || numero < 0)) {
      setErrore(true)
      return
    }
    setErrore(false)
    startTransition(async () => {
      const esito = await salvaObiettivoMensile(mese, numero)
      if (!esito.ok) setErrore(true)
    })
  }

  const goalNumero = valore.trim() === '' ? null : Number(valore)
  const percentuale =
    goalNumero && goalNumero > 0 && Number.isFinite(goalNumero) ? Math.round((fatturatoAdOggi / goalNumero) * 100) : null

  return (
    <div className="field">
      <label htmlFor="obiettivo-mensile">Obiettivo del mese (€)</label>
      <input
        id="obiettivo-mensile"
        type="number"
        min={0}
        step={100}
        className={errore ? 'has-errore' : ''}
        value={valore}
        onChange={(e) => setValore(e.target.value)}
        onBlur={salva}
        disabled={inCorso}
        placeholder="Non ancora impostato"
      />
      {percentuale !== null && (
        <p className="muted">
          {euro(fatturatoAdOggi)} raggiunti finora su {euro(goalNumero!)} — {percentuale}% dell&apos;obiettivo
        </p>
      )}
      {errore && <p className="error-banner">Obiettivo non valido o non salvato.</p>}
    </div>
  )
}
