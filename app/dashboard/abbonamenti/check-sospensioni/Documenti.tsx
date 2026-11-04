'use client'

import { useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/browserClient'
import { BUCKET_SOSPENSIONI, MASSIMO_DOCUMENTI } from '@/lib/sospensioni'
import { ACCEPT_ALLEGATI_TICKET, erroreAllegato, pesoLeggibile } from '@/lib/ticket'
import { preparaDocumentiSospensione, type DocumentoCaricato } from './actions'

// I documenti che giustificano il motivo (certificato medico, trasferimento di
// lavoro, ...): si scelgono qui, si controllano subito (tipo e peso) e si
// caricano solo al salvataggio della nota, direttamente dal browser su
// Supabase con gli URL firmati che rilascia il server. Come gli allegati dei
// ticket (app/dashboard/ticket/Allegati.tsx), su un bucket a parte.

export function useDocumenti() {
  const [file, setFile] = useState<File[]>([])
  const [errore, setErrore] = useState<string | null>(null)

  function aggiungi(nuovi: FileList | null) {
    if (!nuovi) return
    setErrore(null)
    const tutti = [...file, ...Array.from(nuovi)]
    if (tutti.length > MASSIMO_DOCUMENTI) {
      setErrore(`Al massimo ${MASSIMO_DOCUMENTI} documenti.`)
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

  function svuota() {
    setFile([])
    setErrore(null)
  }

  // Carica tutto e restituisce cosa registrare sulla nota; lancia con un
  // messaggio leggibile se qualcosa va storto.
  async function carica(): Promise<DocumentoCaricato[]> {
    if (!file.length) return []
    const preparati = await preparaDocumentiSospensione(file.map((f) => ({ nome: f.name, tipo: f.type, byte: f.size })))
    if (!preparati.ok) throw new Error(preparati.errore)
    const supabase = createSupabaseBrowserClient()
    const caricati: DocumentoCaricato[] = []
    for (let i = 0; i < file.length; i++) {
      const f = file[i]
      const c = preparati.caricamenti[i]
      const { error } = await supabase.storage
        .from(BUCKET_SOSPENSIONI)
        .uploadToSignedUrl(c.percorso, c.token, f, { contentType: c.tipo })
      if (error) throw new Error(`«${f.name}» non è stato caricato: ${error.message}`)
      caricati.push({ percorso: c.percorso, nome: f.name, tipo: c.tipo, byte: f.size })
    }
    return caricati
  }

  return { file, errore, aggiungi, togli, carica, svuota }
}

export function SceltaDocumenti({
  documenti,
  disabilitato,
}: {
  documenti: ReturnType<typeof useDocumenti>
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
          documenti.aggiungi(e.target.files)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => input.current?.click()}
        disabled={disabilitato || documenti.file.length >= MASSIMO_DOCUMENTI}
      >
        📎 Allega il documento
      </button>
      {documenti.file.length > 0 && (
        <ul className="tk-allegati-elenco">
          {documenti.file.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span>{f.name}</span>
              <span className="muted">{pesoLeggibile(f.size)}</span>
              <button
                type="button"
                className="tk-togli"
                onClick={() => documenti.togli(i)}
                disabled={disabilitato}
                aria-label={`Togli ${f.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {documenti.errore && <p className="error-banner">{documenti.errore}</p>}
    </div>
  )
}
