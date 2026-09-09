'use client'

import Link from 'next/link'
import { createContext, useContext, useMemo, useState } from 'react'
import {
  GIORNI_SETTIMANA,
  celleVuoteIniziali,
  dataLunga,
  etichettaMese,
  giorniDelMese,
  perGiorno,
  type VoceAgenda,
} from '@/lib/agenda'
import { TabellaAgenda } from './TabellaAgenda'

/**
 * Il giorno selezionato nel calendario, per chi sta sotto — cioè il form
 * "Aggiungi in agenda", che così si apre già sul giorno che si sta guardando.
 * Passa da un contesto e non da una prop perché il calendario riceve il form
 * come nodo già costruito dal server: non lo importa e non sa cosa sia.
 */
const GiornoSelezionatoContext = createContext<string | null>(null)

export function useGiornoSelezionato(): string | null {
  return useContext(GiornoSelezionatoContext)
}

export function CalendarioAgenda({
  voci,
  mese,
  oggi,
  emailCorrente,
  operatori,
  puoCancellare,
  linkMesePrecedente,
  linkMeseSuccessivo,
  linkOggi,
  nuovaVoce,
}: {
  voci: VoceAgenda[]
  /** Un giorno qualsiasi del mese mostrato, in YYYY-MM-DD. */
  mese: string
  oggi: string
  emailCorrente: string | null
  operatori: string[]
  puoCancellare: boolean
  linkMesePrecedente: string
  linkMeseSuccessivo: string
  linkOggi: string
  nuovaVoce?: React.ReactNode
}) {
  const perGiornata = useMemo(() => perGiorno(voci), [voci])
  const giorni = useMemo(() => giorniDelMese(mese), [mese])
  const vuoteIniziali = celleVuoteIniziali(mese)

  // Si parte da oggi, ma solo se oggi è nel mese mostrato e ha qualcosa:
  // aprire un pannello vuoto sotto la griglia non dice niente a nessuno.
  const [selezionato, setSelezionato] = useState<string | null>(() =>
    (perGiornata.get(oggi)?.length ?? 0) > 0 ? oggi : null
  )

  const delGiorno = selezionato ? perGiornata.get(selezionato) ?? [] : []

  return (
    <div>
      <div className="cal-testa">
        <h2 className="cal-mese">{etichettaMese(mese)}</h2>
        <div className="agenda-nav">
          <Link className="btn btn-ghost btn-sm" href={linkMesePrecedente} aria-label="Mese precedente">
            ←
          </Link>
          <Link className="btn btn-ghost btn-sm" href={linkOggi}>
            Oggi
          </Link>
          <Link className="btn btn-ghost btn-sm" href={linkMeseSuccessivo} aria-label="Mese successivo">
            →
          </Link>
        </div>
      </div>

      {/* Tre pallini, non due. Prima ogni giornata con qualcosa di aperto era
          rossa — anche un appuntamento fra tre settimane — e col mese quasi
          tutto rosso non risaltava più niente, che per un segnale d'allarme è
          il difetto peggiore. Ora il rosso vuol dire una cosa sola: è passata
          e non è stata fatta. */}
      <div className="cal-legenda">
        <span>
          <span className="puntino rosso" /> passata e non fatta
        </span>
        <span>
          <span className="puntino ambra" /> c&apos;è da fare
        </span>
        <span>
          <span className="puntino verde" /> tutto gestito
        </span>
      </div>

      <div className="cal-griglia">
        {GIORNI_SETTIMANA.map((g) => (
          <div className="cal-dow" key={g}>
            {g}
          </div>
        ))}

        {Array.from({ length: vuoteIniziali }).map((_, i) => (
          <div className="cal-cella is-vuota" key={`vuota-${i}`} />
        ))}

        {giorni.map((giorno) => {
          const lista = perGiornata.get(giorno) ?? []
          const daFare = lista.some((v) => v.daFare)
          const arretrata = daFare && giorno < oggi
          const stato = lista.length === 0 ? null : arretrata ? 'rosso' : daFare ? 'ambra' : 'verde'
          const classi = ['cal-cella']
          if (giorno === oggi) classi.push('is-oggi')
          // La giornata passata con qualcosa di aperto si vela di rosso: nel
          // mese si trova senza contare i pallini uno per uno.
          if (arretrata) classi.push('is-arretrata')
          if (giorno === selezionato) classi.push('is-selezionata')

          return (
            <button
              type="button"
              className={classi.join(' ')}
              key={giorno}
              aria-label={`${dataLunga(giorno)} — ${lista.length} voci in agenda`}
              onClick={() => setSelezionato(giorno === selezionato ? null : giorno)}
            >
              <span className="cal-numero">{Number(giorno.slice(8, 10))}</span>
              {stato && (
                <span className="cal-segni">
                  <span className={`puntino ${stato}`} />
                  {lista.length > 1 && <span className="cal-conteggio">{lista.length}</span>}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {selezionato && (
        <div
          className={`card agenda-giorno${
            selezionato === oggi
              ? ' is-oggi'
              : delGiorno.some((v) => v.daFare) && selezionato < oggi
                ? ' is-arretrato'
                : ''
          }`}
        >
          <div className="card-head">
            <h2 className="agenda-giorno-titolo">
              {dataLunga(selezionato)}
              {selezionato === oggi && <span className="badge badge-info badge-punto">oggi</span>}
              {selezionato < oggi && delGiorno.some((v) => v.daFare) && (
                <span className="badge badge-ko badge-punto badge-stato">arretrato</span>
              )}
            </h2>
            <span className="muted agenda-giorno-conti">
              {delGiorno.length} {delGiorno.length === 1 ? 'voce' : 'voci'}
            </span>
          </div>
          {delGiorno.length > 0 ? (
            <TabellaAgenda
              voci={delGiorno}
              oggi={oggi}
              emailCorrente={emailCorrente}
              operatori={operatori}
              puoCancellare={puoCancellare}
              mostraData={false}
            />
          ) : (
            <p className="vuoto">Niente in agenda in questo giorno.</p>
          )}
        </div>
      )}

      {nuovaVoce && (
        <div className="agenda-nuova">
          <GiornoSelezionatoContext.Provider value={selezionato}>
            {nuovaVoce}
          </GiornoSelezionatoContext.Provider>
        </div>
      )}
    </div>
  )
}
