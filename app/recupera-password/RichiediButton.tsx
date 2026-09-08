'use client'

import { useFormStatus } from 'react-dom'

// Come LoginButton: disabilitato durante l'invio. Qui conta il doppio, perché
// una seconda submission fa scattare il limite di invio di Supabase e chi
// aveva solo dimenticato la password si ritrova a dover aspettare.
export function RichiediButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-block" disabled={pending}>
      {pending ? 'Invio in corso…' : 'Mandami il link'}
    </button>
  )
}
