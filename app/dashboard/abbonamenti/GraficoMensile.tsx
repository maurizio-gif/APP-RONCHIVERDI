import { euro } from '@/lib/pipeline'

type VoceSerie = { mese: string; lavorato: number; nonLavorato: number }

// Grafico a barre in SVG, senza librerie — stesso pattern di
// app/dashboard/analytics/GraficoGiorni.tsx: una barra per mese, altezza in
// proporzione al massimo. Ogni barra è impilata in due: lavorato (una
// richiesta, una trattativa o un'azione della segreteria dietro la vendita)
// sopra, non lavorato sotto — lo split che il resto della sezione Abbonamenti
// mette in evidenza (vedi lib/attivitaCommerciale.ts). Niente 'use client': i
// valori si leggono dal <title> di ogni barra al passaggio del mouse.
export function GraficoMensile({ serie }: { serie: VoceSerie[] }) {
  if (serie.length === 0) return null

  const massimo = Math.max(...serie.map((m) => m.lavorato + m.nonLavorato), 1)
  const larghezzaBarra = 100 / serie.length

  function etichetta(mese: string) {
    return new Date(`${mese}T12:00:00Z`).toLocaleDateString('it-IT', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    })
  }

  return (
    <div className="grafico">
      <svg
        viewBox="0 0 100 34"
        preserveAspectRatio="none"
        role="img"
        aria-label="Fatturato per mese, lavorato e non lavorato"
      >
        {serie.map((m, i) => {
          const totale = m.lavorato + m.nonLavorato
          const altezzaTotale = (totale / massimo) * 30
          const altezzaLavorato = totale > 0 ? (altezzaTotale * m.lavorato) / totale : 0
          const altezzaNonLavorato = Math.max(altezzaTotale - altezzaLavorato, 0)
          const x = i * larghezzaBarra + larghezzaBarra * 0.15
          const larghezza = larghezzaBarra * 0.7

          return (
            <g key={m.mese}>
              <rect
                x={x}
                y={32 - altezzaNonLavorato}
                width={larghezza}
                height={Math.max(altezzaNonLavorato, m.nonLavorato > 0 ? 0.6 : 0)}
                className={m.nonLavorato > 0 ? 'grafico-barra grafico-barra-non-lavorato' : 'grafico-barra is-vuota'}
              />
              <rect
                x={x}
                y={32 - altezzaTotale}
                width={larghezza}
                height={Math.max(altezzaLavorato, m.lavorato > 0 ? 0.6 : 0)}
                className="grafico-barra grafico-barra-lavorato"
              />
              <title>
                {etichetta(m.mese)}: {euro(totale)} — lavorato {euro(m.lavorato)}, non lavorato{' '}
                {euro(m.nonLavorato)}
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

      <div className="grafico-legenda muted">
        <span>
          <span className="grafico-legenda-pallino grafico-legenda-pallino-lavorato" aria-hidden="true" /> Lavorato
        </span>
        <span>
          <span className="grafico-legenda-pallino grafico-legenda-pallino-non-lavorato" aria-hidden="true" /> Non
          lavorato
        </span>
      </div>
      <p className="grafico-massimo muted">Massimo mensile: {euro(massimo)}</p>
    </div>
  )
}
