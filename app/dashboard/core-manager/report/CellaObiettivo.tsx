'use client'

import { useState, useTransition } from 'react'
import { salvaObiettivoGiornaliero } from './actions'

// Il GOAL GIORNALIERO del vecchio foglio: una cella che si clicca e si
// scrive, non un dato calcolato. Salva sul blur — non a ogni tasto, che
// scriverebbe una riga per cifra — e vuota la cella con lei: un giorno senza
// obiettivo deciso deve tornare vuoto, non restare a zero.
export function CellaObiettivo({
  commerciale,
  giorno,
  valoreIniziale,
}: {
  commerciale: string
  giorno: string
  valoreIniziale: number | null
}) {
  const [valore, setValore] = useState(valoreIniziale != null ? String(valoreIniziale) : '')
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
      const esito = await salvaObiettivoGiornaliero(commerciale, giorno, numero)
      if (!esito.ok) setErrore(true)
    })
  }

  return (
    <input
      type="number"
      min={0}
      step={1}
      className={`cella-obiettivo${errore ? ' has-errore' : ''}`}
      value={valore}
      disabled={inCorso}
      onChange={(e) => setValore(e.target.value)}
      onBlur={salva}
      aria-label={`Obiettivo del ${giorno}`}
      title={errore ? 'Non salvato: riprova' : undefined}
    />
  )
}
