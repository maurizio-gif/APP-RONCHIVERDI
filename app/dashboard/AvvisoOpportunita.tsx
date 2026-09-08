'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { prendiInCarico } from './richieste/trattativa-actions'
import { useAvvisoSonoro } from './useAvvisoSonoro'
import type { OpportunitaLibera } from './opportunita-actions'

// Una trattativa senza titolare va addosso a chi può prendersela: la richiesta
// arrivata alle 15 crea una trattativa libera, e finché qualcuno non riapre il
// Riepilogo nessuno se ne accorge. Il numero in dashboard c'era già; quello
// che mancava era che si facesse sentire.
//
// Solo per i commerciali: prendere in carico richiede il diritto commerciale
// (vedi puoAssegnare in lib/pipeline.ts), e suonare a chi non può agire
// sarebbe rumore e nient'altro. Il filtro è lato server, in
// puoRicevereAvvisoOpportunita.
//
// Non è bloccante, al contrario dell'avviso dei messaggi interni: quello è una
// comunicazione da confermare, questo è un'occasione da cogliere — e chi è al
// telefono con un socio non deve trovarsi la pagina murata.

const INTERVALLO_MS = 20000

export function AvvisoOpportunita({ abilitato }: { abilitato: boolean }) {
  const [coda, setCoda] = useState<OpportunitaLibera[]>([])
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()
  const { attivo: suonoAttivo, cambia: cambiaSuono, avvisa, provaSuono } = useAvvisoSonoro()

  // Gli id già visti in questa sessione del browser. Il primo giro stabilisce
  // il punto di partenza **in silenzio**: senza, aprire il pannello con sei
  // trattative libere da ieri suonerebbe come se fossero appena arrivate — e
  // un avviso che urla per cose vecchie è il modo più rapido di farlo
  // spegnere per sempre.
  const conosciute = useRef<Set<string> | null>(null)

  const aggiorna = useCallback(async () => {
    try {
      const risposta = await fetch('/api/interno/opportunita/libere', { cache: 'no-store' })
      if (!risposta.ok) return
      const dati = (await risposta.json()) as { opportunita: OpportunitaLibera[] }
      const libere = dati.opportunita ?? []

      if (conosciute.current === null) {
        conosciute.current = new Set(libere.map((o) => o.id))
        return
      }

      const nuove = libere.filter((o) => !conosciute.current!.has(o.id))
      // Anche quelle già viste vanno tenute a mente: una trattativa presa in
      // carico e poi liberata di nuovo è una novità legittima, e deve poter
      // suonare una seconda volta.
      conosciute.current = new Set(libere.map((o) => o.id))

      if (nuove.length > 0) {
        setCoda((precedenti) => {
          const giaInCoda = new Set(precedenti.map((o) => o.id))
          return [...precedenti, ...nuove.filter((o) => !giaInCoda.has(o.id))]
        })
        avvisa()
      }
    } catch {
      // Silenzio: al giro dopo l'elenco è comunque quello giusto.
    }
  }, [avvisa])

  useEffect(() => {
    if (!abilitato) return
    aggiorna()
    const timer = setInterval(aggiorna, INTERVALLO_MS)
    return () => clearInterval(timer)
  }, [abilitato, aggiorna])

  const corrente = coda[0]

  function chiudi() {
    setErrore(null)
    setCoda((c) => c.slice(1))
  }

  function prendi() {
    if (!corrente) return
    setErrore(null)
    startTransition(async () => {
      const esito = await prendiInCarico(corrente.id)
      if (esito.ok) chiudi()
      else setErrore(esito.errore)
    })
  }

  if (!abilitato || !corrente) return null

  return (
    <div className="avviso-opportunita" role="alert">
      <div className="avviso-testa">
        <p className="eyebrow">
          Nuova trattativa da prendere in carico
          {coda.length > 1 && <span className="avviso-coda">+{coda.length - 1} in attesa</span>}
        </p>
        <button type="button" className="avviso-chiudi" aria-label="Chiudi l'avviso" onClick={chiudi}>
          ×
        </button>
      </div>

      <p className="avviso-nome">{corrente.nome}</p>

      <p className="muted avviso-recapiti">
        {[corrente.attivita, corrente.email, corrente.cellulare].filter(Boolean).join(' · ')}
      </p>

      {corrente.messaggio && <p className="avviso-messaggio">{corrente.messaggio}</p>}

      {errore && <p className="error-banner">{errore}</p>}

      <div className="avviso-azioni">
        <button type="button" className="btn btn-sm" disabled={inCorso} onClick={prendi}>
          {inCorso ? 'Un attimo…' : 'Prendi in carico'}
        </button>
        <Link
          className="btn btn-ghost btn-sm"
          href={`/dashboard/persone/${corrente.personaId}`}
          onClick={chiudi}
        >
          Apri la scheda
        </Link>
      </div>

      {/* L'interruttore sta qui e non nelle impostazioni: chi vuole zittire il
          suono lo vuole zittire nel momento in cui gli ha dato fastidio, non
          dopo aver cercato dove si fa. */}
      <div className="avviso-suono">
        <label>
          <input
            type="checkbox"
            checked={suonoAttivo}
            onChange={(e) => cambiaSuono(e.target.checked)}
          />
          Avviso sonoro su questo browser
        </label>
        {suonoAttivo && (
          <button type="button" className="btn-prova-suono" onClick={provaSuono}>
            prova
          </button>
        )}
      </div>
    </div>
  )
}
