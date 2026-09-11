import { percentuale, type Voce } from '@/lib/analytics'

// Una dimensione: le voci ordinate, con la loro quota sul totale.
export function Ripartizione({
  titolo,
  voci,
  totale,
  nota,
  massimo = 10,
}: {
  titolo: string
  voci: Voce[]
  totale: number
  nota?: string
  massimo?: number
}) {
  if (voci.length === 0) return null

  const mostrate = voci.slice(0, massimo)
  // Quello che resta fuori si dice, non si nasconde: una tabella troncata in
  // silenzio fa sommare percentuali che non arrivano a cento.
  const resto = voci.slice(massimo).reduce((s, v) => s + v.richieste, 0)

  return (
    <div className="card">
      <div className="card-head">
        <h2>{titolo}</h2>
      </div>
      {nota && (
        <p className="muted" style={{ marginTop: 0, fontSize: 'var(--text-xs)' }}>
          {nota}
        </p>
      )}
      <div className="tabella-wrap">
        <table className="tabella">
          <tbody>
            {mostrate.map((v) => (
              <tr key={v.voce}>
                <td>{v.voce}</td>
                <td className="cella-nowrap">{v.richieste}</td>
                <td className="cella-nowrap muted">{percentuale(v.richieste, totale)}</td>
              </tr>
            ))}
            {resto > 0 && (
              <tr>
                <td className="muted">altre {voci.length - massimo} voci</td>
                <td className="cella-nowrap muted">{resto}</td>
                <td className="cella-nowrap muted">{percentuale(resto, totale)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
