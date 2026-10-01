'use client'

import { useState, useTransition } from 'react'
import type { Passo } from '@/lib/avanzamento'
import { aggiornaPasso } from './actions'

// Un passo della proposta: chi lo fa, se è fatto, le note sotto. «Aggiorna»
// apre una nota e i due gesti possibili — segnarlo fatto (la nota è
// facoltativa: «sì, fatto») o lasciare solo la nota («non ancora, perché…»).

export type PassoVista = {
  passo: Passo
  fatto: boolean
  /** "Simone Aggazio · 2 ott 2026, 10:14", o null se fatto alla data della situazione. */
  fattoDa: string | null
  situazioneAl: string
  inAttesaDi: string[]
  /** I nomi già pronti, calcolati dalla pagina. */
  responsabili: { nome: string; daNominare: boolean }[]
  con: string[]
  note: { id: number; chi: string; quando: string; tipo: string; testo: string | null }[]
  mio: boolean
  bloccatoDaTabella: boolean
}

const ETICHETTA_TIPO: Record<string, string> = {
  fatto: 'Segnato fatto',
  riaperto: 'Riaperto',
  nota: 'Nota',
}

export function PassoAvanzamento({ vista }: { vista: PassoVista }) {
  const { passo, fatto } = vista
  const [aperto, setAperto] = useState(false)
  const [testo, setTesto] = useState('')
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function invia(tipo: 'fatto' | 'riaperto' | 'nota') {
    setErrore(null)
    startTransition(async () => {
      const esito = await aggiornaPasso(passo.chiave, tipo, testo)
      if (!esito.ok) {
        setErrore(esito.errore)
        return
      }
      setTesto('')
      setAperto(false)
    })
  }

  const inAttesa = !fatto && vista.inAttesaDi.length > 0
  const classe = fatto ? 'is-fatto' : inAttesa ? 'is-attesa' : 'is-aperto'

  return (
    <li className={`av-passo ${classe}${vista.mio && !fatto ? ' is-mio' : ''}`}>
      <span className="av-spunta" aria-hidden="true">
        {fatto ? '✓' : ''}
      </span>
      <div className="av-passo-corpo">
        <div className="av-passo-testa">
          <span className="av-passo-titolo">{passo.titolo}</span>
          {fatto ? (
            <span className="badge badge-ok">Fatto</span>
          ) : inAttesa ? (
            <span className="badge badge-off">In attesa</span>
          ) : (
            <span className="badge badge-info">Da fare</span>
          )}
        </div>
        {passo.descrizione && <p className="av-passo-descrizione">{passo.descrizione}</p>}

        <p className="av-passo-chi">
          {vista.responsabili.map((r, i) => (
            <span key={i}>
              {i > 0 && ', '}
              <strong>{r.nome}</strong>
              {r.daNominare && <span className="tag tag-avviso av-tag-inline">da nominare</span>}
            </span>
          ))}
          {vista.con.length > 0 && <> · con {vista.con.join(', ')}</>}
        </p>

        <div className="tag-fila">
          {passo.bloccante && !fatto && <span className="tag tag-avviso">Bloccante</span>}
          {passo.consiglio && <span className="tag">Consiglio · non bloccante</span>}
          {vista.mio && !fatto && <span className="tag tag-canale">Tocca a te</span>}
          {inAttesa && <span className="tag">Dopo: {vista.inAttesaDi.join(' · ')}</span>}
          {fatto && (
            <span className="av-meta">
              {vista.fattoDa ? `Segnato da ${vista.fattoDa}` : `Fatto al ${vista.situazioneAl}`}
            </span>
          )}
        </div>

        {vista.note.length > 0 && (
          <ul className="av-note">
            {vista.note.map((n) => (
              <li key={n.id}>
                <span className="av-meta">
                  {ETICHETTA_TIPO[n.tipo] ?? n.tipo} · {n.chi} · {n.quando}
                </span>
                {n.testo && <span className="av-nota-testo">{n.testo}</span>}
              </li>
            ))}
          </ul>
        )}

        {vista.bloccatoDaTabella ? null : aperto ? (
          <div className="av-aggiorna">
            <textarea
              className="cand-nota"
              rows={2}
              value={testo}
              placeholder={fatto ? 'Perché va riaperto, o una nota.' : 'Sì, fatto — oppure: non ancora, perché…'}
              onChange={(e) => setTesto(e.target.value)}
            />
            <div className="cand-azioni">
              {fatto ? (
                <button type="button" className="btn btn-ghost btn-sm" disabled={inCorso} onClick={() => invia('riaperto')}>
                  Riapri
                </button>
              ) : (
                <button type="button" className="btn btn-sm" disabled={inCorso} onClick={() => invia('fatto')}>
                  Segna fatto
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={inCorso || !testo.trim()}
                onClick={() => invia('nota')}
              >
                Salva solo la nota
              </button>
              <button type="button" className="link-testo" onClick={() => setAperto(false)}>
                Annulla
              </button>
            </div>
            {errore && <p className="error-banner">{errore}</p>}
          </div>
        ) : (
          <button type="button" className="link-testo av-apri" onClick={() => setAperto(true)}>
            {fatto ? 'Aggiungi una nota o riapri' : 'Aggiorna'}
          </button>
        )}
      </div>
    </li>
  )
}
