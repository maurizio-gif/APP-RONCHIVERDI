import {
  classeVariazione,
  formattaVariazione,
  percentuale,
  variazione,
  type Voce,
} from '@/lib/analytics'

// Una dimensione: le voci ordinate, con quota sul totale e variazione
// rispetto al periodo di confronto.
export function Ripartizione({
  titolo,
  voci,
  vociConfronto,
  totale,
  nota,
  massimo = 10,
}: {
  titolo: string
  voci: Voce[]
  vociConfronto?: Voce[] | null
  totale: number
  nota?: string
  massimo?: number
}) {
  if (voci.length === 0) return null

  const prima = new Map((vociConfronto ?? []).map((v) => [v.voce, v.richieste]))
  const mostrate = voci.slice(0, massimo)
  // Quello che resta fuori si dice, non si nasconde: una tabella troncata in
  // silenzio fa sommare percentuali che non arrivano a cento.
  const resto = voci.slice(massimo).reduce((s, v) => s + v.richieste, 0)

  return (
    <div className="card">
      <div className="card-head">
        <h2>{titolo}</h2>
        {vociConfronto && <span className="muted">variazione sul confronto</span>}
      </div>
      {nota && (
        <p className="muted" style={{ marginTop: 0, fontSize: 'var(--text-xs)' }}>
          {nota}
        </p>
      )}
      <div className="tabella-wrap">
        <table className="tabella">
          <tbody>
            {mostrate.map((v) => {
              const delta = vociConfronto ? variazione(v.richieste, prima.get(v.voce) ?? 0) : null
              return (
                <tr key={v.voce}>
                  <td>{v.voce}</td>
                  <td className="cella-nowrap">{v.richieste}</td>
                  <td className="cella-nowrap muted">{percentuale(v.richieste, totale)}</td>
                  {vociConfronto && (
                    <td className="cella-nowrap">
                      <span className={`badge ${classeVariazione(delta)}`}>
                        {formattaVariazione(delta)}
                      </span>
                    </td>
                  )}
                </tr>
              )
            })}
            {resto > 0 && (
              <tr>
                <td className="muted">altre {voci.length - massimo} voci</td>
                <td className="cella-nowrap muted">{resto}</td>
                <td className="cella-nowrap muted">{percentuale(resto, totale)}</td>
                {vociConfronto && <td />}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
