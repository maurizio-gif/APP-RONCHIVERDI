import { euro } from '@/lib/pipeline'

// Grafico a barre in SVG, senza librerie — stesso pattern di
// app/dashboard/analytics/GraficoGiorni.tsx: una barra per mese, altezza in
// proporzione al massimo. Niente 'use client': i valori si leggono dal
// <title> di ogni barra al passaggio del mouse.
export function GraficoMensile({ serie }: { serie: { mese: string; fatturato: number }[] }) {
  if (serie.length === 0) return null

  const massimo = Math.max(...serie.map((m) => m.fatturato), 1)
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
      <svg viewBox="0 0 100 34" preserveAspectRatio="none" role="img" aria-label="Fatturato per mese">
        {serie.map((m, i) => {
          const altezza = (m.fatturato / massimo) * 30
          return (
            <rect
              key={m.mese}
              x={i * larghezzaBarra + larghezzaBarra * 0.15}
              y={32 - altezza}
              width={larghezzaBarra * 0.7}
              height={Math.max(altezza, m.fatturato > 0 ? 0.6 : 0)}
              className={m.fatturato > 0 ? 'grafico-barra' : 'grafico-barra is-vuota'}
            >
              <title>
                {etichetta(m.mese)}: {euro(m.fatturato)}
              </title>
            </rect>
          )
        })}
        <line x1="0" y1="32" x2="100" y2="32" className="grafico-asse" />
      </svg>

      <div className="grafico-etichette muted">
        {serie.map((m) => (
          <span key={m.mese}>{etichetta(m.mese)}</span>
        ))}
      </div>
      <p className="grafico-massimo muted">Massimo mensile: {euro(massimo)}</p>
    </div>
  )
}
