'use client'

import { useRef, useState } from 'react'

// L'email com'è arrivata, in un iframe isolato: i suoi stili non toccano il
// pannello, e nessuno script dell'email può girare (sandbox senza
// allow-scripts). L'altezza segue il contenuto, così la stampa non la taglia.
export function AnteprimaEmail({ html, testo }: { html: string | null; testo: string | null }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [altezza, setAltezza] = useState(400)

  function misura() {
    const doc = ref.current?.contentDocument
    if (doc) setAltezza(Math.max(200, doc.documentElement.scrollHeight + 16))
  }

  if (!html) return <pre className="pi-testo">{testo ?? 'Testo non registrato.'}</pre>

  return (
    <iframe
      ref={ref}
      title="Email inviata"
      className="pi-iframe"
      sandbox="allow-same-origin"
      srcDoc={html}
      style={{ height: altezza }}
      onLoad={() => {
        misura()
        // Le immagini e i font arrivano dopo il load del documento.
        setTimeout(misura, 400)
      }}
    />
  )
}
