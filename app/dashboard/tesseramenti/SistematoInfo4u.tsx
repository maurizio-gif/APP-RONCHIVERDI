'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { segnaSistemato } from './actions'

// Il flag «Sistemato su Info4U»: lo mette la segreteria dopo aver corretto il
// dato in Info4U. Si vede chi sta solo aspettando il sync.
export function SistematoInfo4u({
  personaId,
  sistematoIl,
  sistematoDa,
}: {
  personaId: string
  sistematoIl: string | null
  sistematoDa: string | null
}) {
  const router = useRouter()
  const [inCorso, startTransition] = useTransition()
  const [errore, setErrore] = useState<string | null>(null)
  const sistemato = !!sistematoIl

  function cambia() {
    if (inCorso) return
    setErrore(null)
    startTransition(async () => {
      const esito = await segnaSistemato(personaId, !sistemato)
      if (esito.ok) router.refresh()
      else setErrore(esito.errore)
    })
  }

  const quando = sistematoIl
    ? new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(sistematoIl))
    : null

  return (
    <>
      <label className="cella-nowrap" style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', cursor: 'pointer' }}>
        <input type="checkbox" checked={sistemato} onChange={cambia} disabled={inCorso} />
        Sistemato su Info4U
      </label>
      {sistemato && (
        <span className="nota-in-riga">
          segnato il {quando}
          {sistematoDa ? ` da ${sistematoDa}` : ''}: in attesa che i dati arrivino dal sync
        </span>
      )}
      {errore && (
        <span className="nota-in-riga" role="alert">
          {errore}
        </span>
      )}
    </>
  )
}
