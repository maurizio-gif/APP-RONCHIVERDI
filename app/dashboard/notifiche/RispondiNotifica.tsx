'use client'

import { useState, useTransition } from 'react'
import { LUNGHEZZA_MASSIMA_MESSAGGIO } from '@/lib/notifiche'
import { inviaNotifica } from './actions'

// Risposta rapida a un messaggio: riusa la stessa Server Action dell'invio
// normale — stessi controlli su permessi e destinatario — solo col
// destinatario già fissato invece di ripescarlo dalla tendina.
export function RispondiNotifica({
  aEmail,
  nomeDestinatario,
  onInviata,
}: {
  aEmail: string
  nomeDestinatario: string
  onInviata?: () => void
}) {
  const [aperto, setAperto] = useState(false)
  const [messaggio, setMessaggio] = useState('')
  const [inviata, setInviata] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  if (inviata) return <p className="muted">Risposta inviata a {nomeDestinatario}.</p>

  if (!aperto) {
    return (
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAperto(true)}>
        Rispondi
      </button>
    )
  }

  function invia() {
    if (!messaggio.trim()) return
    setErrore(null)
    const dati = new FormData()
    dati.append('destinatari', aEmail)
    dati.append('messaggio', messaggio)

    startTransition(async () => {
      const esito = await inviaNotifica(dati)
      if (!esito.ok) {
        setErrore(esito.errore)
        return
      }
      setInviata(true)
      onInviata?.()
    })
  }

  return (
    <div className="risposta field">
      <textarea
        rows={2}
        value={messaggio}
        maxLength={LUNGHEZZA_MASSIMA_MESSAGGIO}
        disabled={inCorso}
        onChange={(e) => setMessaggio(e.target.value)}
        placeholder={`Rispondi a ${nomeDestinatario}…`}
        autoFocus
      />
      <div className="risposta-azioni">
        <button
          type="button"
          className="btn btn-sm"
          disabled={inCorso || !messaggio.trim()}
          onClick={invia}
        >
          {inCorso ? 'Invio…' : 'Invia risposta'}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={inCorso}
          onClick={() => setAperto(false)}
        >
          Annulla
        </button>
      </div>
      {errore && <p className="error-banner">{errore}</p>}
    </div>
  )
}
