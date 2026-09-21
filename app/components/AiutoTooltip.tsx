'use client'

import { useState, type ReactNode } from 'react'

// Spiegazione al passaggio del mouse (o al focus da tastiera), disegnata
// da noi — non il tooltip nativo del browser via l'attributo title, che
// in pratica si è rivelato inaffidabile (compare in ritardo se compare,
// dipende dal browser/dal sistema). Posizione in pixel via JS e
// `position: fixed` sul pannello (vedi .aiuto-tooltip in globals.css):
// stessa tecnica del tooltip dei grafici, per non venire tagliato
// dall'overflow-x di una tabella che scorre in orizzontale.
export default function AiutoTooltip({ testo, children }: { testo: string; children: ReactNode }) {
  const [posizione, setPosizione] = useState<{ left: number; top: number } | null>(null)

  // Il pannello ha max-width 260px (vedi .aiuto-tooltip): se l'elemento è
  // vicino al bordo destro dello schermo (es. l'ultima colonna di una
  // tabella larga), ancorarlo al suo `left` lo spingerebbe fuori dalla
  // finestra — lo si trattiene entro un margine di sicurezza.
  // `document.documentElement.clientWidth` (non `window.innerWidth`, che
  // include la scrollbar verticale) è la larghezza reale della viewport.
  function mostra(elemento: HTMLElement) {
    const rettangolo = elemento.getBoundingClientRect()
    const margine = 40
    const larghezzaFinestra = document.documentElement.clientWidth
    const left = Math.min(rettangolo.left, larghezzaFinestra - 260 - margine)
    setPosizione({ left: Math.max(left, margine), top: rettangolo.bottom + 6 })
  }

  return (
    <span
      className="th-aiuto"
      tabIndex={0}
      aria-label={typeof children === 'string' ? `${children}. ${testo}` : testo}
      onMouseEnter={(e) => mostra(e.currentTarget)}
      onMouseLeave={() => setPosizione(null)}
      onFocus={(e) => mostra(e.currentTarget)}
      onBlur={() => setPosizione(null)}
    >
      {children}
      {posizione && (
        <span className="aiuto-tooltip" style={posizione}>
          {testo}
        </span>
      )}
    </span>
  )
}
