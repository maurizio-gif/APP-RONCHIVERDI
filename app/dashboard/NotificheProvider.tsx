'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { UltimoMessaggio } from './notifiche/actions'

// Trenta secondi: è una comunicazione di servizio, non una chat. Più spesso
// significherebbe una lettura in più al database per ogni pannello aperto
// senza che nessuno se ne accorga.
const INTERVALLO_MS = 30000

type StatoNotifiche = {
  nonLette: number
  ultimo: UltimoMessaggio | null
  segnaLettoInLocale: () => void
  chiudiUltimo: (id: number) => void
}

const Contesto = createContext<StatoNotifiche | null>(null)

/**
 * Stato condiviso fra la Sidebar (il badge nel menu) e NotificheBanner
 * (l'avviso in evidenza): un solo polling per tutta l'app invece di uno per
 * componente, così i due restano sempre d'accordo — confermare dall'avviso
 * aggiorna subito anche il badge, senza aspettare il giro dopo.
 */
export function NotificheProvider({
  abilitato,
  nonLetteIniziali,
  children,
}: {
  /** Chi non ha il permesso non riceve nulla: nessun polling, badge a zero. */
  abilitato: boolean
  nonLetteIniziali: number
  children: React.ReactNode
}) {
  const [nonLette, setNonLette] = useState(nonLetteIniziali)
  const [ultimo, setUltimo] = useState<UltimoMessaggio | null>(null)
  // Gli id già mostrati in questa sessione del browser: un messaggio ancora
  // da confermare non deve tornare in primo piano a ogni giro di polling
  // dopo che è stato chiuso, ma l'avviso resta finché non si conferma.
  const giaMostrati = useRef<Set<number>>(new Set())

  const aggiorna = useCallback(async () => {
    // Una rotta e non una Server Action: un'azione è un POST alla pagina
    // aperta e finisce nella stessa coda del router davanti alle navigazioni,
    // quindi ogni giro rallenterebbe il cambio di pagina. Un giro andato male
    // non ferma i successivi: alla lettura dopo il conteggio è quello giusto.
    try {
      const risposta = await fetch('/api/interno/notifiche/stato', { cache: 'no-store' })
      if (!risposta.ok) return
      const stato = (await risposta.json()) as {
        nonLette: number
        ultimo: UltimoMessaggio | null
      }
      setNonLette(stato.nonLette)

      if (stato.ultimo && !giaMostrati.current.has(stato.ultimo.id)) {
        giaMostrati.current.add(stato.ultimo.id)
        setUltimo(stato.ultimo)
      }
    } catch {
      // Silenzio: il badge resta al valore precedente, che è meglio di zero.
    }
  }, [])

  useEffect(() => {
    if (!abilitato) return
    aggiorna()
    const timer = setInterval(aggiorna, INTERVALLO_MS)
    return () => clearInterval(timer)
  }, [abilitato, aggiorna])

  // Solo il conteggio: l'avviso resta aperto dopo la conferma, così può
  // proporre "Rispondi" invece di sparire (vedi NotificheBanner). Si chiude
  // con chiudiUltimo, non da qui.
  function segnaLettoInLocale() {
    setNonLette((n) => Math.max(0, n - 1))
  }

  function chiudiUltimo(id: number) {
    setUltimo((u) => (u?.id === id ? null : u))
  }

  return (
    <Contesto.Provider value={{ nonLette, ultimo, segnaLettoInLocale, chiudiUltimo }}>
      {children}
    </Contesto.Provider>
  )
}

export function useNotifiche(): StatoNotifiche {
  const contesto = useContext(Contesto)
  if (!contesto) throw new Error('useNotifiche va usato dentro NotificheProvider')
  return contesto
}
