'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  lanciaPrompt,
  promptDisponibile,
  rilevaDispositivo,
  suCambioPrompt,
  type Dispositivo,
} from '@/lib/installazione'

// L'invito a salvare il pannello sulla Home, solo su telefono e tablet e solo
// finché l'app non è installata: un banner in cima (che si chiude con «Non
// ora») e una voce fissa nel menu. Tutti e due aprono le istruzioni per il
// telefono e il browser che la persona ha in mano — i passi di Safari su
// Android non servono a niente, e viceversa. Su computer non compare nulla:
// lì l'installazione non è prevista (vedi lib/installazione.ts).

const CHIAVE_NASCOSTO = 'rv-installa-nascosto-fino'
const GIORNI_NASCOSTO = 14

function useDispositivoMobile(): { dispositivo: Dispositivo | null; prompt: boolean } {
  const [dispositivo, setDispositivo] = useState<Dispositivo | null>(null)
  const [prompt, setPrompt] = useState(false)
  useEffect(() => {
    const d = rilevaDispositivo()
    setDispositivo(d.sistema === 'desktop' || d.installata ? null : d)
    setPrompt(promptDisponibile())
    return suCambioPrompt(() => setPrompt(promptDisponibile()))
  }, [])
  return { dispositivo, prompt }
}

// ─────────────────────────────────────────────── le icone dei passaggi

function IconaCondividi() {
  return (
    <svg className="inst-icona" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  )
}

function IconaTrePuntiVerticali() {
  return (
    <svg className="inst-icona" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="5" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="12" cy="19" r="1.4" />
    </svg>
  )
}

function IconaAggiungi() {
  return (
    <svg className="inst-icona" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  )
}

function IconaTreLinee() {
  return (
    <svg className="inst-icona" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

// ───────────────────────────────────────────────────────── le istruzioni

type Istruzioni = { titolo: string; passi: ReactNode[]; nota?: ReactNode }

function istruzioniPer(d: Dispositivo): Istruzioni {
  const nomeApp = <strong>CRM Ronchiverdi</strong>

  if (d.browser === 'in-app') {
    return {
      titolo: 'Apri prima il pannello nel browser',
      passi: [
        <>
          Questo è il browser interno di un’altra app, e da qui non si può installare niente.
        </>,
        <>
          Tocca i tre puntini <IconaTrePuntiVerticali /> o il menu in alto e scegli{' '}
          <strong>{d.sistema === 'ios' ? 'Apri in Safari' : 'Apri in Chrome'}</strong>.
        </>,
        <>Poi riapri queste istruzioni dal menu del pannello: «Installa l’app».</>,
      ],
    }
  }

  if (d.sistema === 'ios') {
    if (d.browser === 'safari') {
      return {
        titolo: 'iPhone e iPad · Safari',
        passi: [
          <>
            Tocca <strong>Condividi</strong> <IconaCondividi /> nella barra di Safari (in basso
            sull’iPhone, in alto sull’iPad). Se non lo vedi, tocca prima i tre puntini «•••».
          </>,
          <>
            Scorri e tocca <strong>Aggiungi alla schermata Home</strong> <IconaAggiungi />.
          </>,
          <>
            Lascia attivo <strong>Apri come app web</strong>, se compare, e tocca{' '}
            <strong>Aggiungi</strong> in alto a destra.
          </>,
          <>Trovi l’icona {nomeApp} sulla Home: da lì il pannello si apre a schermo intero.</>,
        ],
      }
    }
    return {
      titolo: 'iPhone e iPad · Chrome o altri browser',
      passi: [
        <>
          Tocca <strong>Condividi</strong> <IconaCondividi /> nella barra dell’indirizzo, in alto a
          destra.
        </>,
        <>
          Tocca <strong>Aggiungi alla schermata Home</strong> <IconaAggiungi />, poi{' '}
          <strong>Aggiungi</strong>.
        </>,
        <>Trovi l’icona {nomeApp} sulla Home.</>,
      ],
      nota: (
        <>
          Se la voce non c’è, apri questo indirizzo in <strong>Safari</strong> e segui i passi da
          lì: su iPhone è il browser che installa meglio le app.
        </>
      ),
    }
  }

  // Android
  if (d.browser === 'samsung') {
    return {
      titolo: 'Android · Samsung Internet',
      passi: [
        <>
          Tocca il menu <IconaTreLinee /> in basso a destra.
        </>,
        <>
          Tocca <strong>Aggiungi pagina a</strong>, poi <strong>Schermata Home</strong>.
        </>,
        <>
          Conferma con <strong>Aggiungi</strong>: trovi l’icona {nomeApp} sulla Home.
        </>,
      ],
    }
  }
  if (d.browser === 'firefox') {
    return {
      titolo: 'Android · Firefox',
      passi: [
        <>
          Tocca i tre puntini <IconaTrePuntiVerticali /> accanto alla barra dell’indirizzo.
        </>,
        <>
          Tocca <strong>Installa</strong> (o <strong>Aggiungi alla schermata principale</strong>).
        </>,
        <>Conferma: trovi l’icona {nomeApp} sulla Home.</>,
      ],
    }
  }
  return {
    titolo: d.browser === 'edge' ? 'Android · Edge' : 'Android · Chrome',
    passi: [
      <>
        Tocca i tre puntini <IconaTrePuntiVerticali /> in alto a destra.
      </>,
      <>
        Tocca <strong>Installa app</strong> (su alcuni telefoni:{' '}
        <strong>Aggiungi a schermata Home</strong>).
      </>,
      <>
        Conferma con <strong>Installa</strong>: trovi l’icona {nomeApp} sulla Home e fra le app.
      </>,
    ],
  }
}

// ──────────────────────────────────────────────────────────── la finestra

function FinestraIstruzioni({
  dispositivo,
  prompt,
  onChiudi,
}: {
  dispositivo: Dispositivo
  prompt: boolean
  onChiudi: () => void
}) {
  const [esito, setEsito] = useState<string | null>(null)
  const istruzioni = istruzioniPer(dispositivo)

  useEffect(() => {
    const suTasto = (e: KeyboardEvent) => e.key === 'Escape' && onChiudi()
    window.addEventListener('keydown', suTasto)
    return () => window.removeEventListener('keydown', suTasto)
  }, [onChiudi])

  // Nel body e non dove sta il pulsante: la voce vive nel menu laterale, che
  // su telefono è un pannello a sé e taglierebbe una finestra posizionata dentro.
  return createPortal(
    <div className="inst-velo" role="presentation" onClick={onChiudi}>
      <div
        className="inst-finestra"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inst-titolo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="inst-testa">
          <h2 id="inst-titolo">Installa l’app</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onChiudi}>
            Chiudi
          </button>
        </div>
        <p className="muted inst-intro">
          Con l’icona sulla Home il pannello si apre a schermo intero, come un’app, e resti
          collegato.
        </p>

        {/* Su Android, quando Chrome lo permette, un tocco solo: il resto è
            il ripiego per quando il prompt non è disponibile. */}
        {prompt && dispositivo.sistema === 'android' && (
          <div className="inst-subito">
            <button
              type="button"
              className="btn btn-block inst-bottone"
              onClick={async () => {
                const installata = await lanciaPrompt()
                setEsito(installata ? 'Fatto: trovi CRM Ronchiverdi sulla Home.' : null)
              }}
            >
              Installa ora
            </button>
            {esito && <p className="ok-banner">{esito}</p>}
            <p className="muted inst-oppure">oppure, a mano:</p>
          </div>
        )}

        <h3 className="inst-sottotitolo">{istruzioni.titolo}</h3>
        <ol className="inst-passi">
          {istruzioni.passi.map((passo, i) => (
            <li key={i}>{passo}</li>
          ))}
        </ol>
        {istruzioni.nota && <p className="field-hint inst-nota">{istruzioni.nota}</p>}
      </div>
    </div>,
    document.body
  )
}

// ─────────────────────────────────────────────── banner e voce di menu

/** Il banner in cima al pannello: si chiude con «Non ora» per due settimane. */
export function BannerInstallazione() {
  const { dispositivo, prompt } = useDispositivoMobile()
  const [nascosto, setNascosto] = useState(true)
  const [aperta, setAperta] = useState(false)

  useEffect(() => {
    try {
      const fino = Number(localStorage.getItem(CHIAVE_NASCOSTO) ?? 0)
      setNascosto(Date.now() < fino)
    } catch {
      setNascosto(false)
    }
  }, [])

  if (!dispositivo) return null

  return (
    <>
      {!nascosto && (
        <div className="info-banner inst-banner">
          <span>Salva il pannello sulla Home del telefono: si apre come un’app.</span>
          <span className="inst-banner-comandi">
            <button type="button" className="btn btn-sm" onClick={() => setAperta(true)}>
              Come si fa
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setNascosto(true)
                try {
                  localStorage.setItem(CHIAVE_NASCOSTO, String(Date.now() + GIORNI_NASCOSTO * 86400000))
                } catch {
                  // Senza memoria del browser il banner tornerà alla prossima pagina: pazienza.
                }
              }}
            >
              Non ora
            </button>
          </span>
        </div>
      )}
      {aperta && <FinestraIstruzioni dispositivo={dispositivo} prompt={prompt} onChiudi={() => setAperta(false)} />}
    </>
  )
}

/** La voce fissa nel menu: c'è anche dopo aver chiuso il banner. */
export function VoceInstallaApp() {
  const { dispositivo, prompt } = useDispositivoMobile()
  const [aperta, setAperta] = useState(false)

  if (!dispositivo) return null

  return (
    <>
      <button type="button" className="nav-item inst-voce" onClick={() => setAperta(true)}>
        <svg
          className="nav-icona"
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="7" y="2.5" width="10" height="19" rx="2.2" />
          <path d="M12 7.5v7M9 11.5l3 3 3-3" />
        </svg>
        Installa l’app
      </button>
      {aperta && <FinestraIstruzioni dispositivo={dispositivo} prompt={prompt} onChiudi={() => setAperta(false)} />}
    </>
  )
}
