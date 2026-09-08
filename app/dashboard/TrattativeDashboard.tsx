'use client'

import Link from 'next/link'
import { nomePersona } from '@/lib/persone'
import { Trattativa, type DatiTrattativa } from './richieste/Trattativa'

/** Una trattativa con la persona che rappresenta, per l'elenco in dashboard. */
export type TrattativaConPersona = DatiTrattativa & {
  personaId: string | null
  nome: string | null
  cognome: string | null
  email: string | null
  cellulare: string | null
  /** Quando è arrivata l'ultima richiesta di questa persona. */
  ultimaRichiesta: string | null
}

// Le trattative in dashboard: quelle intestate a chi guarda, e quelle libere
// che può intestarsi.
//
// I quattro riquadri della pipeline dicono quante ce ne sono in ogni stato,
// che è la fotografia del club; questo elenco dice *quali sono le tue*, ed è
// la domanda con cui si apre la giornata. I comandi sono gli stessi della
// sezione Club e Family — stesso componente, non una copia.

export function TrattativeDashboard({
  trattative,
  io,
  sonoCommerciale,
  possoRiassegnare,
  commerciali,
}: {
  trattative: TrattativaConPersona[]
  io: string | null
  sonoCommerciale: boolean
  possoRiassegnare: boolean
  commerciali: string[]
}) {
  return (
    <ul className="trattative-elenco">
      {trattative.map((t) => (
        <li className="trattativa-riga" key={t.id}>
          <div className="trattativa-chi-riga">
            {/* Il nome porta alla scheda: da qui si vede solo lo stato, e
                prima di chiamare serve sapere cosa ha chiesto. */}
            {t.personaId ? (
              <Link className="trattativa-nome" href={`/dashboard/persone/${t.personaId}`}>
                {nomePersona(t)}
              </Link>
            ) : (
              <span className="trattativa-nome">{nomePersona(t)}</span>
            )}
            <span className="muted trattativa-recapiti">
              {[t.email, t.cellulare].filter(Boolean).join(' · ')}
            </span>
          </div>

          <Trattativa
            t={t}
            io={io}
            sonoCommerciale={sonoCommerciale}
            possoRiassegnare={possoRiassegnare}
            commerciali={commerciali}
          />
        </li>
      ))}
    </ul>
  )
}
