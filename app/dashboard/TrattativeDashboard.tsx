'use client'

import Link from 'next/link'
import { inizialiPersona, nomePersona } from '@/lib/persone'
import { CLASSE_RIGA_STATO, eChiusa } from '@/lib/pipeline'
import { CLASSE_URGENZA, fraseAttesa, giorniDa, urgenzaAttesa } from '@/lib/attesa'
import { Trattativa, type DatiTrattativa } from './richieste/Trattativa'
import { ContattiRapidi } from './ContattiRapidi'

/** Una trattativa con la persona che rappresenta, per l'elenco in dashboard. */
export type TrattativaConPersona = DatiTrattativa & {
  personaId: string | null
  /** Quando è nata: da qui esce «ferma da 9 giorni». */
  creatoIl?: string | null
  nome: string | null
  cognome: string | null
  email: string | null
  cellulare: string | null
}

// Le trattative in dashboard: quelle intestate a chi guarda, e quelle libere
// che può intestarsi.
//
// I quattro riquadri della pipeline dicono quante ce ne sono in ogni stato,
// che è la fotografia del club; questo elenco dice *quali sono le tue*, ed è
// la domanda con cui si apre la giornata. I comandi sono gli stessi della
// sezione Club e Family — stesso componente, non una copia.
//
// Ogni riga porta tre cose che prima mancavano, e che sono quelle che decidono
// chi si chiama per primo:
//
//  - **la banda di colore dello stato**, la stessa dei riquadri e dell'elenco
//    delle richieste: lo stato si vede prima di leggerlo;
//  - **da quanto aspetta**, colorata (vedi lib/attesa.ts): due righe identiche
//    non possono valere l'una un'ora e l'altra tre settimane;
//  - **i recapiti come pulsanti**: chiamare o scrivere su WhatsApp senza
//    passare per la scheda del contatto.

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
      {trattative.map((t) => {
        const giorni = giorniDa(t.creatoIl)
        // Su una chiusa l'attesa non vuol dire niente: è storia, non una cosa
        // che sta aspettando qualcuno.
        const giorniAttesa = giorni !== null && !eChiusa(t.stato) ? giorni : null

        return (
          <li className={`trattativa-riga riga-stato ${CLASSE_RIGA_STATO[t.stato]}`} key={t.id}>
            <div className="trattativa-chi-riga">
              <span className="richiesta-iniziali" aria-hidden="true">
                {inizialiPersona(t) || '·'}
              </span>

              <div className="trattativa-identita">
                {/* Il nome porta alla scheda: da qui si vede solo lo stato, e
                    prima di chiamare serve sapere cosa ha chiesto. */}
                {t.personaId ? (
                  <Link className="trattativa-nome" href={`/dashboard/persone/${t.personaId}`}>
                    {nomePersona(t)}
                  </Link>
                ) : (
                  <span className="trattativa-nome">{nomePersona(t)}</span>
                )}

                {giorniAttesa !== null && (
                  <span className={`attesa ${CLASSE_URGENZA[urgenzaAttesa(giorniAttesa)]}`}>
                    {fraseAttesa(giorniAttesa, 'aperta')}
                  </span>
                )}
              </div>

              <ContattiRapidi email={t.email} cellulare={t.cellulare} />
            </div>

            <Trattativa
              t={t}
              io={io}
              sonoCommerciale={sonoCommerciale}
              possoRiassegnare={possoRiassegnare}
              commerciali={commerciali}
            />
          </li>
        )
      })}
    </ul>
  )
}
