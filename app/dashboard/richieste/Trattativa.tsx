'use client'

import { useState, useTransition } from 'react'
import {
  CLASSE_STATO,
  ETICHETTE_STATO,
  OPZIONI_STATO,
  eChiusa,
  puoAssegnare,
  type StatoTrattativa,
} from '@/lib/pipeline'
import { assegnaTrattativa, cambiaStato, prendiInCarico } from './trattativa-actions'

export type DatiTrattativa = {
  id: string
  stato: StatoTrattativa
  assegnato_a: string | null
  motivo_perso: string | null
}

// Il blocco trattativa che compare sulla riga di una richiesta Club/Family.
// La trattativa è della persona: se ha scritto tre volte, le tre righe
// mostrano la stessa e agire su una vale per tutte — è il punto del modello.
export function Trattativa({
  t,
  io,
  sonoCommerciale,
  possoRiassegnare,
  commerciali,
}: {
  t: DatiTrattativa
  io: string | null
  sonoCommerciale: boolean
  possoRiassegnare: boolean
  commerciali: string[]
}) {
  const [errore, setErrore] = useState<string | null>(null)
  const [chiedoMotivo, setChiedoMotivo] = useState(false)
  const [motivo, setMotivo] = useState(t.motivo_perso ?? '')
  const [inCorso, startTransition] = useTransition()

  const modificabile = puoAssegnare({
    assegnatoA: t.assegnato_a,
    io,
    sonoCommerciale,
    possoRiassegnare,
  })

  function esegui(azione: () => Promise<{ ok: true } | { ok: false; errore: string }>) {
    setErrore(null)
    startTransition(async () => {
      const esito = await azione()
      if (!esito.ok) setErrore(esito.errore)
      else setChiedoMotivo(false)
    })
  }

  return (
    <div className="trattativa">
      <span className={`badge ${CLASSE_STATO[t.stato]}`}>{ETICHETTE_STATO[t.stato]}</span>

      <span className="trattativa-chi muted">
        {t.assegnato_a
          ? t.assegnato_a === io
            ? 'la segui tu'
            : `la segue ${t.assegnato_a}`
          : 'nessun assegnatario'}
      </span>

      {!t.assegnato_a && sonoCommerciale && (
        <button
          type="button"
          className="btn btn-sm"
          disabled={inCorso}
          onClick={() => esegui(() => prendiInCarico(t.id))}
        >
          Prendi in carico
        </button>
      )}

      {modificabile && (
        <>
          {/* L'elenco contiene solo i commerciali: assegnare a un
              responsabile di corso vorrebbe dire metterlo in una lista che
              non guarda mai. */}
          <select
            className="trattativa-select"
            value={t.assegnato_a ?? ''}
            disabled={inCorso}
            onChange={(e) => esegui(() => assegnaTrattativa(t.id, e.target.value || null))}
            aria-label="Assegnata a"
          >
            <option value="">— nessuno —</option>
            {commerciali.map((c) => (
              <option key={c} value={c}>
                {c === io ? `${c} (tu)` : c}
              </option>
            ))}
          </select>

          <select
            className="trattativa-select"
            value={t.stato}
            disabled={inCorso}
            onChange={(e) => {
              const nuovo = e.target.value as StatoTrattativa
              // Una trattativa persa senza motivo non insegna niente al
              // prossimo che la guarda: si chiede prima di chiudere.
              if (nuovo === 'perso') setChiedoMotivo(true)
              else esegui(() => cambiaStato(t.id, nuovo))
            }}
            aria-label="Stato"
          >
            {OPZIONI_STATO.map((o) => (
              <option key={o.valore} value={o.valore}>
                {o.etichetta}
              </option>
            ))}
          </select>
        </>
      )}

      {chiedoMotivo && (
        <span className="trattativa-motivo">
          <input
            type="text"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Perché è andata persa?"
            autoFocus
          />
          <button
            type="button"
            className="btn btn-sm"
            disabled={inCorso}
            onClick={() => esegui(() => cambiaStato(t.id, 'perso', motivo))}
          >
            Segna persa
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChiedoMotivo(false)}>
            Annulla
          </button>
        </span>
      )}

      {t.stato === 'perso' && t.motivo_perso && !chiedoMotivo && (
        <span className="trattativa-chi muted">motivo: {t.motivo_perso}</span>
      )}

      {eChiusa(t.stato) && !modificabile && (
        <span className="trattativa-chi muted">chiusa</span>
      )}

      {errore && (
        <span className="field-hint" style={{ color: 'var(--error)', flexBasis: '100%' }}>
          {errore}
        </span>
      )}
    </div>
  )
}
