'use client'

import { useEffect, useState } from 'react'
import { caricaPercorso } from '@/app/dashboard/percorso-actions'
import {
  MAX_PAGINE,
  dominioDi,
  oraDi,
  sintesiDi,
  stessaPagina,
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
  const { sessione, pagine, troncato } = percorso

  // Nessuna visita collegata. I due casi si distinguono, perché portano a due
  // conclusioni diverse: senza sessione registrata non c'è niente da cercare,
  // mentre una sessione che risulta ma non ha pagine è un dato monco da
  // segnalare a chi tiene il sito.
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
