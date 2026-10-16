'use client'

import { useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/browserClient'
import {
  ACCEPT_ALLEGATI_TICKET,
  BUCKET_TICKET,
  MASSIMO_ALLEGATI,
  erroreAllegato,
  pesoLeggibile,
} from '@/lib/ticket'
import { preparaAllegati, type AllegatoCaricato } from './actions'

// Gli allegati di un ticket: si scelgono qui, si controllano subito (tipo e
// peso) e si caricano solo all'invio, direttamente dal browser su Supabase
// con gli URL firmati che rilascia il server (vedi preparaAllegati).

export function useAllegati() {
  const [file, setFile] = useState<File[]>([])
  const [errore, setErrore] = useState<string | null>(null)

  function aggiungi(nuovi: FileList | null) {
    if (!nuovi) return
    setErrore(null)
    const tutti = [...file, ...Array.from(nuovi)]
    if (tutti.length > MASSIMO_ALLEGATI) {
      setErrore(`Al massimo ${MASSIMO_ALLEGATI} allegati.`)
      return
    }
    for (const f of nuovi) {
      const e = erroreAllegato({ nome: f.name, tipo: f.type, byte: f.size })
      if (e) {
        setErrore(e)
        return
      }
    }
    setFile(tutti)
  }

  function togli(i: number) {
    setFile((f) => f.filter((_, j) => j !== i))
  }

  // Carica tutto e restituisce cosa registrare sul ticket; lancia con un
  // messaggio leggibile se qualcosa va storto.
  async function carica(): Promise<AllegatoCaricato[]> {
    if (!file.length) return []
    const preparati = await preparaAllegati(file.map((f) => ({ nome: f.name, tipo: f.type, byte: f.size })))
    if (!preparati.ok) throw new Error(preparati.errore)
    const supabase = createSupabaseBrowserClient()
    const caricati: AllegatoCaricato[] = []
    for (let i = 0; i < file.length; i++) {
      const f = file[i]
      const c = preparati.caricamenti[i]
      const { error } = await supabase.storage
        .from(BUCKET_TICKET)
        .uploadToSignedUrl(c.percorso, c.token, f, { contentType: c.tipo })
      if (error) throw new Error(`«${f.name}» non è stato caricato: ${error.message}`)
      caricati.push({ percorso: c.percorso, nome: f.name, tipo: c.tipo, byte: f.size })
    }
    return caricati
  }

  return { file, errore, aggiungi, togli, carica, svuota: () => setFile([]) }
}

export function SceltaAllegati({
  allegati,
  disabilitato,
}: {
  allegati: ReturnType<typeof useAllegati>
  disabilitato?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="tk-allegati">
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT_ALLEGATI_TICKET}
        hidden
        onChange={(e) => {
          allegati.aggiungi(e.target.files)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => input.current?.click()}
        disabled={disabilitato || allegati.file.length >= MASSIMO_ALLEGATI}
      >
        📎 Allega immagini o PDF
      </button>
      <span className="muted tk-allegati-nota">Foto, screenshot (anche dell’iPhone) o PDF · fino a 10 MB l’uno · massimo {MASSIMO_ALLEGATI}</span>
      {allegati.file.length > 0 && (
        <ul className="tk-allegati-elenco">
          {allegati.file.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span>{f.name}</span>
              <span className="muted">{pesoLeggibile(f.size)}</span>
              <button type="button" className="tk-togli" onClick={() => allegati.togli(i)} aria-label={`Togli ${f.name}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {allegati.errore && <p className="error-banner">{allegati.errore}</p>}
    </div>
  )
}
