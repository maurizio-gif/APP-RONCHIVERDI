'use client'

import { useFormStatus } from 'react-dom'

export function SalvaButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-block" disabled={pending}>
      {pending ? 'Salvataggio…' : 'Salva ed entra'}
    </button>
  )
}
