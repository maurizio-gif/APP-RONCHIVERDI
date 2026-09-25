'use client'

import Script from 'next/script'
import { useEffect, useState } from 'react'

declare global {
  interface Window {
    VidyardV4?: { api?: { renderDOMPlayers?: () => void } }
  }
}

// Un pulsante fisso in un angolo, non un riquadro dentro la pagina: la guida
// deve essere lì per chi ne ha bisogno senza spostare di un pixel il resto
// del layout (tabelle, filtri, grafici) per chi non la usa mai. Stesso
// principio di .avviso-opportunita, ma nell'angolo opposto per non
// accavallarsi con l'avviso di una trattativa da prendere in carico.
//
// Il player è quello ufficiale di Vidyard (script embed/v4.js + <img
// class="vidyard-player-embed">, non un iframe verso la pagina di
// condivisione): quella pagina porta il logo Vidyard e un invito a
// registrarsi, questo è solo il video.
export function GuidaVideo({
  vidyardId,
  titolo,
  etichetta = 'Guarda la guida',
}: {
  /** L'id del video, dalla URL share.vidyard.com/watch/<id>. */
  vidyardId: string
  titolo: string
  etichetta?: string
}) {
  const [aperto, setAperto] = useState(false)

  // Lo script Vidyard cerca gli <img class="vidyard-player-embed"> solo al
  // proprio caricamento: uno che compare dopo (qui, quando si apre la
  // modale) resta un'immagine finché non gli si chiede esplicitamente di
  // ripassare il DOM. Va richiamato sia all'apertura (lo script è già
  // pronto) sia al termine del caricamento dello script (la modale è già
  // aperta, ad es. primo clic subito dopo il caricamento della pagina).
  function renderizzaPlayer() {
    window.VidyardV4?.api?.renderDOMPlayers?.()
  }

  useEffect(() => {
    if (!aperto) return
    renderizzaPlayer()
    const precedente = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function alTasto(e: KeyboardEvent) {
      if (e.key === 'Escape') setAperto(false)
    }
    window.addEventListener('keydown', alTasto)
    return () => {
      document.body.style.overflow = precedente
      window.removeEventListener('keydown', alTasto)
    }
  }, [aperto])

  return (
    <>
      <Script src="https://play.vidyard.com/embed/v4.js" strategy="afterInteractive" onLoad={renderizzaPlayer} />

      <div className="guida-video-bottone">
        <button type="button" className="btn btn-sm" onClick={() => setAperto(true)}>
          ▶ {etichetta}
        </button>
      </div>

      {aperto && (
        <div className="guida-video-overlay" onClick={() => setAperto(false)}>
          <div
            className="guida-video-modale"
            role="dialog"
            aria-modal="true"
            aria-label={titolo}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="guida-video-chiudi"
              aria-label="Chiudi"
              onClick={() => setAperto(false)}
            >
              ×
            </button>
            <p className="guida-video-titolo">{titolo}</p>
            <div className="guida-video-player">
              <img
                key={vidyardId}
                className="vidyard-player-embed"
                style={{ width: '100%', margin: 'auto', display: 'block' }}
                src={`https://play.vidyard.com/${vidyardId}.jpg`}
                data-uuid={vidyardId}
                data-v="4"
                data-type="inline"
                alt={titolo}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
