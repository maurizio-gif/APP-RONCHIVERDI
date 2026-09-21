'use client'

import { useState } from 'react'

export type VoceContattiMese = { mese: string; sito: number; sede: number }

function etichetta(mese: string) {
  return new Date(`${mese}T12:00:00Z`).toLocaleDateString('it-IT', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  })
}

// Grafico a barre in SVG, senza librerie — stesso pattern di
// app/dashboard/abbonamenti/GraficoMensile.tsx, con in più una riga di
// dettaglio che segue il mouse: il <title> nativo del browser (tenuto anche
// qui, per chi naviga da tastiera o touch) ha un ritardo prima di comparire e
// su alcuni browser è troppo piccolo per leggerlo al volo — la riga sotto il
// grafico risponde subito, e per questo serve 'use client'.
export function GraficoContatti({ serie }: { serie: VoceContattiMese[] }) {
  const [indiceAttivo, setIndiceAttivo] = useState<number | null>(null)

  if (serie.length === 0) return null

  const massimo = Math.max(...serie.map((m) => m.sito + m.sede), 1)
  const larghezzaBarra = 100 / serie.length
  const meseAttivo = indiceAttivo !== null ? serie[indiceAttivo] : null

  return (
    <div className="grafico">
      <svg viewBox="0 0 100 34" preserveAspectRatio="none" role="img" aria-label="Contatti per mese, sito e in sede">
        {serie.map((m, i) => {
          const totale = m.sito + m.sede
          const altezzaTotale = (totale / massimo) * 30
          const altezzaSede = totale > 0 ? (altezzaTotale * m.sede) / totale : 0
          const altezzaSito = Math.max(altezzaTotale - altezzaSede, 0)
          const x = i * larghezzaBarra + larghezzaBarra * 0.15
          const larghezza = larghezzaBarra * 0.7

          return (
            <g
              key={m.mese}
              tabIndex={0}
              onMouseEnter={() => setIndiceAttivo(i)}
              onMouseLeave={() => setIndiceAttivo(null)}
              onFocus={() => setIndiceAttivo(i)}
              onBlur={() => setIndiceAttivo(null)}
            >
              {/* Rettangolo invisibile su tutta l'altezza della colonna: senza,
                  passare il mouse sotto una barra bassa (un mese con pochi
                  contatti) non fa scattare l'hover, perché lì il rettangolo
                  colorato non arriva. */}
              <rect x={x} y={0} width={larghezza} height={32} fill="transparent" />
              <rect
                x={x}
                y={32 - altezzaSede}
                width={larghezza}
                height={Math.max(altezzaSede, m.sede > 0 ? 0.6 : 0)}
                className={m.sede > 0 ? 'grafico-barra grafico-barra-sede' : 'grafico-barra is-vuota'}
              />
              <rect
                x={x}
                y={32 - altezzaTotale}
                width={larghezza}
                height={Math.max(altezzaSito, m.sito > 0 ? 0.6 : 0)}
                className="grafico-barra grafico-barra-sito"
              />
              <title>
                {etichetta(m.mese)}: {totale} contatti — sito {m.sito}, in sede {m.sede}
              </title>
            </g>
          )
        })}
        <line x1="0" y1="32" x2="100" y2="32" className="grafico-asse" />
      </svg>

      <div className="grafico-etichette muted">
        {serie.map((m) => (
          <span key={m.mese}>{etichetta(m.mese)}</span>
        ))}
      </div>

      <p className="grafico-massimo muted">
        {meseAttivo
          ? `${etichetta(meseAttivo.mese)}: ${meseAttivo.sito + meseAttivo.sede} contatti — sito ${meseAttivo.sito}, in sede ${meseAttivo.sede}`
          : 'Passa il mouse su una barra per il dettaglio del mese.'}
      </p>

      <div className="grafico-legenda muted">
        <span>
          <span className="grafico-legenda-pallino grafico-legenda-pallino-sito" aria-hidden="true" /> Sito
        </span>
        <span>
          <span className="grafico-legenda-pallino grafico-legenda-pallino-sede" aria-hidden="true" /> In sede (Guest
          Register)
        </span>
      </div>
    </div>
  )
}
