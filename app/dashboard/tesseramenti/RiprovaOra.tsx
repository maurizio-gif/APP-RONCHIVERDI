'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { riprovaTesseramento } from './actions'

// Il tentativo parte dal database e finisce dopo qualche secondo: dopo il
// clic la pagina si riaggiorna da sola finché la riga non cambia (o per al
// massimo ~20 secondi), così l'esito compare senza ricaricare a mano.
const PAUSA_MS = 3000
const GIRI_MASSIMI = 7

export function RiprovaOra({ id, tentativi }: { id: string; tentativi: number }) {
  const router = useRouter()
  const [inCorso, startTransition] = useTransition()
  const [attesa, setAttesa] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const tentativiAlClic = useRef(tentativi)
  const giri = useRef(0)

  // La riga è cambiata (un nuovo tentativo registrato, o è uscita
  // dall'elenco): non c'è più niente da aspettare.
  useEffect(() => {
    if (attesa && tentativi !== tentativiAlClic.current) setAttesa(false)
  }, [tentativi, attesa])

  useEffect(() => {
    if (!attesa) return
    const t = setTimeout(() => {
      giri.current += 1
      if (giri.current >= GIRI_MASSIMI) setAttesa(false)
      else router.refresh()
    }, PAUSA_MS)
    return () => clearTimeout(t)
  }, [attesa, router, tentativi])

  function riprova() {
    if (inCorso || attesa) return
    setErrore(null)
    tentativiAlClic.current = tentativi
    giri.current = 0
    startTransition(async () => {
      const esito = await riprovaTesseramento(id)
      if (esito.ok) setAttesa(true)
      else setErrore(esito.errore)
    })
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={riprova} disabled={inCorso || attesa}>
        {inCorso || attesa ? 'Invio in corso…' : 'Riprova ora'}
      </button>
      {errore && (
        <span className="nota-in-riga" role="alert">
          {errore}
        </span>
      )}
    </>
  )
}
