'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/browserClient'
import { pesoLeggibile } from '@/lib/ticket'
import { BUCKET_FOTO, MASSIMO_FOTO, erroreFoto } from '@/lib/segnalazioni'
import { preparaFoto, type FotoCaricata } from './actions'

// Le foto di una segnalazione, o di un passo della sua gestione: si scattano
// col telefono o si prendono dalla galleria, si controllano subito (tipo e
// peso) e si caricano solo all'invio, direttamente dal browser su Supabase con
// gli URL firmati che rilascia il server (vedi preparaFoto).

export function useFoto() {
  const [file, setFile] = useState<File[]>([])
  const [errore, setErrore] = useState<string | null>(null)

  function aggiungi(nuovi: FileList | null) {
    if (!nuovi || !nuovi.length) return
    setErrore(null)
    const tutti = [...file, ...Array.from(nuovi)]
    if (tutti.length > MASSIMO_FOTO) {
      setErrore(`Al massimo ${MASSIMO_FOTO} foto.`)
      return
    }
    for (const f of nuovi) {
      const e = erroreFoto({ nome: f.name, tipo: f.type, byte: f.size })
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

  // Carica tutto e restituisce cosa registrare; lancia con un messaggio
  // leggibile se qualcosa va storto.
  async function carica(): Promise<FotoCaricata[]> {
    if (!file.length) return []
    const preparate = await preparaFoto(file.map((f) => ({ nome: f.name, tipo: f.type, byte: f.size })))
    if (!preparate.ok) throw new Error(preparate.errore)
    const supabase = createSupabaseBrowserClient()
    const caricate: FotoCaricata[] = []
    for (let i = 0; i < file.length; i++) {
      const f = file[i]
      const c = preparate.caricamenti[i]
      const { error } = await supabase.storage
        .from(BUCKET_FOTO)
        .uploadToSignedUrl(c.percorso, c.token, f, { contentType: c.tipo })
      if (error) throw new Error(`«${f.name}» non è stata caricata: ${error.message}`)
      caricate.push({ percorso: c.percorso, nome: f.name, tipo: c.tipo, byte: f.size })
    }
    return caricate
  }

  return { file, errore, aggiungi, togli, carica, svuota: () => setFile([]) }
}

export function SceltaFoto({ foto, disabilitato }: { foto: ReturnType<typeof useFoto>; disabilitato?: boolean }) {
  const fotocamera = useRef<HTMLInputElement>(null)
  const galleria = useRef<HTMLInputElement>(null)
  const piene = foto.file.length >= MASSIMO_FOTO

  // Le anteprime sono indirizzi locali del browser: si liberano quando la
  // foto esce dall'elenco o il componente si smonta.
  const anteprime = useMemo(
    () => foto.file.map((f) => (f.type.startsWith('image/') && !/hei[cf]/.test(f.type) ? URL.createObjectURL(f) : null)),
    [foto.file]
  )
  useEffect(() => () => anteprime.forEach((u) => u && URL.revokeObjectURL(u)), [anteprime])

  const scelta = (e: React.ChangeEvent<HTMLInputElement>) => {
    foto.aggiungi(e.target.files)
    e.target.value = ''
  }

  return (
    <div className="sg-foto">
      {/* capture="environment": sul telefono apre direttamente la fotocamera
          posteriore; sul computer è una normale scelta di file. */}
      <input ref={fotocamera} type="file" accept="image/*" capture="environment" hidden onChange={scelta} />
      <input ref={galleria} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={scelta} />
      <div className="tk-bottoni">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => fotocamera.current?.click()}
          disabled={disabilitato || piene}
        >
          📷 Scatta una foto
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => galleria.current?.click()}
          disabled={disabilitato || piene}
        >
          🖼 Carica dalla galleria
        </button>
        <span className="muted tk-allegati-nota">Fino a {MASSIMO_FOTO} foto · 10 MB l’una</span>
      </div>
      {foto.file.length > 0 && (
        <ul className="sg-foto-elenco">
          {foto.file.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              {anteprime[i] ? <img src={anteprime[i]!} alt={f.name} /> : <span className="sg-foto-icona">FOTO</span>}
              <span className="muted">{pesoLeggibile(f.size)}</span>
              <button type="button" className="tk-togli" onClick={() => foto.togli(i)} aria-label={`Togli ${f.name}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {foto.errore && <p className="error-banner">{foto.errore}</p>}
    </div>
  )
}
