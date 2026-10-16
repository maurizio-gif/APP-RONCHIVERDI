'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { StatoTicketUtente } from '@/lib/ticket-server'

// Il segnale dei ticket da leggere, per tutti: chi ha aperto un ticket e ha
// una risposta, chi gestisce e ha un ticket nuovo o passato a lui. Una barra
// in fondo allo schermo che lampeggia: non blocca il lavoro, ma non si chiude
// — si spegne solo leggendo (e confermando) il ticket. Si aggiorna ogni 30
// secondi, come i messaggi interni.

const INTERVALLO_MS = 30_000

const Contesto = createContext<StatoTicketUtente>({ daLeggere: 0, primo: null })

export function useTicketDaLeggere() {
  return useContext(Contesto)
}

export function TicketProvider({ iniziale, children }: { iniziale: StatoTicketUtente; children: React.ReactNode }) {
  const [stato, setStato] = useState(iniziale)
  const pathname = usePathname()

  const aggiorna = useCallback(async () => {
    try {
      const r = await fetch('/api/interno/ticket/stato', { cache: 'no-store' })
      if (r.ok) setStato(await r.json())
    } catch {
      // Rete assente: si riprova al giro dopo.
    }
  }, [])

  useEffect(() => {
    const t = setInterval(aggiorna, INTERVALLO_MS)
    return () => clearInterval(t)
  }, [aggiorna])
  // Cambiando pagina (per esempio dopo aver risposto) si riallinea subito.
  useEffect(() => {
    aggiorna()
  }, [pathname, aggiorna])

  return <Contesto.Provider value={stato}>{children}</Contesto.Provider>
}

export function TicketAvviso() {
  const { daLeggere, primo } = useTicketDaLeggere()
  const pathname = usePathname()
  if (!daLeggere || !primo) return null
  // Sulla pagina del ticket da leggere l'avviso sarebbe ridondante.
  if (pathname === `/dashboard/ticket/${primo.id}`) return null
  const href = daLeggere > 1 ? '/dashboard/ticket' : `/dashboard/ticket/${primo.id}`
  return (
    <Link href={href} className="tk-avviso" role="status">
      <span className="tk-avviso-luce" aria-hidden="true" />
      <span className="tk-avviso-testo">
        {daLeggere > 1 ? (
          <>
            <b>{daLeggere} ticket da leggere</b> · {primo.motivo}: #{primo.numero} {primo.titolo}
          </>
        ) : (
          <>
            <b>{primo.motivo}</b> · #{primo.numero} {primo.titolo}
          </>
        )}
      </span>
      <span className="tk-avviso-apri">Leggi →</span>
    </Link>
  )
}
