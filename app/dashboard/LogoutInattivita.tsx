'use client'

import { useEffect, useRef, useState } from 'react'
import { logoutPerInattivita } from '@/app/login/actions'

// Logout automatico dopo un'ora senza usare il pannello.
//
// Il pannello resta aperto sui computer della reception, condivisi: senza
// questo, chiunque passi al banco legge contatti e trattative di chi si è
// allontanato. Un minuto prima compare un avviso con «Resto collegato».
//
// L'ultima attività vive in localStorage e non in uno stato del componente:
// con il pannello aperto in due schede, lavorare in una deve tenere viva
// anche l'altra, altrimenti la scheda dimenticata butterebbe fuori la
// persona mentre lavora in quella accanto.

const INATTIVITA_MS = 60 * 60 * 1000
const AVVISO_MS = 60 * 1000
const CHIAVE = 'ronchiverdi-ultima-attivita'
const EVENTI = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove'] as const

function leggi(): number {
  try {
    return Number(localStorage.getItem(CHIAVE)) || Date.now()
  } catch {
    return Date.now()
  }
}

function segna() {
  try {
    localStorage.setItem(CHIAVE, String(Date.now()))
  } catch {
    // localStorage non disponibile (navigazione privata): vale la scheda.
  }
}

export function LogoutInattivita() {
  const [secondi, setSecondi] = useState<number | null>(null)
  const uscendo = useRef(false)
  const ultimaScrittura = useRef(0)

  useEffect(() => {
    segna()
    function attivita() {
      // mousemove scatta di continuo: una scrittura ogni 15 secondi basta.
      if (Date.now() - ultimaScrittura.current < 15000) return
      ultimaScrittura.current = Date.now()
      segna()
    }
    EVENTI.forEach((e) => window.addEventListener(e, attivita, { passive: true }))

    const timer = window.setInterval(() => {
      const fermo = Date.now() - leggi()
      if (fermo >= INATTIVITA_MS) {
        if (!uscendo.current) {
          uscendo.current = true
          void logoutPerInattivita()
        }
      } else if (fermo >= INATTIVITA_MS - AVVISO_MS) {
        setSecondi(Math.ceil((INATTIVITA_MS - fermo) / 1000))
      } else {
        setSecondi(null)
      }
    }, 1000)

    return () => {
      EVENTI.forEach((e) => window.removeEventListener(e, attivita))
      window.clearInterval(timer)
    }
  }, [])

  if (secondi === null) return null

  return (
    <div className="msg-overlay" role="alertdialog" aria-modal="true" aria-labelledby="inattivita-titolo">
      <div className="msg-modale">
        <p className="eyebrow">Sessione</p>
        <h2 id="inattivita-titolo">Sei ancora qui?</h2>
        <p className="muted">
          Per sicurezza il pannello si chiude dopo un&apos;ora senza attività. Uscita fra{' '}
          <strong>{secondi}</strong> secondi.
        </p>
        <div className="msg-modale-azioni">
          <button
            type="button"
            className="btn"
            onClick={() => {
              segna()
              setSecondi(null)
            }}
          >
            Resto collegato
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void logoutPerInattivita()}>
            Esci ora
          </button>
        </div>
      </div>
    </div>
  )
}
