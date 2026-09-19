'use client'

import { useState, useTransition } from 'react'
import {
  GENERI,
  giorniFra,
  giorniPrimaInParole,
  inUnaFrase,
  riassumi,
  type GenereTappa,
  type Percorso,
  type Tappa,
} from '@/lib/percorsoVendita'
import { percorsoDellaVendita } from './actions'

// «Se dipende da qualche azione»: dentro la riga di una vendita, come nella
// pagina Nuovi contratti di APP-ATHLON — il riepilogo prima (una frase), il
// dettaglio dopo (le tappe), e si carica solo quando si apre. Non un tag
// precalcolato per ogni riga: il Dettaglio del giorno ne mostra fino a
// qualche decina, ma la pagina Contratti di Athlon ne mostra centinaia, e
// leggere il percorso di ognuna al caricamento vorrebbe dire pagare tutto
// per mostrare quello che una riga sola guarderà davvero.
export function PercorsoVendita({ personaId, dataVendita }: { personaId: string | null; dataVendita: string }) {
  const [aperto, setAperto] = useState(false)
  const [percorso, setPercorso] = useState<Percorso | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [dettaglioAperto, setDettaglioAperto] = useState(false)
  const [inCorso, avvia] = useTransition()

  if (!personaId) return null

  function apri() {
    const prossimo = !aperto
    setAperto(prossimo)
    // Una volta sola: riaprire il blocco non rilegge il percorso, che di una
    // vendita già fatta non cambia mentre lo si guarda.
    if (!prossimo || percorso || inCorso) return
    setErrore(null)
    avvia(async () => {
      const r = await percorsoDellaVendita(personaId!, dataVendita)
      if (!r.ok) {
        setErrore(r.errore)
        return
      }
      setPercorso(r.percorso)
    })
  }

  return (
    <span className="percorso-vendita">
      <button type="button" className="btn btn-ghost btn-sm percorso-toggle" aria-expanded={aperto} onClick={apri}>
        {aperto ? '−' : '+'} {aperto ? 'Nascondi' : 'Mostra'} il percorso
      </button>

      {aperto && (
        <span className="percorso">
          {inCorso && <span className="muted">Sto ricostruendo il percorso…</span>}
          {errore && <span className="error-banner">{errore}</span>}
          {percorso && !inCorso && (
            <Contenuto percorso={percorso} dettaglioAperto={dettaglioAperto} onDettaglio={() => setDettaglioAperto((d) => !d)} />
          )}
        </span>
      )}
    </span>
  )
}

function Contenuto({
  percorso,
  dettaglioAperto,
  onDettaglio,
}: {
  percorso: Percorso
  dettaglioAperto: boolean
  onDettaglio: () => void
}) {
  const r = riassumi(percorso)

  return (
    <>
      <span className="percorso-frase">{inUnaFrase(r)}</span>

      {r.quante > 0 && (
        <>
          <span className="percorso-pastiglie">
            {r.perGenere.map((g) => (
              <span key={g.genere} className={classeGenere(g.genere)}>
                {etichettaGenere(g.genere)} {g.quante}
              </span>
            ))}
          </span>

          <button type="button" className="btn btn-ghost btn-sm percorso-toggle" aria-expanded={dettaglioAperto} onClick={onDettaglio}>
            {dettaglioAperto ? '−' : '+'} {dettaglioAperto ? 'Nascondi' : 'Mostra'} le {r.quante} tappe
          </button>

          {dettaglioAperto && (
            <span className="percorso-tappe">
              {percorso.tappe.map((t) => (
                <TappaRiga key={t.chiave} tappa={t} fine={percorso.fine} />
              ))}
            </span>
          )}
        </>
      )}
    </>
  )
}

function TappaRiga({ tappa, fine }: { tappa: Tappa; fine: string }) {
  return (
    <span className="percorso-tappa">
      <span className="percorso-tappa-testa">
        <span className={classeGenere(tappa.genere)}>{etichettaGenere(tappa.genere)}</span>
        <span className="percorso-tappa-ora muted">{giorniPrimaInParole(giorniFra(fine, tappa.momento))}</span>
      </span>
      <span className="percorso-tappa-corpo">
        {tappa.titolo}
        {tappa.dettaglio && <span className="muted"> — {tappa.dettaglio}</span>}
      </span>
    </span>
  )
}

function etichettaGenere(genere: GenereTappa): string {
  return GENERI.find((g) => g.chiave === genere)?.etichetta ?? genere
}

function classeGenere(genere: GenereTappa): string {
  if (genere === 'richiesta') return 'badge badge-info'
  if (genere === 'trattativa') return 'badge badge-warn'
  return 'badge badge-ok'
}
