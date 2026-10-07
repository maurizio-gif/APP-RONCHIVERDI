'use client'

import { useMemo, useState } from 'react'
import { RigaUtente, type DatiUtente } from './RigaUtente'
import type { Accesso } from './actions'

// Senza maiuscole e senza accenti: «de rossi» trova «De Rossi», «nicolo»
// trova «Nicolò».
const normalizza = (testo: string | null | undefined) =>
  (testo ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

// L'elenco con il campo di ricerca. Il filtro è in memoria, senza un giro di
// rete: gli operatori sono poche decine e arrivano tutti con la pagina.
// Cerca in nome, cognome ed email, anche in ordine inverso («rossi mario»).
export function ElencoUtenti({
  utenti,
  amministra,
  emailCorrente,
  accessi,
}: {
  utenti: DatiUtente[]
  amministra: boolean
  emailCorrente: string | null
  accessi: Record<string, Accesso>
}) {
  const [q, setQ] = useState('')

  const filtrati = useMemo(() => {
    const parole = normalizza(q).split(/\s+/).filter(Boolean)
    if (parole.length === 0) return utenti
    return utenti.filter((u) => {
      const testo = normalizza(`${u.nome ?? ''} ${u.cognome ?? ''} ${u.email}`)
      return parole.every((p) => testo.includes(p))
    })
  }, [q, utenti])

  return (
    <>
      <div className="field" style={{ marginBottom: '1rem' }}>
        <label htmlFor="cerca-utenti">Cerca</label>
        <input
          id="cerca-utenti"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nome, cognome o email"
          autoComplete="off"
        />
        {q.trim() && (
          <p className="field-hint">
            {filtrati.length} di {utenti.length}
          </p>
        )}
      </div>

      {filtrati.length === 0 ? (
        <p className="vuoto">Nessuna persona corrisponde a «{q.trim()}».</p>
      ) : (
        <ul className="utenti">
          {filtrati.map((u) => (
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
  )
}
