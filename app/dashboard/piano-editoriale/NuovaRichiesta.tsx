'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browserClient'
import { CampoNote } from '@/components/CampoNote'
import {
  ACCEPT_FILE_PIANO,
  BUCKET_PIANO,
  LUNGHEZZA_MASSIMA_DESCRIZIONE,
  MASSIMO_FILE_PIANO,
  ORE_PER_TIPO,
  PREAVVISO_GIORNI,
  TIPI,
  erroreFilePiano,
  inPreavviso,
  pesoLeggibile,
  primaDataConPreavviso,
  type TipoVoce,
} from '@/lib/piano-editoriale'
import { creaRichiesta, preparaFilePiano, type FileCaricato } from './actions'

// Il modulo per chiedere un contenuto. Il preavviso di 14 giorni si vede
// mentre si sceglie la data: con meno, compare il campo «motivo dell'urgenza»
// e la richiesta arriva a Giada segnata come urgente (decide lei).

function formatoIt(iso: string): string {
  return iso.split('-').reverse().join('/')
}

export function NuovaRichiesta({
  oggi,
  dataIniziale,
  gestisce,
  reparti,
}: {
  oggi: string
  dataIniziale: string
  gestisce: boolean
  reparti: string[]
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [aperto, setAperto] = useState(false)
  const [data, setData] = useState(dataIniziale)
  const [tipo, setTipo] = useState<TipoVoce>('post')
  const [titolo, setTitolo] = useState('')
  const [reparto, setReparto] = useState('')
  const [descrizione, setDescrizione] = useState('')
  const [link, setLink] = useState('')
  const [motivo, setMotivo] = useState('')
  const [file, setFile] = useState<File[]>([])
  const [errore, setErrore] = useState<string | null>(null)
  const [esito, setEsito] = useState<string | null>(null)
  const [inCorso, setInCorso] = useState(false)

  const urgente = !!data && data >= oggi && !inPreavviso(data, oggi)
  const primaData = primaDataConPreavviso(oggi)

  function aggiungiFile(nuovi: FileList | null) {
    if (!nuovi) return
    setErrore(null)
    const tutti = [...file, ...Array.from(nuovi)]
    if (tutti.length > MASSIMO_FILE_PIANO) {
      setErrore(`Al massimo ${MASSIMO_FILE_PIANO} file.`)
      return
    }
    for (const f of nuovi) {
      const e = erroreFilePiano({ nome: f.name, tipo: f.type, byte: f.size })
      if (e) {
        setErrore(e)
        return
      }
    }
    setFile(tutti)
  }

  // Carica i file direttamente su Supabase con gli URL firmati del server.
  async function caricaFile(): Promise<FileCaricato[]> {
    if (!file.length) return []
    const preparati = await preparaFilePiano(file.map((f) => ({ nome: f.name, tipo: f.type, byte: f.size })))
    if (!preparati.ok) throw new Error(preparati.errore)
    const supabase = createSupabaseBrowserClient()
    const caricati: FileCaricato[] = []
    for (let i = 0; i < file.length; i++) {
      const c = preparati.caricamenti[i]
      const { error } = await supabase.storage
        .from(BUCKET_PIANO)
        .uploadToSignedUrl(c.percorso, c.token, file[i], { contentType: c.tipo })
      if (error) throw new Error(`«${file[i].name}» non è stato caricato: ${error.message}`)
      caricati.push({ percorso: c.percorso, nome: file[i].name, tipo: c.tipo, byte: file[i].size })
    }
    return caricati
  }

  async function invia(e: React.FormEvent) {
    e.preventDefault()
    setErrore(null)
    setEsito(null)
    setInCorso(true)
    try {
      const allegati = await caricaFile()
      const r = await creaRichiesta({ data, tipo, titolo, descrizione, reparto, link, motivoUrgenza: motivo, allegati })
      if (!r.ok) {
        setErrore(r.errore)
        setInCorso(false)
        return
      }
      setEsito(
        r.urgente
          ? gestisce
            ? 'Voce inserita (fuori preavviso, già presa in carico).'
            : 'Richiesta inviata come urgente: Giada la valuta e ti risponde qui.'
          : 'Richiesta inviata: la trovi nel calendario.'
      )
      setTitolo('')
      setDescrizione('')
      setLink('')
      setMotivo('')
      setReparto('')
      setFile([])
      setInCorso(false)
      setAperto(false)
      router.refresh()
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'Qualcosa è andato storto. Riprova.')
      setInCorso(false)
    }
  }

  if (!aperto) {
    return (
      <div className="pe-nuova-chiusa">
        <button type="button" className="btn" onClick={() => setAperto(true)}>
          + Nuova richiesta
        </button>
        {esito && <span className="pe-esito">{esito}</span>}
      </div>
    )
  }

  return (
    <form className="card pe-form" onSubmit={invia}>
      <h2 className="pe-form-titolo">Nuova richiesta</h2>

      <div className="pe-riga">
        <div className="field">
          <label htmlFor="pe-data">Data di pubblicazione</label>
          <input id="pe-data" type="date" value={data} min={oggi} onChange={(e) => setData(e.target.value)} required />
          <span className="field-hint">
            Preavviso minimo {PREAVVISO_GIORNI} giorni: dal {formatoIt(primaData)} in poi.
          </span>
        </div>
        <div className="field">
          <label htmlFor="pe-tipo">Cosa serve</label>
          <select id="pe-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoVoce)}>
            {TIPI.map((t) => (
              <option key={t.chiave} value={t.chiave}>
                {t.testo}
              </option>
            ))}
          </select>
          <span className="field-hint">Circa {ORE_PER_TIPO[tipo]} {ORE_PER_TIPO[tipo] === 1 ? 'ora' : 'ore'} di lavoro per Giada.</span>
        </div>
      </div>

      {urgente && (
        <div className="pe-urgenza">
          <b>Meno di {PREAVVISO_GIORNI} giorni di preavviso.</b>{' '}
          {gestisce
            ? 'Sei tra chi gestisce il piano: la voce entra già presa in carico.'
            : 'Giada lavora 10 ore a settimana e può non farcela. La richiesta le arriva come urgente e decide lei: scrivi perché non si può spostare.'}
          {!gestisce && (
            <div className="field">
              <label htmlFor="pe-motivo">Motivo dell’urgenza</label>
              <CampoNote
                id="pe-motivo"
                rows={2}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={500}
                placeholder="es. L’evento è stato confermato solo ieri"
                required
              />
            </div>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor="pe-titolo">Titolo</label>
        <input
          id="pe-titolo"
          value={titolo}
          onChange={(e) => setTitolo(e.target.value)}
          maxLength={160}
          placeholder="es. Video che mostra la scuola nuoto"
          required
        />
      </div>

      <div className="field">
        <label htmlFor="pe-reparto">Reparto o corso</label>
        <input
          id="pe-reparto"
          value={reparto}
          onChange={(e) => setReparto(e.target.value)}
          maxLength={80}
          list="pe-reparti"
          placeholder="es. Scuola nuoto"
        />
        <datalist id="pe-reparti">
          {reparti.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </div>

      <div className="field">
        <label htmlFor="pe-descrizione">Descrizione</label>
        <CampoNote
          id="pe-descrizione"
          rows={5}
          value={descrizione}
          onChange={(e) => setDescrizione(e.target.value)}
          maxLength={LUNGHEZZA_MASSIMA_DESCRIZIONE}
          placeholder={
            'Cosa vuoi comunicare, per chi, con che tono. Se è un video: dove si gira, chi compare, quando c’è qualcuno da riprendere.'
          }
        />
      </div>

      <div className="field">
        <label htmlFor="pe-link">Link (facoltativo)</label>
        <input
          id="pe-link"
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          maxLength={500}
          placeholder="https://… (Drive, WeTransfer, un esempio da imitare)"
        />
      </div>

      <div className="tk-allegati">
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT_FILE_PIANO}
          hidden
          onChange={(e) => {
            aggiungiFile(e.target.files)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => input.current?.click()}
          disabled={inCorso || file.length >= MASSIMO_FILE_PIANO}
        >
          📎 Allega foto, video o documenti
        </button>
        <span className="muted tk-allegati-nota">
          Foto, video, PDF, Word · fino a 100 MB l’uno · massimo {MASSIMO_FILE_PIANO}
        </span>
        {file.length > 0 && (
          <ul className="tk-allegati-elenco">
            {file.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span>{f.name}</span>
                <span className="muted">{pesoLeggibile(f.size)}</span>
                <button
                  type="button"
                  className="tk-togli"
                  onClick={() => setFile((x) => x.filter((_, j) => j !== i))}
                  aria-label={`Togli ${f.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {errore && <p className="error-banner">{errore}</p>}

      <div className="tk-invia">
        <button type="submit" className="btn" disabled={inCorso}>
          {inCorso ? 'Invio in corso…' : 'Invia la richiesta'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setAperto(false)} disabled={inCorso}>
          Annulla
        </button>
      </div>
    </form>
  )
}
