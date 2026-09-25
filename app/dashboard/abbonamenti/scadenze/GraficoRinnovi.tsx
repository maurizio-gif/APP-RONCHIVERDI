import { euro } from '@/lib/pipeline'

type RigaPerTorta = { rinnovato: boolean; in_trattativa: boolean; totale: number | null }

type Fetta = {
  chiave: 'ok' | 'info' | 'warn'
  etichetta: string
  righe: RigaPerTorta[]
}

// La torta del mese: tre fette invece di due — chi ha già rinnovato, chi non
// ha ancora rinnovato ma ci si sta lavorando ("in trattativa", il flag
// manuale di actions.ts) e chi non ha ancora rinnovato e basta, senza
// nessuno che se ne stia occupando. Sono tre situazioni diverse per la
// responsabile del rinnovo — "fatto", "in corso", "da prendere in carico" —
// e appiattirle in un binario rinnovato/non rinnovato nasconderebbe proprio
// la domanda che la torta deve rispondere: quanto lavoro resta scoperto.
//
// Un SVG scritto a mano (tre archi via stroke-dasharray su due <circle>
// concentrici, nessuna libreria di grafici) perché la forma è fissa e
// semplicissima.
export function GraficoRinnovi({ righe }: { righe: RigaPerTorta[] }) {
  const totaleRighe = righe.length
  if (totaleRighe === 0) return null

  const fette: Fetta[] = [
    { chiave: 'ok', etichetta: 'Rinnovati', righe: righe.filter((r) => r.rinnovato) },
    {
      chiave: 'info',
      etichetta: 'In trattativa',
      righe: righe.filter((r) => !r.rinnovato && r.in_trattativa),
    },
    {
      chiave: 'warn',
      etichetta: 'Da riprendere',
      righe: righe.filter((r) => !r.rinnovato && !r.in_trattativa),
    },
  ]

  // Raggio 15.9155 → circonferenza esattamente 100: ogni stroke-dasharray si
  // esprime direttamente in punti percentuali, come nelle "torte in CSS" via
  // <circle>, senza calcolare seno e coseno per un path.
  const raggio = 15.9155
  const circonferenza = 2 * Math.PI * raggio

  let percorsi = 0 // punti percentuali già disegnati, per lo stroke-dashoffset della fetta successiva

  return (
    <div className="grafico-rinnovi">
      <svg
        viewBox="0 0 36 36"
        className="grafico-rinnovi-torta"
        role="img"
        aria-label={fette
          .map((f) => `${Math.round((f.righe.length / totaleRighe) * 100)}% ${f.etichetta.toLowerCase()}`)
          .join(', ')}
      >
        <circle cx="18" cy="18" r={raggio} className="grafico-rinnovi-sfondo" />
        {fette.map((f) => {
          if (f.righe.length === 0) return null
          const quota = (f.righe.length / totaleRighe) * circonferenza
          const offset = -percorsi
          percorsi += quota
          return (
            <circle
              key={f.chiave}
              cx="18"
              cy="18"
              r={raggio}
              className={`grafico-rinnovi-fetta-${f.chiave}`}
              strokeDasharray={`${quota} ${circonferenza}`}
              strokeDashoffset={offset}
              transform="rotate(-90 18 18)"
            />
          )
        })}
        <text x="18" y="17" textAnchor="middle" className="grafico-rinnovi-totale-numero">
          {totaleRighe}
        </text>
        <text x="18" y="23.5" textAnchor="middle" className="grafico-rinnovi-totale-etichetta">
          in scadenza
        </text>
      </svg>

      <dl className="grafico-rinnovi-legenda">
        {fette.map((f) => {
          const percento = Math.round((f.righe.length / totaleRighe) * 100)
          const valore = f.righe.reduce((a, r) => a + (r.totale ?? 0), 0)
          return (
            <div className="grafico-rinnovi-voce" key={f.chiave}>
              <dt>
                <span className={`grafico-rinnovi-pallino grafico-rinnovi-pallino-${f.chiave}`} aria-hidden="true" />
                {f.etichetta}
              </dt>
              <dd>
                <strong>
                  {f.righe.length} · {percento}%
                </strong>
                <span className="muted"> — {euro(valore) ?? '—'}</span>
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}
