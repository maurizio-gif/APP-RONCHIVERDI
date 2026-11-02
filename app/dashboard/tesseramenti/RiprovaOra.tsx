'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { riprovaTesseramento, type EsitoRiprova } from './actions'

// «Riprova ora»: il clic aspetta la risposta di CSI (qualche secondo) e mostra
// subito l'esito sulla riga: la tessera emessa, oppure l'errore con cosa fare.
// Dopo un tesseramento riuscito la riga esce dall'elenco, quindi il messaggio
// resta visibile un attimo prima di aggiornare la pagina.
const PAUSA_DOPO_SUCCESSO_MS = 3000

export function RiprovaOra({ id }: { id: string; tentativi?: number }) {
  const router = useRouter()
  const [inCorso, startTransition] = useTransition()
  const [esito, setEsito] = useState<EsitoRiprova | null>(null)

  useEffect(() => {
    if (!esito || !esito.ok) return
    const t = setTimeout(() => router.refresh(), esito.esito === 'tesserato' ? PAUSA_DOPO_SUCCESSO_MS : 0)
    return () => clearTimeout(t)
  }, [esito, router])

  function riprova() {
    if (inCorso) return
    setEsito(null)
    startTransition(async () => {
      setEsito(await riprovaTesseramento(id))
    })
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={riprova} disabled={inCorso}>
        {inCorso ? 'Invio a CSI…' : 'Riprova ora'}
      </button>
      {esito && !esito.ok && (
        <span className="nota-in-riga" role="alert">
          {esito.errore}
        </span>
      )}
      {esito?.ok && esito.esito === 'tesserato' && (
        <span className="nota-in-riga" role="status">
          <span className="badge badge-ok">Tesserato</span>
          {esito.tessera ? ` tessera n. ${esito.tessera}` : ''}
        </span>
      )}
      {esito?.ok && esito.esito === 'errore' && (
        <span className="nota-in-riga" role="alert">
          <span className="badge badge-ko">Non tesserato</span> {esito.errore}
          {esito.azione && (
            <>
              {' '}
              <strong>Cosa fare:</strong> {esito.azione}
            </>
          )}
        </span>
      )}
      {esito?.ok && esito.esito === 'in_corso' && (
        <span className="nota-in-riga" role="status">
          CSI sta ancora rispondendo: l&apos;esito comparirà qui a breve.
        </span>
      )}
    </>
  )
}
