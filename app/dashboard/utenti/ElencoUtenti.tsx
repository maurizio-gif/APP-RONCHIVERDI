'use client'

import { useMemo, useState } from 'react'
import { RigaUtente, type DatiUtente } from './RigaUtente'
import type { Accesso } from './actions'

// Minuscolo, senza accenti e con gli spazi ridotti a uno: «Nicolò» si trova
// scrivendo «nicolo», e «mario  rossi» con due spazi trova Mario Rossi.
function normalizza(testo: string): string {
  return testo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Nome, cognome, le due combinazioni ed email in una sola stringa: si cerca
// «Mario Rossi» come «Rossi Mario», e una parte dell'email basta.
function testoUtente(u: DatiUtente): string {
  const n = (u.nome ?? '').trim()
  const c = (u.cognome ?? '').trim()
  return normalizza([n, c, `${n} ${c}`, `${c} ${n}`, u.email].join(' | '))
}

export function ElencoUtenti({
  utenti,
  accessi,
  amministra,
  emailCorrente,
}: {
  utenti: DatiUtente[]
  accessi: Record<string, Accesso>
  amministra: boolean
  emailCorrente: string | null
}) {
  const [filtro, setFiltro] = useState('')

  // Il filtro è sul client e immediato: l'elenco è già tutto in pagina, e una
  // persona si trova mentre si scrive senza ricaricare né perdere le righe aperte.
  const indice = useMemo(() => utenti.map((u) => ({ u, testo: testoUtente(u) })), [utenti])
  const cercato = normalizza(filtro)
  const visibili = cercato ? indice.filter((r) => r.testo.includes(cercato)).map((r) => r.u) : utenti

  return (
    <div className="card">
      <div className="card-head">
        <h2>Persone con accesso</h2>
        <span className="muted">
          {cercato ? `${visibili.length} di ${utenti.length}` : `${utenti.length} in totale`}
        </span>
      </div>

      {utenti.length === 0 ? (
        <p className="vuoto">
          Nessun utente in tabella. Il primo va inserito da Supabase, poi da qui si invitano gli
          altri.
        </p>
      ) : (
        <>
          <div className="agenda-cerca">
            <input
              type="search"
              aria-label="Cerca una persona"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Nome, cognome, nome e cognome, email"
              autoComplete="off"
            />
            {filtro && (
              <button type="button" className="link-testo" onClick={() => setFiltro('')}>
                Togli la ricerca
              </button>
            )}
          </div>

          {visibili.length === 0 ? (
            <p className="vuoto">Nessuna persona corrisponde a «{filtro.trim()}».</p>
          ) : (
            <ul className="utenti">
              {visibili.map((u) => (
                <RigaUtente
                  key={u.email}
                  u={u}
                  amministra={amministra}
                  eSeStesso={u.email === emailCorrente}
                  accesso={accessi[u.email.toLowerCase()] ?? null}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
