'use client'

import { useState, type ReactNode } from 'react'

// Un elenco che si apre a blocchi: in vista le prime `iniziali` voci, poi
// «Mostra altre N» ne aggiunge `passo` alla volta. Le voci arrivano già
// disegnate dal Server Component: qui si decide solo quante mostrarne. Serve
// alle azioni fatte della scheda contatto, che su un socio storico sono
// decine (le email automatiche di Info4U da sole ne fanno molte).
export function ElencoAPassi({
  voci,
  iniziali = 3,
  passo = 10,
}: {
  voci: ReactNode[]
  iniziali?: number
  passo?: number
}) {
  const [visibili, setVisibili] = useState(iniziali)
  const restanti = voci.length - visibili
  return (
    <>
      <ol className="storia">{voci.slice(0, visibili)}</ol>
      {restanti > 0 && (
        <button
          type="button"
          className="btn btn-ghost btn-sm elenco-altre"
          onClick={() => setVisibili((v) => v + passo)}
        >
          Mostra altre {Math.min(passo, restanti)}
          <span className="muted"> · ne restano {restanti}</span>
        </button>
      )}
    </>
  )
}
