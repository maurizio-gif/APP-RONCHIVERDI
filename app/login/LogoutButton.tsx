'use client'

import { useFormStatus } from 'react-dom'

// Stessa protezione di LoginButton, e per lo stesso motivo: senza,
// un secondo tap su "Esci" prima del redirect (rete lenta, nessun riscontro
// visivo) manda una seconda invocazione della Server Action. La sessione è
// già chiusa dalla prima, quindi la seconda legge un utente nullo e registra
// un "logout" senza email nel registro operatori — un fantasma che non dice
// chi è stato, per un gesto che in realtà ha un autore.
export function LogoutButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-ghost btn-block btn-sm" disabled={pending}>
      {pending ? 'Uscita in corso…' : 'Esci'}
    </button>
  )
}
