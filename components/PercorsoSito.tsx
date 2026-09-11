'use client'

import { useEffect, useState } from 'react'
import { caricaPercorso } from '@/app/dashboard/percorso-actions'
import {
  MAX_PAGINE,
  dataOraDi,
  dominioDi,
  oraDi,
  sintesiDi,
  stessaPagina,
  type AltraVisita,
  type Percorso,
} from '@/lib/percorsoSito'

// Le pagine viste prima di scrivere, in fila. È il contesto che manca quando
// si alza il telefono: chi ha guardato tre volte gli abbonamenti e poi ha
// compilato non è chi è atterrato sulla home da una campagna e ha compilato
// subito, e la telefonata non è la stessa.
//
// Si carica quando si guarda e non prima: nell'elenco delle richieste ci sono
// duecento righe, e caricare il percorso di tutte per leggerne una sarebbe
// duecento visite lette per niente. Nel pannello di gestione — che si apre
// apposta per lavorare quella richiesta — parte da solo; nella scheda del
// contatto sta sotto una riga che si apre, perché lì le richieste sono più
// d'una e il percorso è un approfondimento, non la prima cosa da leggere.

type Props = {
  idRichiesta: string
  /** La pagina da cui è partito il form: nell'elenco viene marcata. */
  paginaForm?: string | null
  /** true dove il percorso deve essere già lì, senza un clic in mezzo. */
  apertoSubito?: boolean
}

export function PercorsoSito({ idRichiesta, paginaForm, apertoSubito = false }: Props) {
  const [aperto, setAperto] = useState(apertoSubito)
  // undefined = non ancora chiesto; null = chiesto e non disponibile.
  const [percorso, setPercorso] = useState<Percorso | null | undefined>(undefined)
  const [errore, setErrore] = useState(false)

  useEffect(() => {
    if (!aperto || percorso !== undefined || errore) return
    let vivo = true
    caricaPercorso(idRichiesta)
      .then((p) => {
        if (vivo) setPercorso(p)
      })
      .catch(() => {
        if (vivo) setErrore(true)
      })
    return () => {
      vivo = false
    }
  }, [aperto, errore, idRichiesta, percorso])

  return (
    <div className="percorso">
      {apertoSubito ? (
        <p className="percorso-titolo">Percorso sul sito</p>
      ) : (
        <button type="button" className="percorso-apri" onClick={() => setAperto((v) => !v)}>
          {aperto ? '− ' : '+ '}
          Percorso sul sito
        </button>
      )}

      {aperto && (
        <>
          {errore && <p className="muted percorso-nota">Non sono riuscito a leggere il percorso.</p>}
          {!errore && percorso === undefined && (
            <p className="muted percorso-nota">Carico il percorso…</p>
          )}
          {!errore && percorso === null && (
            <p className="muted percorso-nota">Percorso non disponibile.</p>
          )}
          {!errore && percorso && <Contenuto percorso={percorso} paginaForm={paginaForm} />}
        </>
      )}
    </div>
  )
}

function Contenuto({ percorso, paginaForm }: { percorso: Percorso; paginaForm?: string | null }) {
  return (
    <>
      <VisitaCorrente percorso={percorso} paginaForm={paginaForm} />
      <AltreVisite visite={percorso.altreVisite} troncate={percorso.altreTroncate} />
    </>
  )
}

function VisitaCorrente({
  percorso,
  paginaForm,
}: {
  percorso: Percorso
  paginaForm?: string | null
}) {
  const { sessione, pagine, troncato } = percorso

  // Nessuna visita collegata: va detto in parole, perché non è la stessa cosa
  // di una persona che non ha girato il sito.
  if (!sessione) {
    return (
      <p className="muted percorso-nota">
        Nessuna visita collegata: la richiesta non porta una sessione registrata. Succede a chi
        scrive con il tracciamento bloccato, e a chi lascia la pagina aperta a lungo prima di
        inviare.
      </p>
    )
  }

  // L'ultima volta che ha visto la pagina del form è il momento in cui ha
  // compilato: se ci era passato prima e poi tornato, è il ritorno che conta.
  let indiceForm = -1
  pagine.forEach((p, i) => {
    if (stessaPagina(p.pagina, paginaForm ?? null)) indiceForm = i
  })

  const arrivoDa = dominioDi(sessione.referrer)

  return (
    <>
      <p className="percorso-sintesi">{sintesiDi(sessione, pagine.length)}</p>

      {(sessione.landing_page || arrivoDa) && (
        <p className="muted percorso-nota">
          {sessione.landing_page && <>Atterrato su {sessione.landing_page}</>}
          {sessione.landing_page && arrivoDa && ' · '}
          {arrivoDa && <>arrivato da {arrivoDa}</>}
        </p>
      )}

      {pagine.length === 0 ? (
        <p className="muted percorso-nota">
          La visita è registrata ma non ha pagine: risulta solo l&apos;apertura della sessione.
        </p>
      ) : (
        <ol className="percorso-pagine">
          {pagine.map((p, i) => (
            <li key={`${p.visto_at}-${i}`}>
              <span className="percorso-ora">{oraDi(p.visto_at)}</span>
              <span className="percorso-pagina">
                {p.pagina}
                {i === indiceForm && <span className="tag tag-ok">ha compilato qui</span>}
              </span>
            </li>
          ))}
        </ol>
      )}

      {troncato && (
        <p className="muted percorso-nota">
          Solo le prime {MAX_PAGINE} pagine: la visita ne ha altre.
        </p>
      )}
    </>
  )
}

/**
 * Le visite di altri giorni della stessa persona.
 *
 * Una riga ciascuna, senza le pagine: qui la domanda non è cosa ha guardato
 * quel giorno, ma da quanto ci gira intorno e quante volte è tornato prima di
 * scrivere. Quando non ce ne sono il blocco sparisce del tutto — un elenco
 * vuoto farebbe pensare a un guasto invece che a una prima visita.
 */
function AltreVisite({ visite, troncate }: { visite: AltraVisita[]; troncate: boolean }) {
  if (visite.length === 0) return null

  return (
    <div className="percorso-altre">
      <p className="percorso-titolo">
        {visite.length === 1 ? "Un'altra visita" : `Altre ${visite.length} visite`} di questa
        persona
      </p>
      <ul className="percorso-visite">
        {visite.map((v) => (
          <li key={v.session_id}>
            <span className="percorso-quando">{dataOraDi(v.created_at)}</span>
            <span className="percorso-visita">
              {sintesiDi(v, 0)}
              {/* Una visita che ha portato un'altra richiesta cambia la
                  telefonata: non è la prima volta che scrive. */}
              {v.convertita && <span className="tag tag-ok">richiesta</span>}
            </span>
          </li>
        ))}
      </ul>
      {troncate && <p className="muted percorso-nota">Ce ne sono altre, più vecchie.</p>}
    </div>
  )
}
