'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { dataLunga, perGiorno, type VoceAgenda } from '@/lib/agenda'
import { EventiElenco, type GestioneSemplicePerVoce } from '@/components/EventiElenco'
import type { EventoCollegato } from '../richieste/EventiTrattativa'
import type { Richiesta } from '../richieste/RigaRichiesta'
import type { DatiTrattativa } from '../richieste/Trattativa'

/**
 * La vista a lista dell'agenda, con la ricerca libera per nome, cognome,
 * email o cellulare — in memoria, come in RicercaPersone ed ElencoRichieste:
 * la finestra della pagina è di poche centinaia di voci al più (vedi
 * GIORNI_AVANTI/GIORNI_INDIETRO in page.tsx), e stringerla mentre si digita
 * non giustifica un giro sul server per lettera.
 *
 * Ogni voce porta già `ricerca`, il testo su cui cercare costruito da
 * voceDaTask/voceDaContatto (vedi lib/agenda.ts): nome, email e cellulare
 * della persona, già uniti e in minuscolo.
 */
export function ElencoAgenda({
  vociLista,
  gestioni,
  richieste,
  eventiPerPersona,
  commerciali,
  trattative,
  oggi,
  io,
  operatori,
  puoCancellare,
  sonoCommerciale,
  possoRiassegnare,
  nomiStaff,
  filtroAttivo,
  soloMieSenzaFiltro,
  hrefTuttaAgenda,
  apriChiave = null,
  apriPersonaId = null,
}: {
  vociLista: VoceAgenda[]
  gestioni: Record<string, GestioneSemplicePerVoce>
  richieste: Record<string, Richiesta>
  eventiPerPersona: Record<string, EventoCollegato[]>
  commerciali: string[]
  trattative: Record<string, DatiTrattativa>
  oggi: string
  io: string | null
  operatori: string[]
  puoCancellare: boolean
  sonoCommerciale: boolean
  possoRiassegnare: boolean
  nomiStaff: Record<string, string>
  /** C'è già un chip di filtro attivo (stato o «di chi»): cambia il messaggio del vuoto. */
  filtroAttivo: boolean
  /** Solo la propria agenda e nessun filtro di stato: «la tua agenda è libera». */
  soloMieSenzaFiltro: boolean
  hrefTuttaAgenda: string
  /** La voce da aprire subito, arrivando da «prendi in carico» altrove. */
  apriChiave?: string | null
  /** Ripiego sulla persona, quando la voce esatta non si conosce. */
  apriPersonaId?: string | null
}) {
  const [q, setQ] = useState('')

  const vociFiltrate = useMemo(() => {
    const termini = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (termini.length === 0) return vociLista
    // Tutti i termini devono comparire, in qualunque ordine: "rossi mario" e
    // "mario rossi" devono trovare la stessa voce.
    return vociLista.filter((v) => termini.every((t) => v.ricerca.includes(t)))
  }, [vociLista, q])

  const giorniLista = useMemo(
    () => [...new Set(vociFiltrate.map((v) => v.data))].sort(),
    [vociFiltrate]
  )
  const perGiornata = useMemo(() => perGiorno(vociFiltrate), [vociFiltrate])

  return (
    <>
      <div className="card">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="cerca-agenda">Cerca</label>
          <input
            id="cerca-agenda"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nome, cognome, email o cellulare"
            autoComplete="off"
          />
        </div>
      </div>

      {giorniLista.map((giorno) => {
        const delGiorno = perGiornata.get(giorno) ?? []
        const daFareOggi = delGiorno.filter((v) => v.daFare).length
        // Arretrata è una giornata passata che ha ancora qualcosa di aperto.
        const arretrato = giorno < oggi && daFareOggi > 0
        // Passata e senza più niente da fare: verde, come le sue righe.
        const conclusa = giorno < oggi && daFareOggi === 0

        return (
          <div
            className={`card agenda-giorno${
              arretrato
                ? ' is-arretrato'
                : conclusa
                  ? ' is-conclusa'
                  : giorno === oggi
                    ? ' is-oggi'
                    : ''
            }`}
            key={giorno}
          >
            <div className="card-head">
              <h2 className="agenda-giorno-titolo">
                {dataLunga(giorno)}
                {giorno === oggi && <span className="badge badge-info badge-punto">oggi</span>}
                {arretrato && (
                  <span className="badge badge-ko badge-punto badge-stato">arretrato</span>
                )}
                {conclusa && <span className="badge badge-ok badge-punto badge-stato">fatto</span>}
              </h2>
              <span className="muted agenda-giorno-conti">
                <span>
                  {delGiorno.length} {delGiorno.length === 1 ? 'voce' : 'voci'}
                </span>
                {daFareOggi > 0 && (
                  <span className={`badge badge-punto ${arretrato ? 'badge-ko' : 'badge-warn'}`}>
                    {daFareOggi} da fare
                  </span>
                )}
              </span>
            </div>
            <EventiElenco
              voci={delGiorno}
              gestioni={gestioni}
              richieste={richieste}
              eventiPerPersona={eventiPerPersona}
              commerciali={commerciali}
              trattative={trattative}
              oggi={oggi}
              io={io}
              operatori={operatori}
              puoCancellare={puoCancellare}
              sonoCommerciale={sonoCommerciale}
              possoRiassegnare={possoRiassegnare}
              nomiStaff={nomiStaff}
              apriChiave={apriChiave}
              apriPersonaId={apriPersonaId}
            />
          </div>
        )
      })}

      {vociLista.length === 0 ? (
        <div className="card">
          {/* «Niente in agenda» in grigio al centro si legge come un guasto:
              qui i due casi sono diversi — i filtri sono troppo stretti,
              oppure non c'è davvero niente, che è una buona notizia. */}
          <div className="vuoto-buono">
            <span className="vuoto-glifo" aria-hidden="true">
              {filtroAttivo ? '⌕' : '✓'}
            </span>
            <p className="vuoto-titolo">
              {filtroAttivo
                ? soloMieSenzaFiltro
                  ? 'La tua agenda è libera'
                  : 'Niente con questo filtro'
                : 'Agenda libera'}
            </p>
            <p className="vuoto-nota">
              {filtroAttivo ? (
                <>
                  Nessuna voce corrisponde.{' '}
                  <Link className="link" href={hrefTuttaAgenda}>
                    Guarda tutta l&apos;agenda
                  </Link>
                </>
              ) : (
                'Nessun appuntamento e nessuna cosa da fare, né arretrata né in arrivo.'
              )}
            </p>
          </div>
        </div>
      ) : (
        vociFiltrate.length === 0 && (
          <div className="card">
            <div className="vuoto-buono">
              <span className="vuoto-glifo" aria-hidden="true">
                ⌕
              </span>
              <p className="vuoto-titolo">Nessuna voce corrisponde alla ricerca</p>
              <p className="vuoto-nota">
                Prova a cancellare il testo, o a cercare un altro nome, email o cellulare.
              </p>
            </div>
          </div>
        )
      )}
    </>
  )
}
