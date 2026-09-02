'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { dataBreve, inizialiPersona, nomePersona, testoRicerca, type Persona } from '@/lib/persone'

// La ricerca filtra in memoria invece di rifare il giro sul server: l'elenco
// è di qualche centinaio di righe e si vuole che si stringa mentre si digita,
// senza un round-trip per lettera.
export function RicercaPersone({ persone }: { persone: Persona[] }) {
  const [q, setQ] = useState('')
  const [soloDaLavorare, setSoloDaLavorare] = useState(false)

  const indice = useMemo(
    () => persone.map((p) => ({ p, testo: testoRicerca(p) })),
    [persone]
  )

  const filtrate = useMemo(() => {
    const termini = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return indice
      .filter(({ p, testo }) => {
        if (soloDaLavorare && !p.richieste_da_lavorare) return false
        // Tutti i termini devono comparire, in qualunque ordine: "rossi
        // mario" e "mario rossi" devono trovare la stessa persona.
        return termini.every((t) => testo.includes(t))
      })
      .map(({ p }) => p)
  }, [indice, q, soloDaLavorare])

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
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Anagrafica</h2>
          <span className="muted">
            {filtrate.length === persone.length
              ? `${persone.length} ${persone.length === 1 ? 'persona' : 'persone'}`
              : `${filtrate.length} di ${persone.length}`}
          </span>
        </div>

        {filtrate.length === 0 ? (
          <p className="vuoto">
            {persone.length === 0
              ? 'Nessuna persona in anagrafica: si popola da sé con le richieste dal sito.'
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
