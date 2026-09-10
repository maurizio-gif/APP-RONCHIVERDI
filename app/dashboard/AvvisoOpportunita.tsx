'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { prendiInCarico } from './richieste/trattativa-actions'
import { useAvvisoSonoro } from './useAvvisoSonoro'
import type { AvvisoLavoro } from './opportunita-actions'

// Il lavoro appena arrivato va addosso a chi lo deve fare: la richiesta delle
// 15 resta lì, e finché qualcuno non riapre la propria sezione nessuno se ne
// accorge. I numeri in dashboard c'erano già; quello che mancava era che si
// facessero sentire.
//
// Ognuno riceve gli avvisi delle **proprie sezioni**, quelle sul suo profilo
// utente: chi ha il solo nuoto sente il nuoto, chi ha tutto sente tutto. Il
// filtro è lato server, in getAvvisiLavoro — qui non arriva niente che chi
// guarda non possa aprire.
//
// Due generi con due gesti diversi (vedi opportunita-actions.ts): una
// trattativa libera si **prende in carico** da qui, una richiesta di un corso
// si **apre nella sua sezione** — là non ci sono trattative da assegnare, c'è
// una telefonata da fare.
//
// Non è bloccante, al contrario dell'avviso dei messaggi interni: quello è una
// comunicazione da confermare, questo è un'occasione da cogliere — e chi è al
// telefono con un socio non deve trovarsi la pagina murata.

const INTERVALLO_MS = 20000

export function AvvisoOpportunita({ abilitato }: { abilitato: boolean }) {
  const [coda, setCoda] = useState<AvvisoLavoro[]>([])
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
      const dati = (await risposta.json()) as { avvisi: AvvisoLavoro[] }
      const aperti = dati.avvisi ?? []

      // Sulla chiave e non sull'id: mescolando trattative e richieste due
      // righe di tabelle diverse possono avere lo stesso id, e una
      // riconosciuta al posto dell'altra farebbe sparire un avviso vero.
      if (conosciute.current === null) {
        conosciute.current = new Set(aperti.map((o) => o.chiave))
        return
      }

      const nuove = aperti.filter((o) => !conosciute.current!.has(o.chiave))
      // Anche quelle già viste vanno tenute a mente: una trattativa presa in
      // carico e poi liberata di nuovo è una novità legittima, e deve poter
      // suonare una seconda volta.
      conosciute.current = new Set(aperti.map((o) => o.chiave))

      if (nuove.length > 0) {
        setCoda((precedenti) => {
          const giaInCoda = new Set(precedenti.map((o) => o.chiave))
          return [...precedenti, ...nuove.filter((o) => !giaInCoda.has(o.chiave))]
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
    if (!corrente || corrente.genere !== 'trattativa') return
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
          {corrente.genere === 'trattativa'
            ? 'Nuova trattativa da prendere in carico'
            : 'Nuova richiesta da gestire'}
          {coda.length > 1 && <span className="avviso-coda">+{coda.length - 1} in attesa</span>}
        </p>
        <button type="button" className="avviso-chiudi" aria-label="Chiudi l'avviso" onClick={chiudi}>
          ×
        </button>
      </div>

      <p className="avviso-nome">{corrente.nome}</p>

      {/* Di quale sezione è. Chi ne ha nove attive riceve avvisi di nove
          origini: senza dirlo, un nome in un riquadro non dice se chiama per
          il nuoto o per l'abbonamento — e sono due telefonate diverse. */}
      <p className="avviso-sezione">{corrente.sezione}</p>

      <p className="muted avviso-recapiti">
        {[corrente.attivita, corrente.email, corrente.cellulare].filter(Boolean).join(' · ')}
      </p>

      {corrente.messaggio && <p className="avviso-messaggio">{corrente.messaggio}</p>}

      {errore && <p className="error-banner">{errore}</p>}

      <div className="avviso-azioni">
        {/* «Prendi in carico» solo sulle trattative: sugli altri canali non
            c'è niente da assegnare — il responsabile è uno, ed è chi sta
            leggendo. Là il gesto è aprire la sezione e chiamare. */}
        {corrente.genere === 'trattativa' ? (
          <>
            <button type="button" className="btn btn-sm" disabled={inCorso} onClick={prendi}>
              {inCorso ? 'Un attimo…' : 'Prendi in carico'}
            </button>
            {corrente.personaId && (
              <Link
                className="btn btn-ghost btn-sm"
                href={`/dashboard/persone/${corrente.personaId}`}
                onClick={chiudi}
              >
                Apri la scheda
              </Link>
            )}
          </>
        ) : (
          <>
            <Link className="btn btn-sm" href={corrente.href} onClick={chiudi}>
              Apri la richiesta
            </Link>
            {corrente.personaId && (
              <Link
                className="btn btn-ghost btn-sm"
                href={`/dashboard/persone/${corrente.personaId}`}
                onClick={chiudi}
              >
                Apri la scheda
              </Link>
            )}
          </>
        )}
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
