'use client'

import { useEffect } from 'react'
import { attivaInstallazioneMobile } from '@/lib/installazione'

// Dichiara il manifest solo su telefono e tablet (vedi lib/installazione.ts).
// Sta nel layout radice e non in quello del pannello: anche dalla pagina di
// login il telefono deve poter salvare l'app sulla Home.
export function AttivaInstallazione() {
  useEffect(() => {
    attivaInstallazioneMobile()
  }, [])
  return null
}
