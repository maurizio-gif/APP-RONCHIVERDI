'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { SEZIONI } from '@/lib/auth/sezioni'
import {
  ACCEPT_ALLEGATO,
  DIMENSIONE_MASSIMA_ALLEGATO,
  ERRORE_DIMENSIONE_ALLEGATO,
  ERRORE_TIPO_ALLEGATO,
  TIPI_ALLEGATO_CONSENTITI,
  pesoLeggibile,
} from '@/lib/allegati'
import { LINK_PREDEFINITO, LUNGHEZZA_MASSIMA_MESSAGGIO } from '@/lib/notifiche'
import { inviaNotifica } from './actions'

// Le sezioni su cui la push può atterrare: le stesse validate lato server
// (vedi LINK_VALIDI in actions.ts).
const SEZIONI_LINK = SEZIONI.filter(
  (s) => !s.inArrivo && !s.esterna && s.href !== LINK_PREDEFINITO
)

export type Destinatario = { email: string; nome: string }

export function ComponiNotifica({ destinatari }: { destinatari: Destinatario[] }) {
  const [scelti, setScelti] = useState<string[]>([])
  const [messaggio, setMessaggio] = useState('')
  const [link, setLink] = useState(LINK_PREDEFINITO)
  const [allegato, setAllegato] = useState<File | null>(null)
  const [esito, setEsito] = useState<{ tipo: 'ok' | 'errore'; testo: string } | null>(null)
  const [menuAperto, setMenuAperto] = useState(false)
  const [inCorso, startTransition] = useTransition()
  const campoFile = useRef<HTMLInputElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  // Un menu a tendina che non si chiude cliccando altrove resta aperto sopra
  // il resto del modulo mentre si scrive.
  useEffect(() => {
    if (!menuAperto) return
    function fuori(e: MouseEvent) {
      if (menu.current && !menu.current.contains(e.target as Node)) setMenuAperto(false)
    }
    document.addEventListener('mousedown', fuori)
    return () => document.removeEventListener('mousedown', fuori)
  }, [menuAperto])

  function alterna(email: string) {
    setScelti((p) => (p.includes(email) ? p.filter((e) => e !== email) : [...p, email]))
  }

  function togliAllegato() {
    setAllegato(null)
    if (campoFile.current) campoFile.current.value = ''
  }

  // Gli stessi controlli del server (tipo, dimensione): qui solo per dare
  // l'errore subito, la validazione che conta resta lato server.
  function scegliFile(file: File | null) {
    if (file && !TIPI_ALLEGATO_CONSENTITI[file.type]) {
      setEsito({ tipo: 'errore', testo: ERRORE_TIPO_ALLEGATO })
      togliAllegato()
      return
    }
    if (file && file.size > DIMENSIONE_MASSIMA_ALLEGATO) {
      setEsito({ tipo: 'errore', testo: ERRORE_DIMENSIONE_ALLEGATO })
      togliAllegato()
      return
    }
    setEsito(null)
    setAllegato(file)
  }

  function invia() {
    // Una conferma con i nomi scritti per esteso: un messaggio interno fa
    // scattare una notifica sul telefono di ognuno, e mandarlo alla persona
    // sbagliata non si annulla.
    const nomi = destinatari.filter((d) => scelti.includes(d.email)).map((d) => d.nome)
    if (!confirm(`Invia questo messaggio a ${nomi.join(', ')}?\n\n"${messaggio.trim()}"`)) return

    setEsito(null)
    const dati = new FormData()
    scelti.forEach((email) => dati.append('destinatari', email))
    dati.append('messaggio', messaggio)
    dati.append('link', link)
    if (allegato) dati.append('allegato', allegato)

    startTransition(async () => {
      const risultato = await inviaNotifica(dati)
      if (!risultato.ok) {
        setEsito({ tipo: 'errore', testo: risultato.errore })
        return
      }
      setEsito({
        tipo: 'ok',
        testo: `Messaggio inviato a ${scelti.length === 1 ? 'una persona' : `${scelti.length} persone`}.`,
      })
      setScelti([])
      setMessaggio('')
      setLink(LINK_PREDEFINITO)
      togliAllegato()
    })
  }

  const nessunDestinatario = destinatari.length === 0

  return (
    <div className="card componi">
      <h2 className="componi-titolo">Nuovo messaggio</h2>

      {esito && <p className={esito.tipo === 'ok' ? 'ok-banner' : 'error-banner'}>{esito.testo}</p>}

      {/* Tendina con caselle invece di un elenco sempre aperto: i destinatari
          possibili sono tutta la segreteria, e una lista lunga spingerebbe il
          campo del testo fuori dallo schermo. */}
      <div className="destinatari" ref={menu}>
        <button
          type="button"
          className="destinatari-scelta"
          aria-haspopup="listbox"
          aria-expanded={menuAperto}
          disabled={inCorso || nessunDestinatario}
          onClick={() => setMenuAperto((a) => !a)}
        >
          <span>
            {nessunDestinatario
              ? 'Nessun altro operatore può ricevere messaggi'
              : scelti.length === 0
                ? 'Scegli i destinatari…'
                : `${scelti.length} ${scelti.length === 1 ? 'destinatario' : 'destinatari'}`}
          </span>
          <span className="destinatari-freccia" aria-hidden="true">
            {menuAperto ? '▲' : '▼'}
          </span>
        </button>

        {menuAperto && !nessunDestinatario && (
          <ul className="destinatari-menu" role="listbox" aria-multiselectable="true">
            {destinatari.map((d) => {
              const attivo = scelti.includes(d.email)
              return (
                <li key={d.email}>
                  <label className={`destinatari-opzione${attivo ? ' is-attiva' : ''}`}>
                    <input
                      type="checkbox"
                      checked={attivo}
                      disabled={inCorso}
                      onChange={() => alterna(d.email)}
                    />
                    {d.nome}
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {scelti.length > 0 && (
        <div className="destinatari-tag-lista">
          {destinatari
            .filter((d) => scelti.includes(d.email))
            .map((d) => (
              <span key={d.email} className="destinatari-tag">
                {d.nome}
                <button
                  type="button"
                  disabled={inCorso}
                  onClick={() => alterna(d.email)}
                  aria-label={`Togli ${d.nome} dai destinatari`}
                >
                  ×
                </button>
              </span>
            ))}
        </div>
      )}

      <div className="field">
        <label htmlFor="messaggio-interno">Messaggio</label>
        <textarea
          id="messaggio-interno"
          rows={3}
          value={messaggio}
          maxLength={LUNGHEZZA_MASSIMA_MESSAGGIO}
          disabled={inCorso}
          onChange={(e) => setMessaggio(e.target.value)}
          placeholder="Scrivi il messaggio…"
        />
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="messaggio-link">Apri su</label>
          <select
            id="messaggio-link"
            value={link}
            disabled={inCorso}
            onChange={(e) => setLink(e.target.value)}
          >
            <option value={LINK_PREDEFINITO}>Messaggi interni (predefinito)</option>
            {SEZIONI_LINK.map((s) => (
              <option key={s.chiave} value={s.href}>
                {s.label}
              </option>
            ))}
          </select>
          <p className="field-hint">Dove porta la notifica quando la si tocca sul telefono.</p>
        </div>

        <div className="field">
          <label htmlFor="messaggio-allegato">Allegato</label>
          <input
            id="messaggio-allegato"
            ref={campoFile}
            type="file"
            accept={ACCEPT_ALLEGATO}
            disabled={inCorso}
            onChange={(e) => scegliFile(e.target.files?.[0] ?? null)}
          />
          {allegato ? (
            <p className="field-hint">
              {allegato.name} · {pesoLeggibile(allegato.size)}{' '}
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={inCorso}
                onClick={togliAllegato}
              >
                Togli
              </button>
            </p>
          ) : (
            <p className="field-hint">Facoltativo: JPG, PNG, PDF, Word o Excel, fino a 5 MB.</p>
          )}
        </div>
      </div>

      <button
        type="button"
        className="btn btn-sm"
        disabled={inCorso || !messaggio.trim() || scelti.length === 0}
        onClick={invia}
      >
        {inCorso ? 'Invio…' : 'Invia'}
      </button>
    </div>
  )
}
