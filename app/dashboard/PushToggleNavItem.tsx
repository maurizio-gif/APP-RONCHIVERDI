'use client'

import { usePushSottoscrizione } from './notifiche/usePushSottoscrizione'

// L'interruttore delle notifiche push, nel menu e non dentro la pagina dei
// messaggi: va acceso una volta su ogni dispositivo con cui si vuole essere
// avvisati, e dentro una sezione che si apre di rado nessuno lo troverebbe.
//
// Grafica volutamente diversa dalle voci di navigazione: agisce sul posto,
// non porta altrove.
export function PushToggleNavItem() {
  const { stato, inCorso, errore, attiva, disattiva } = usePushSottoscrizione()

  // Durante la verifica non si mostra niente: un pulsante che dice "Attiva" e
  // un istante dopo "Attive" sembra un errore.
  if (stato === 'verifica') return null

  if (stato === 'non-supportato') {
    return (
      <div className="push-nav">
        <button
          type="button"
          className="push-nav-toggle"
          disabled
          title="Su iPhone e iPad servono dall'app salvata sulla Home: Safari → Condividi → Aggiungi a Home, poi riprova da lì."
        >
          <Campanella />
          <span>Notifiche non disponibili</span>
        </button>
      </div>
    )
  }

  const attivo = stato === 'attivo'

  return (
    <div className="push-nav">
      <button
        type="button"
        className={`push-nav-toggle${attivo ? ' is-attivo' : ''}`}
        disabled={inCorso}
        onClick={attivo ? disattiva : attiva}
        title={
          attivo
            ? 'Notifiche attive su questo dispositivo: premi per spegnerle'
            : 'Attiva le notifiche su questo dispositivo'
        }
      >
        <Campanella acceso={attivo} />
        <span>{inCorso ? 'Attendere…' : attivo ? 'Notifiche attive' : 'Attiva notifiche'}</span>
      </button>
      {errore && <p className="push-nav-errore">{errore}</p>}
    </div>
  )
}

function Campanella({ acceso }: { acceso?: boolean }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill={acceso ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="nav-icona"
      aria-hidden="true"
    >
      <path d="M12 3.2a5.2 5.2 0 0 0-5.2 5.2v3.3c0 .95-.37 1.85-1.04 2.5L5 15.2h14l-.76-1c-.67-.65-1.04-1.55-1.04-2.5V8.4A5.2 5.2 0 0 0 12 3.2z" />
      <path d="M9.5 18.4a2.5 2.5 0 0 0 5 0" />
    </svg>
  )
}
