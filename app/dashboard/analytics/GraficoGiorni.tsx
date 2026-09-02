import { giornoBreve, type Giorno } from '@/lib/analytics'

// Grafico a barre in SVG, senza librerie: una barra per giorno, l'altezza in
// proporzione al massimo. Una dipendenza di grafici pesa più di questo file e
// porterebbe con sé un tema da riconciliare coi colori del club.
//
// Niente 'use client': non c'è interazione da gestire, i valori si leggono
// dal <title> di ogni barra che il browser mostra al passaggio del mouse.
export function GraficoGiorni({ serie }: { serie: Giorno[] }) {
  if (serie.length === 0) return null

  const massimo = Math.max(...serie.map((g) => g.richieste), 1)
  const larghezzaBarra = 100 / serie.length

  // Etichette solo agli estremi e al centro: con novanta giorni, una per
  // barra sarebbe una riga nera illeggibile.
  const indiciEtichette = [0, Math.floor(serie.length / 2), serie.length - 1]

  return (
    <div className="grafico">
      <svg viewBox="0 0 100 34" preserveAspectRatio="none" role="img" aria-label="Richieste per giorno">
        {serie.map((g, i) => {
          const altezza = (g.richieste / massimo) * 30
          return (
            <rect
              key={g.giorno}
              x={i * larghezzaBarra + larghezzaBarra * 0.15}
              y={32 - altezza}
              width={larghezzaBarra * 0.7}
              height={Math.max(altezza, g.richieste > 0 ? 0.6 : 0)}
              className={g.richieste > 0 ? 'grafico-barra' : 'grafico-barra is-vuota'}
            >
              <title>
                {giornoBreve(g.giorno)}: {g.richieste} {g.richieste === 1 ? 'richiesta' : 'richieste'}
              </title>
            </rect>
          )
        })}
        <line x1="0" y1="32" x2="100" y2="32" className="grafico-asse" />
      </svg>

      <div className="grafico-etichette muted">
        {indiciEtichette.map((i) => (
          <span key={i}>{serie[i] ? giornoBreve(serie[i].giorno) : ''}</span>
        ))}
      </div>
      <p className="grafico-massimo muted">
        Massimo giornaliero: {massimo} {massimo === 1 ? 'richiesta' : 'richieste'}
      </p>
    </div>
  )
}
