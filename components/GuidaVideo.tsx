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
// Il video arriva in uno di due modi. Con vidyardId il player è quello
// ufficiale di Vidyard (script embed/v4.js + <img
// class="vidyard-player-embed">, non un iframe verso la pagina di
// condivisione): quella pagina porta il logo Vidyard e un invito a
// registrarsi, questo è solo il video. Con src è un file video servito
// dall'app stessa (cartella public/), riprodotto da un normale <video>.
type SorgenteVideo =
  | {
      /** L'id del video, dalla URL share.vidyard.com/watch/<id>. */
      vidyardId: string
      src?: never
      poster?: never
    }
  | {
      /** Un file video, ad es. /guide/agenda-new.mp4 (sta in public/). */
      src: string
      /** L'immagine che si vede prima di far partire il video. */
      poster?: string
      vidyardId?: never
    }

export function GuidaVideo({
  vidyardId,
  src,
  poster,
  titolo,
  etichetta = 'Guarda la guida',
}: SorgenteVideo & {
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
    if (vidyardId) renderizzaPlayer()
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
      {vidyardId && (
        <Script src="https://play.vidyard.com/embed/v4.js" strategy="afterInteractive" onLoad={renderizzaPlayer} />
      )}

      <div className="guida-video-bottone">
        <button type="button" className="btn btn-sm" onClick={() => setAperto(true)}>
          ▶ {etichetta}
        </button>
      </div>

      {aperto && (
        <div className="guida-video-overlay" onClick={() => setAperto(false)}>
          <div
            className={`guida-video-modale${src ? ' guida-video-modale-larga' : ''}`}
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
              {src ? (
                // Parte da solo: ci si arriva da un clic sul pulsante. La
                // modale si smonta alla chiusura, quindi il video si ferma.
                <video className="guida-video-file" src={src} poster={poster} controls autoPlay playsInline preload="metadata" />
              ) : (
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
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
