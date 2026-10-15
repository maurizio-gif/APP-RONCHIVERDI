// Installazione del pannello come app (PWA): solo su telefono e tablet.
//
// Su computer il pannello si usa dal browser e non deve potersi installare.
// L'installabilità la decide il manifest: Chrome ed Edge da desktop mostrano
// «Installa app» appena una pagina ne dichiara uno. Per questo il manifest non
// è più dichiarato nell'HTML (niente app/manifest.ts, che Next.js collega a
// ogni pagina): lo aggiunge `attivaInstallazioneMobile` dal browser, e solo se
// il dispositivo è mobile. Il riconoscimento sta nel browser e non sul server
// perché l'iPad si presenta con lo user agent di un Mac: lo si distingue solo
// dal touch, che il server non vede.
//
// Solo per componenti client: usa window e navigator.

export type Sistema = 'ios' | 'android' | 'desktop'

/** Il browser, quanto basta a scegliere le istruzioni giuste. */
export type Browser = 'safari' | 'chrome' | 'samsung' | 'firefox' | 'edge' | 'in-app' | 'altro'

export type Dispositivo = {
  sistema: Sistema
  browser: Browser
  /** Aperto dall'icona sulla Home, a schermo intero: l'app è già installata. */
  installata: boolean
}

export const HREF_MANIFEST = '/manifest.webmanifest'

export function rilevaDispositivo(): Dispositivo {
  const ua = navigator.userAgent
  // iPadOS si dichiara Macintosh: un Mac con lo schermo touch è un iPad.
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  const android = /Android/i.test(ua)
  const sistema: Sistema = ios ? 'ios' : android ? 'android' : 'desktop'

  // I browser dentro le app (Instagram, Facebook, le webview di Android) non
  // sanno installare niente: va riconosciuto prima di tutti gli altri.
  const browser: Browser = /FBAN|FBAV|Instagram|Line\/|; wv\)|GSA\//i.test(ua)
    ? 'in-app'
    : /SamsungBrowser/i.test(ua)
      ? 'samsung'
      : /EdgiOS|EdgA|Edg\//i.test(ua)
        ? 'edge'
        : /FxiOS|Firefox/i.test(ua)
          ? 'firefox'
          : /CriOS|Chrome/i.test(ua)
            ? 'chrome'
            : /Safari/i.test(ua)
              ? 'safari'
              : 'altro'

  const installata =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true

  return { sistema, browser, installata: !!installata }
}

// ───────────────────────────────────── il prompt di installazione (Android)
//
// Chrome su Android annuncia con `beforeinstallprompt` che l'app si può
// installare: l'evento si trattiene e lo si usa quando la persona tocca
// «Installa ora», invece di lasciare a Chrome la sua barra automatica.

type EventoInstallazione = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let promptTrattenuto: EventoInstallazione | null = null
const ascoltatori = new Set<() => void>()

function avvisa() {
  ascoltatori.forEach((f) => f())
}

export function promptDisponibile(): boolean {
  return promptTrattenuto != null
}

export function suCambioPrompt(f: () => void): () => void {
  ascoltatori.add(f)
  return () => {
    ascoltatori.delete(f)
  }
}

/** Apre il prompt di sistema. Vero se la persona ha installato. */
export async function lanciaPrompt(): Promise<boolean> {
  const evento = promptTrattenuto
  if (!evento) return false
  promptTrattenuto = null
  avvisa()
  await evento.prompt()
  const scelta = await evento.userChoice
  return scelta.outcome === 'accepted'
}

function aggiungiAlHead(tag: 'link' | 'meta', attributi: Record<string, string>, chiave: string) {
  if (document.head.querySelector(chiave)) return
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attributi)) el.setAttribute(k, v)
  document.head.appendChild(el)
}

let attivata = false

/**
 * Da chiamare una volta al caricamento. Su mobile dichiara il manifest e i meta
 * di iOS, e trattiene il prompt di Android; su computer non dichiara niente, e
 * se un browser proponesse comunque l'installazione la blocca.
 */
export function attivaInstallazioneMobile(): Dispositivo {
  const dispositivo = rilevaDispositivo()
  if (attivata) return dispositivo
  attivata = true

  if (dispositivo.sistema === 'desktop') {
    window.addEventListener('beforeinstallprompt', (e) => e.preventDefault())
    return dispositivo
  }

  aggiungiAlHead('link', { rel: 'manifest', href: HREF_MANIFEST }, 'link[rel="manifest"]')
  // iOS: a schermo intero dall'icona, con il nome giusto sotto l'icona (deve
  // restare uguale a name/short_name del manifest).
  aggiungiAlHead(
    'meta',
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    'meta[name="apple-mobile-web-app-capable"]'
  )
  aggiungiAlHead('meta', { name: 'mobile-web-app-capable', content: 'yes' }, 'meta[name="mobile-web-app-capable"]')
  aggiungiAlHead(
    'meta',
    { name: 'apple-mobile-web-app-title', content: 'CRM Ronchiverdi' },
    'meta[name="apple-mobile-web-app-title"]'
  )
  aggiungiAlHead(
    'meta',
    { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
    'meta[name="apple-mobile-web-app-status-bar-style"]'
  )

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    promptTrattenuto = e as EventoInstallazione
    avvisa()
  })
  window.addEventListener('appinstalled', () => {
    promptTrattenuto = null
    avvisa()
  })

  return dispositivo
}
