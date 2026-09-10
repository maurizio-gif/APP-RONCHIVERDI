'use client'

import { useCampanello } from './useAvvisoSonoro'

// Il campanello dell'avviso trattative, in cima al menu accanto al tema.
//
// L'interruttore c'era già, ma solo dentro il popup dell'avviso: chi lo
// spegneva una volta non aveva più un posto dove riaccenderlo, perché il
// popup compare solo quando arriva una trattativa — e quello è esattamente
// il momento in cui non compare più. Qui si trova anche a silenzio già
// fatto.
//
// I due interruttori leggono la stessa preferenza (vedi useAvvisoSonoro):
// spegnere dal popup spegne anche questo, senza ricaricare.
export function CampanelloToggle() {
  const { attivo, alterna } = useCampanello()

  return (
    <button
      type="button"
      className={`strumento-btn campanello${attivo ? '' : ' e-muto'}`}
      onClick={alterna}
      aria-pressed={attivo}
      title={
        attivo
          ? 'Suona quando arriva una trattativa da prendere in carico'
          : 'Il campanello è spento: gli avvisi compaiono lo stesso, in silenzio'
      }
    >
      <svg
        className="strumento-icona"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3.2a5.2 5.2 0 0 0-5.2 5.2v3.3c0 .95-.37 1.85-1.04 2.5L5 15.2h14l-.76-1c-.67-.65-1.04-1.55-1.04-2.5V8.4A5.2 5.2 0 0 0 12 3.2z" />
        <path d="M9.5 18.4a2.5 2.5 0 0 0 5 0" />
        {/* La sbarra è il solo modo in cui una campana spenta si distingue da
            una accesa in un'icona in tratto da sedici pixel. */}
        {!attivo && <path d="M4 4l16 16" />}
      </svg>
      <span>Campanello</span>
    </button>
  )
}
