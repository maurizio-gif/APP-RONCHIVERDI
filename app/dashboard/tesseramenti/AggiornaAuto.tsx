'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

// Gli esiti dei tesseramenti automatici arrivano mentre la pagina è aperta:
// la si riaggiorna da sola, ma solo se la scheda è in primo piano.
const OGNI_MS = 20_000

export function AggiornaAuto() {
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, OGNI_MS)
    return () => clearInterval(t)
  }, [router])
  return null
}
