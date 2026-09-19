'use client'

import { useState, useTransition } from 'react'
import { salvaObiettivoMensile } from './actions'
import { euro } from '@/lib/pipeline'

export default function ObiettivoMensile({
  mese,
  gruppoId,
  etichettaContesto,
  goalIniziale,
  fatturatoAdOggi,
}: {
  mese: string
  /** Null sul generale (il totale): la stessa data ha una riga per il generale e una per ogni gruppo. */
  gruppoId: string | null
  /** Il nome del gruppo per cui si sta impostando l'obiettivo, es. "CORE". Null sul generale. */
  etichettaContesto: string | null
  goalIniziale: number | null
  fatturatoAdOggi: number
}) {
  const [valore, setValore] = useState(goalIniziale != null ? String(goalIniziale) : '')
  const [inCorso, startTransition] = useTransition()
  const [errore, setErrore] = useState(false)
  const idCampo = `obiettivo-mensile-${gruppoId ?? 'generale'}`

  function salva() {
    const testo = valore.trim()
    const numero = testo === '' ? null : Number(testo)
    if (numero !== null && (!Number.isFinite(numero) || numero < 0)) {
      setErrore(true)
      return
    }
    setErrore(false)
    startTransition(async () => {
      const esito = await salvaObiettivoMensile(mese, gruppoId, numero)
      if (!esito.ok) setErrore(true)
    })
  }

  const goalNumero = valore.trim() === '' ? null : Number(valore)
  const percentuale =
    goalNumero && goalNumero > 0 && Number.isFinite(goalNumero) ? Math.round((fatturatoAdOggi / goalNumero) * 100) : null

  return (
    <div className="field">
      <label htmlFor={idCampo}>Obiettivo del mese (€){etichettaContesto ? ` — ${etichettaContesto}` : ''}</label>
      <input
        id={idCampo}
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
