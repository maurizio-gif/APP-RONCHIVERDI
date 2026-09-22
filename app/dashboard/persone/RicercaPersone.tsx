'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ETICHETTA_MANUALE,
  dataBreve,
  eInseritoAMano,
  inizialiPersona,
  nomePersona,
  testoRicerca,
  type Persona,
} from '@/lib/persone'
import { cercaPersone } from './actions'

/** Quanto aspettare dopo l'ultimo tasto prima di interrogare il server. */
const RITARDO_RICERCA_MS = 300

/**
 * Sotto due caratteri si filtra solo l'elenco già caricato (l'attività
 * recente): una ricerca sul database intero per ogni singola lettera
 * sarebbe solo carico senza un risultato più utile — con una sola lettera i
 * risultati sarebbero comunque troppi per starci nel limite della funzione.
 */
const MIN_CARATTERI_RICERCA_SERVER = 2

// Due ricerche, non una: l'elenco caricato in pagina (attività recente, le
// persone con richieste più di recente) resta filtrato in memoria mentre si
// digita, senza un giro di rete per lettera — ma è solo un sottoinsieme
// (vedi PersonePage), e chi non ha mai scritto dal sito — tutti i contatti
// importati da Info4U — lì semplicemente non c'è. Da due caratteri in su la
// ricerca passa al server (cercaPersone), che interroga l'anagrafica intera:
// è l'unico modo di trovare chi non è fra le righe già caricate.
export function RicercaPersone({
  persone,
  idInGestione,
}: {
  persone: Persona[]
  /** Chi ha una trattativa in gestione, su tutta l'anagrafica (vedi PersonePage). */
  idInGestione: string[]
}) {
  const [q, setQ] = useState('')
  const [soloDaLavorare, setSoloDaLavorare] = useState(false)
  const [soloInGestione, setSoloInGestione] = useState(false)
  const inGestione = useMemo(() => new Set(idInGestione), [idInGestione])
  const [risultatiServer, setRisultatiServer] = useState<Persona[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()
  // Scarta la risposta di una ricerca superata da una più recente: senza,
  // digitare in fretta potrebbe far comparire i risultati di "mar" dopo
  // quelli di "mario", se la prima richiesta torna per ultima.
  const ultimaRichiesta = useRef(0)

  const indice = useMemo(() => persone.map((p) => ({ p, testo: testoRicerca(p) })), [persone])

  const inRicercaServer = q.trim().length >= MIN_CARATTERI_RICERCA_SERVER

  useEffect(() => {
    const termine = q.trim()
    if (termine.length < MIN_CARATTERI_RICERCA_SERVER) {
      setRisultatiServer(null)
      setErrore(null)
      return
    }

    const idRichiesta = ++ultimaRichiesta.current
    const timer = setTimeout(() => {
      startTransition(async () => {
        const esito = await cercaPersone(termine)
        if (idRichiesta !== ultimaRichiesta.current) return
        if (esito.ok) {
          setRisultatiServer(esito.persone)
          setErrore(null)
        } else {
          setErrore(esito.errore)
        }
      })
    }, RITARDO_RICERCA_MS)
    return () => clearTimeout(timer)
  }, [q])

  const filtrateLocali = useMemo(() => {
    const termini = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return indice
      .filter(({ p, testo }) => {
        if (soloDaLavorare && !p.richieste_da_lavorare) return false
        if (soloInGestione && !inGestione.has(p.id)) return false
        // Tutti i termini devono comparire, in qualunque ordine: "rossi
        // mario" e "mario rossi" devono trovare la stessa persona.
        return termini.every((t) => testo.includes(t))
      })
      .map(({ p }) => p)
  }, [indice, q, soloDaLavorare, soloInGestione, inGestione])

  const filtrate = inRicercaServer
    ? (risultatiServer ?? []).filter(
        (p) =>
          (!soloDaLavorare || p.richieste_da_lavorare > 0) && (!soloInGestione || inGestione.has(p.id))
      )
    : filtrateLocali

  return (
    <>
      <div className="card">
        <div className="form-row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0, flexBasis: '60%' }}>
            <label htmlFor="cerca">Cerca</label>
            <input
              id="cerca"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nome, cognome, email o cellulare"
              autoComplete="off"
            />
            {inRicercaServer && (
              <p className="field-hint">
                {inCorso ? 'Cerco su tutta l’anagrafica…' : 'Risultati su tutta l’anagrafica, storico incluso.'}
              </p>
            )}
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="check-riga" style={{ marginTop: '0.5rem' }}>
              <input
                type="checkbox"
                checked={soloDaLavorare}
                onChange={(e) => setSoloDaLavorare(e.target.checked)}
              />
              <span>Solo con richieste da lavorare</span>
            </label>
            <label className="check-riga" style={{ marginTop: '0.5rem' }}>
              <input
                type="checkbox"
                checked={soloInGestione}
                onChange={(e) => setSoloInGestione(e.target.checked)}
              />
              <span>Solo con trattative in gestione</span>
            </label>
          </div>
        </div>
        {errore && <p className="error-banner">{errore}</p>}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Anagrafica</h2>
          <span className="muted">
            {inRicercaServer
              ? `${filtrate.length} ${filtrate.length === 1 ? 'risultato' : 'risultati'}`
              : filtrate.length === persone.length
                ? `${persone.length} ${persone.length === 1 ? 'persona' : 'persone'} · attività recente`
                : `${filtrate.length} di ${persone.length} · attività recente`}
          </span>
        </div>

        {filtrate.length === 0 ? (
          <p className="vuoto">
            {inRicercaServer
              ? inCorso
                ? 'Cerco…'
                : 'Nessuna persona corrisponde alla ricerca, in tutta l’anagrafica.'
              : persone.length === 0
                ? 'Nessuna persona in anagrafica: si popola da sé con le richieste dal sito, o a mano dall’agenda.'
                : 'Nessuna persona corrisponde alla ricerca.'}
          </p>
        ) : (
          <ul className="persone">
            {filtrate.map((p) => (
              <li key={p.id}>
                <Link href={`/dashboard/persone/${p.id}`} className="persona-riga">
                  <span className="user-badge" aria-hidden="true">
                    {inizialiPersona(p)}
                  </span>
                  <span className="persona-corpo">
                    <span className="persona-nome">
                      {nomePersona(p)}
                      {p.richieste_da_lavorare > 0 && (
                        <span className="badge badge-warn" style={{ marginLeft: '0.5rem' }}>
                          {p.richieste_da_lavorare} da lavorare
                        </span>
                      )}
                      {inGestione.has(p.id) && (
                        <span className="badge badge-info" style={{ marginLeft: '0.5rem' }}>
                          In gestione
                        </span>
                      )}
                      {/* Inserito a mano dalla segreteria: è la riga con zero
                          richieste e nessuna «ultima», che in un elenco che
                          si popola dalle richieste del sito sembrerebbe
                          rotta. */}
                      {eInseritoAMano(p.fonte) && (
                        <span className="tag" style={{ marginLeft: '0.5rem' }}>
                          {ETICHETTA_MANUALE}
                        </span>
                      )}
                    </span>
                    <span className="persona-meta muted">
                      {[p.email, p.cellulare].filter(Boolean).join(' · ') || 'nessun contatto'}
                    </span>
                  </span>
                  <span className="persona-numeri muted">
                    {p.richieste} {p.richieste === 1 ? 'richiesta' : 'richieste'}
                    <br />
                    ultima: {dataBreve(p.ultima_richiesta)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
