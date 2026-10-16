'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { prendiVisione } from '../actions'

// Chi gestisce apre un ticket che gli è arrivato: è la presa visione. La si
// registra appena la pagina è davanti ai suoi occhi, non al render sul
// server, così un prefetch non spegne l'avviso al posto suo.
export function PresaVisione({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  useEffect(() => {
    prendiVisione(ticketId).then(() => router.refresh())
  }, [ticketId, router])
  return null
}
