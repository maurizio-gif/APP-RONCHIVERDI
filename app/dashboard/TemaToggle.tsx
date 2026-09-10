'use client'

import { useEffect, useState } from 'react'
import { applicaTema, temaSalvato, type Tema } from '@/lib/tema'

// L'interruttore chiaro/scuro, nel piede del menu accanto a quello delle
// push: sono la stessa cosa — due preferenze del dispositivo che si toccano
// una volta sola — quindi hanno la stessa forma, una riga piena con
// l'etichetta a sinistra.
//
// Lo stato iniziale si legge dopo il montaggio e non durante il render: il
// server non sa cosa c'è nel localStorage, e disegnare «scuro» mentre il
// server ha mandato «chiaro» è un errore di idratazione. Il tema vero è già
// applicato dallo script nel <head> — qui si sincronizza solo l'interruttore.
//
// Per la stessa ragione l'etichetta è «Tema» e non «Tema chiaro»/«Tema
// scuro»: una parola che cambia al montaggio si vedrebbe cambiare a ogni
// caricamento di chi tiene lo scuro. Lo stato lo dice il binario, che si
// legge prima di una parola.
export function TemaToggle() {
  const [tema, setTema] = useState<Tema>('chiaro')

  useEffect(() => {
    setTema(temaSalvato())
  }, [])

  function alterna() {
    const nuovo: Tema = tema === 'scuro' ? 'chiaro' : 'scuro'
    setTema(nuovo)
    applicaTema(nuovo)
  }

  const scuro = tema === 'scuro'

  return (
    <div className="tema-nav">
      <button
        type="button"
        className={`tema-nav-toggle${scuro ? ' is-scuro' : ''}`}
        onClick={alterna}
        aria-pressed={scuro}
        title={scuro ? 'Passa al tema chiaro' : 'Passa al tema scuro'}
      >
        <span>Tema</span>
        <span className="tema-switch" aria-hidden="true">
          <svg
            className="tema-switch-icona tema-switch-sole"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.6v2.3M12 19.1v2.3M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.6 12h2.3M19.1 12h2.3M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
          </svg>
          <svg
            className="tema-switch-icona tema-switch-luna"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* La falce è un cerchio pieno con un morso, disegnata in un
                tratto solo: due cerchi sovrapposti in tratto si vedono
                entrambi. */}
            <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7.5 7.5 0 1 0 10.5 10.5Z" />
          </svg>
          <span className="tema-switch-pallino" />
        </span>
      </button>
    </div>
  )
}
