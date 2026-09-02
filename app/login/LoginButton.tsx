'use client'

import { useFormStatus } from 'react-dom'

// Disabilita il pulsante mentre la Server Action è in corso: senza, un
// secondo tap prima del redirect (rete lenta, nessun riscontro visivo) manda
// un'altra submission e quindi un altro giro di login, con una voce doppia
// "Accesso riuscito" nel controllo operatori.
export function LoginButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-block" disabled={pending}>
      {pending ? 'Accesso in corso…' : 'Accedi'}
    </button>
  )
}
