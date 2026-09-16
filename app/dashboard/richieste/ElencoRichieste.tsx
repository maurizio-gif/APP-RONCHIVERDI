'use client'

import { useMemo, useState } from 'react'
import { testoRicerca } from '@/lib/persone'
import { RigaRichiesta, type ContestoTrattativa, type Richiesta } from './RigaRichiesta'
import type { EventoCollegato } from './EventiTrattativa'

type RichiestaConDati = Richiesta & {
  storico?: { ordinale: number; totale: number; precedenteIl: string | null }
  eventi: EventoCollegato[]
}

/**
 * Le richieste già mostrate dai filtri a chip, con in più la ricerca libera
 * per nome, cognome, email o cellulare — in memoria, come in
 * RicercaPersone: sono al più 200 righe (vedi elencoDelCanale nella pagina
 * del canale), e stringere l'elenco mentre si digita non giustifica un
 * giro sul server per lettera.
 */
export function ElencoRichieste({
  richieste,
  contesto,
  nomiStaff,
  operatori,
  puoCancellare,
  gestioneSemplice,
  richiestaDalLink,
}: {
  richieste: RichiestaConDati[]
  contesto?: ContestoTrattativa
  nomiStaff: Record<string, string>
  operatori: string[]
  puoCancellare: boolean
  gestioneSemplice: boolean
  richiestaDalLink?: string
}) {
  const [q, setQ] = useState('')

  const indice = useMemo(() => richieste.map((r) => ({ r, testo: testoRicerca(r) })), [richieste])

  const filtrate = useMemo(() => {
    const termini = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (termini.length === 0) return richieste
    // Tutti i termini devono comparire, in qualunque ordine: "rossi mario" e
    // "mario rossi" devono trovare la stessa richiesta.
    return indice.filter(({ testo }) => termini.every((t) => testo.includes(t))).map(({ r }) => r)
  }, [indice, q, richieste])

  // Il link puntava a una richiesta che qui non c'è del tutto, oppure c'è ma
  // la ricerca in corso la nasconde: sono due situazioni diverse, e solo la
  // seconda si risolve cancellando il testo.
  const linkFuoriElenco = !!richiestaDalLink && !richieste.some((x) => x.id === richiestaDalLink)
  const linkNascostoDallaRicerca =
    !!richiestaDalLink &&
    !linkFuoriElenco &&
    !filtrate.some((x) => x.id === richiestaDalLink)

  return (
    <>
      <div className="card">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="cerca-richieste">Cerca</label>
          <input
            id="cerca-richieste"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nome, cognome, email o cellulare"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="card">
        {q.trim() && (
          <p className="muted" style={{ marginTop: 0 }}>
            {filtrate.length} di {richieste.length}{' '}
            {richieste.length === 1 ? 'richiesta' : 'richieste'}
          </p>
        )}

        {filtrate.length === 0 ? (
          <p className="vuoto">Nessuna richiesta corrisponde alla ricerca.</p>
        ) : (
          <ul className="richieste">
            {/* Il link puntava a una richiesta che qui non c'è: più vecchia
                delle ultime duecento, o nascosta da un filtro attivo. Dirlo è
                l'unico modo di distinguere «non l'ho trovata» da «il link non
                ha funzionato». */}
            {linkFuoriElenco && (
              <li className="richiesta">
                <p className="muted" style={{ margin: 0 }}>
                  La richiesta del link non è in questo elenco: può essere più vecchia delle
                  ultime 200, oppure esclusa dai filtri qui sopra.
                </p>
              </li>
            )}
            {linkNascostoDallaRicerca && (
              <li className="richiesta">
                <p className="muted" style={{ margin: 0 }}>
                  La richiesta del link è nascosta dalla ricerca qui sopra: cancella il testo per
                  ritrovarla.
                </p>
              </li>
            )}
            {filtrate.map((riga) => (
              <RigaRichiesta
                r={riga}
                apriSubito={riga.id === richiestaDalLink}
                contesto={contesto}
                nomiStaff={nomiStaff}
                operatori={operatori}
                puoCancellare={puoCancellare}
                storico={riga.storico}
                eventi={riga.eventi}
                gestioneSemplice={gestioneSemplice}
                key={riga.id}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
