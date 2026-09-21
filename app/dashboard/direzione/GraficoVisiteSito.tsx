'use client'

import { useState } from 'react'
import { etichettaMeseBreve } from '@/lib/abbonamenti'

export type VoceVisiteMese = { mese: string; persone: number; sessioni: number }

// Barre affiancate (non impilate) per mese: "persone" (accessi singoli,
// una stima per eccesso di quante teste diverse) e "sessioni" (tutte le
// visite, ritorni compresi) non sono una partizione dello stesso totale
// come sito/in sede in GraficoContatti — persone è sempre <= sessioni,
// impilarle sommerebbe due numeri che raccontano la stessa cosa da due
// prospettive diverse, non due parti di un totale. Stesso pattern SVG
// (senza librerie, <title> nativo + riga di dettaglio sotto al grafico)
// di GraficoContatti, la sorella "a partizione" di questo grafico.
export function GraficoVisiteSito({ serie }: { serie: VoceVisiteMese[] }) {
  const [indiceAttivo, setIndiceAttivo] = useState<number | null>(null)

  if (serie.length === 0) return null

  const massimo = Math.max(...serie.map((m) => Math.max(m.sessioni, m.persone)), 1)
  const larghezzaBarra = 100 / serie.length
  const larghezzaSingola = larghezzaBarra * 0.32
  const scarto = larghezzaBarra * 0.06
  const meseAttivo = indiceAttivo !== null ? serie[indiceAttivo] : null

  return (
    <div className="grafico">
      <svg
        viewBox="0 0 100 34"
        preserveAspectRatio="none"
        role="img"
        aria-label="Accessi singoli e sessioni del sito, per mese"
      >
        {serie.map((m, i) => {
          const altezzaPersone = massimo > 0 ? (m.persone / massimo) * 30 : 0
          const altezzaSessioni = massimo > 0 ? (m.sessioni / massimo) * 30 : 0
          const altezzaResaPersone = Math.max(altezzaPersone, m.persone > 0 ? 0.6 : 0)
          const altezzaResaSessioni = Math.max(altezzaSessioni, m.sessioni > 0 ? 0.6 : 0)
          const xPersone = i * larghezzaBarra + larghezzaBarra * 0.15
          const xSessioni = xPersone + larghezzaSingola + scarto

          return (
            <g
              key={m.mese}
              tabIndex={0}
              onMouseEnter={() => setIndiceAttivo(i)}
              onMouseLeave={() => setIndiceAttivo(null)}
              onFocus={() => setIndiceAttivo(i)}
              onBlur={() => setIndiceAttivo(null)}
            >
              {/* Rettangolo invisibile su tutta la colonna: stesso motivo di
                  GraficoContatti, l'hover deve funzionare anche su un mese
                  con barre basse. */}
              <rect x={i * larghezzaBarra} y={0} width={larghezzaBarra} height={32} fill="transparent" />
              <rect
                x={xPersone}
                y={32 - altezzaResaPersone}
                width={larghezzaSingola}
                height={altezzaResaPersone}
                rx={0.4}
                className={m.persone > 0 ? 'grafico-barra-visite-persone' : 'grafico-barra is-vuota'}
              />
              <rect
                x={xSessioni}
                y={32 - altezzaResaSessioni}
                width={larghezzaSingola}
                height={altezzaResaSessioni}
                rx={0.4}
                className={m.sessioni > 0 ? 'grafico-barra-visite-sessioni' : 'grafico-barra is-vuota'}
              />
              <title>
                {etichettaMeseBreve(m.mese)}: {m.persone} accessi singoli, {m.sessioni} sessioni
              </title>
            </g>
          )
        })}
        <line x1="0" y1="32" x2="100" y2="32" className="grafico-asse" />
      </svg>

      <div className="grafico-etichette muted">
        {serie.map((m) => (
          <span key={m.mese}>{etichettaMeseBreve(m.mese)}</span>
        ))}
      </div>

      <p className="grafico-massimo muted">
        {meseAttivo
          ? `${etichettaMeseBreve(meseAttivo.mese)}: ${meseAttivo.persone} accessi singoli, ${meseAttivo.sessioni} sessioni`
          : 'Passa il mouse su una barra per il dettaglio del mese.'}
      </p>

      <div className="grafico-legenda muted">
        <span>
          <span className="grafico-legenda-pallino grafico-legenda-pallino-visite-persone" aria-hidden="true" /> Accessi
          singoli
        </span>
        <span>
          <span className="grafico-legenda-pallino grafico-legenda-pallino-visite-sessioni" aria-hidden="true" /> Sessioni
        </span>
      </div>
    </div>
  )
}
