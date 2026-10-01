'use client'

import { useState, useTransition } from 'react'
import { reinviaInvito } from './actions'

// Rimanda il link per entrare: l'invito a chi non è mai entrato, il link per
// una password nuova a chi l'ha già (vedi reinviaInvito).
export function ReinviaInvito({ email, giaEntrato }: { email: string; giaEntrato: boolean }) {
  const [messaggio, setMessaggio] = useState<{ ok: boolean; testo: string } | null>(null)
  const [inCorso, startTransition] = useTransition()

  function invia() {
    setMessaggio(null)
    startTransition(async () => {
      const esito = await reinviaInvito(email)
      setMessaggio(
        esito.ok
          ? {
              ok: true,
              testo:
                esito.tipo === 'recupero'
                  ? `Inviato a ${email} il link per scegliere una nuova password.`
                  : `Invito rimandato a ${email}.`,
            }
          : { ok: false, testo: esito.errore }
      )
    })
  }

  return (
    <div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={invia} disabled={inCorso}>
        {inCorso ? 'Invio…' : giaEntrato ? 'Rimanda il link per la password' : 'Rimanda l’invito'}
      </button>
      {messaggio && (
        <p className="field-hint" style={{ color: messaggio.ok ? 'var(--ok)' : 'var(--error)' }}>
          {messaggio.testo}
        </p>
      )}
    </div>
  )
}
