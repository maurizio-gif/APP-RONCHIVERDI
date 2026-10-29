import { esitoConfronto, testoConfronto, type Blocco, type ColoreBlocco } from '@/lib/report-blocchi'
import { euroInteroIt, numeroIt } from '@/lib/report'
import { BarreOrizzontali } from '../accessi/Grafici'

// L'anteprima a schermo del report: disegna la stessa lista di blocchi
// (lib/report-blocchi.ts) che il PDF disegna su carta, quindi quello che si
// legge qui è quello che si scarica. Server Component, nessuno stato.

const COLORE: Record<ColoreBlocco, string> = {
  oro: 'var(--accent)',
  blu: 'var(--info)',
  verde: 'var(--ok)',
  rosso: 'var(--error)',
}

/** Colonne affiancate o impilate per periodo: stesso disegno del PDF, in SVG. */
function Colonne({ etichette, serie }: { etichette: string[]; serie: { nome: string; valori: number[]; colore: ColoreBlocco }[] }) {
  if (etichette.length < 2) return null
  const L = 600
  const A = 120
  const totali = etichette.map((_, i) => serie.reduce((s, x) => s + (x.valori[i] ?? 0), 0))
  const massimo = Math.max(...totali, 1)
  const passo = L / etichette.length
  const spessore = Math.min(passo * 0.7, 40)
  const ogni = Math.max(1, Math.ceil(etichette.length / 12))
  return (
    <div className="accessi-grafico">
      <div className="accessi-grafico-tela">
        <span className="accessi-grafico-max muted">{numeroIt(massimo)}</span>
        <svg viewBox={`0 0 ${L} ${A}`} preserveAspectRatio="none" role="img" style={{ height: '8rem' }}>
          {[0.5, 1].map((f) => (
            <line key={f} x1="0" x2={L} y1={A - A * f} y2={A - A * f} className="accessi-griglia" vectorEffect="non-scaling-stroke" />
          ))}
          {etichette.map((e, i) => {
            let y = A
            const x = i * passo + (passo - spessore) / 2
            return (
              <g key={e + i} className="accessi-colonna">
                <rect x={i * passo} y={0} width={passo} height={A} fill="transparent" />
                {serie.map((s) => {
                  const h = ((s.valori[i] ?? 0) / massimo) * A
                  y -= h
                  return h > 0 ? <rect key={s.nome} x={x} y={y} width={spessore} height={h} fill={COLORE[s.colore]} /> : null
                })}
                <title>{`${e}\n${serie.map((s) => `${s.nome}: ${numeroIt(s.valori[i] ?? 0)}`).join('\n')}`}</title>
              </g>
            )
          })}
          <line x1="0" x2={L} y1={A} y2={A} className="accessi-asse" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="accessi-grafico-etichette muted">
        {etichette.map((e, i) => (
          <span key={e + i} style={{ visibility: i % ogni === 0 ? 'visible' : 'hidden' }}>
            {e}
          </span>
        ))}
      </div>
      {serie.length > 1 && (
        <div className="accessi-legenda">
          {serie.map((s) => (
            <span key={s.nome}>
              <i className="accessi-pallino" style={{ background: COLORE[s.colore] }} /> {s.nome}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function AnteprimaReport({ blocchi }: { blocchi: Blocco[] }) {
  return (
    <div className="report-anteprima">
      {blocchi.map((b, i) => {
        switch (b.tipo) {
          case 'sezione':
            return (
              <div key={i} className="report-sezione">
                <h2>{b.titolo}</h2>
                {b.nota && <p className="muted">{b.nota}</p>}
              </div>
            )
          case 'sottotitolo':
            return (
              <h3 key={i} className="report-sottotitolo">
                {b.testo}
              </h3>
            )
          case 'numeri':
            return (
              <div key={i} className="accessi-numeri report-numeri">
                {b.voci.map((v) => {
                  const esito = v.confronto ? esitoConfronto(v.confronto, v.buonoSeCala) : 'neutro'
                  const sotto = v.confronto ? testoConfronto(v.confronto) : v.sotto
                  return (
                    <div key={v.etichetta} className="accessi-numero">
                      <span className="accessi-numero-etichetta muted">{v.etichetta}</span>
                      <strong className="accessi-numero-valore">{v.valore}</strong>
                      <span className="accessi-numero-sotto">
                        {sotto &&
                          (v.confronto ? (
                            <span className={`accessi-delta accessi-delta-${esito === 'buono' ? 'su' : esito === 'cattivo' ? 'giu' : 'piano'}`}>
                              {sotto}
                            </span>
                          ) : (
                            <span className="muted">{sotto}</span>
                          ))}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          case 'tabella':
            return (
              <div key={i} className="tabella-wrap">
                <table className="tabella">
                  <thead>
                    <tr>
                      {b.colonne.map((c) => (
                        <th key={c.titolo} className={c.destra ? 'accessi-num' : undefined}>
                          {c.titolo}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.righe.map((r, j) => (
                      <tr key={j}>
                        {r.map((cella, k) => (
                          <td key={k} className={b.colonne[k]?.destra ? 'accessi-num' : undefined}>
                            {cella}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {b.totale && (
                      <tr className="report-totale">
                        {b.totale.map((cella, k) => (
                          <td key={k} className={b.colonne[k]?.destra ? 'accessi-num' : undefined}>
                            <strong>{cella}</strong>
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )
          case 'barre':
            return (
              <BarreOrizzontali
                key={i}
                percentuale
                formato={b.formato === 'euro' ? euroInteroIt : numeroIt}
                voci={b.voci.map((v) => ({ chiave: v.etichetta, etichetta: v.etichetta, valore: v.valore, colore: COLORE[b.colore] }))}
                vuoto="Nessun dato nel periodo."
              />
            )
          case 'colonne':
            return <Colonne key={i} etichette={b.etichette} serie={b.serie} />
          case 'nota':
            return (
              <p key={i} className="muted report-nota">
                {b.testo}
              </p>
            )
        }
      })}
    </div>
  )
}
