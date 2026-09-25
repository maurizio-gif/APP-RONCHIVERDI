import { euro } from '@/lib/pipeline'

type RigaPerTorta = {
  rinnovato: boolean
  stato_manuale: 'in_trattativa' | 'perso' | null
  totale: number | null
  escluso_da_report: boolean
}

function somma(righe: RigaPerTorta[]): number {
  return righe.reduce((a, r) => a + (r.totale ?? 0), 0)
}

// La domanda che la torta deve rispondere è "chi ha rinnovato, chi no e chi va
// tolto dal conto" — tre fette, non due: un abbonamento escluso non è né un
// rinnovato né un non-rinnovato, è fuori dal conteggio (vedi
// impostaEsclusoReport in actions.ts), ma resta visibile e verificabile, qui
// come altrove. "In trattativa" e "Perso" restano a parte, come due numeri a
// fianco (sottoinsiemi dei non rinnovati non esclusi), non come area della
// torta: una quarta fetta avrebbe spezzato proprio il dato che conta di più.
//
// Un SVG scritto a mano (tre archi via stroke-dasharray su un <circle>,
// nessuna libreria di grafici) perché la forma è fissa e semplicissima.
export function GraficoRinnovi({ righe }: { righe: RigaPerTorta[] }) {
  const totaleRighe = righe.length
  if (totaleRighe === 0) return null

  const esclusi = righe.filter((r) => r.escluso_da_report)
  const attivi = righe.filter((r) => !r.escluso_da_report)
  const rinnovati = attivi.filter((r) => r.rinnovato)
  const nonRinnovati = attivi.filter((r) => !r.rinnovato)
  const inTrattativa = nonRinnovati.filter((r) => r.stato_manuale === 'in_trattativa')
  const persi = nonRinnovati.filter((r) => r.stato_manuale === 'perso')

  const percentoRinnovati = Math.round((rinnovati.length / totaleRighe) * 100)
  const percentoNonRinnovati = Math.round((nonRinnovati.length / totaleRighe) * 100)
  // L'ultima fetta prende il resto, non un terzo arrotondamento a parte: così
  // le tre percentuali sommano sempre 100, qualunque sia la deriva dei singoli
  // arrotondamenti.
  const percentoEsclusi = 100 - percentoRinnovati - percentoNonRinnovati

  // Raggio 15.9155 → circonferenza esattamente 100: ogni stroke-dasharray si
  // esprime direttamente in punti percentuali, come nelle "torte in CSS" via
  // <circle>, senza calcolare seno e coseno per un path.
  const raggio = 15.9155
  const circonferenza = 2 * Math.PI * raggio
  const quotaRinnovati = (rinnovati.length / totaleRighe) * circonferenza
  const quotaNonRinnovati = (nonRinnovati.length / totaleRighe) * circonferenza
  const quotaEsclusi = (esclusi.length / totaleRighe) * circonferenza

  return (
    <div className="grafico-rinnovi">
      <svg
        viewBox="0 0 36 36"
        className="grafico-rinnovi-torta"
        role="img"
        aria-label={`${percentoRinnovati}% rinnovati, ${percentoNonRinnovati}% non ancora rinnovati, ${percentoEsclusi}% esclusi`}
      >
        <circle cx="18" cy="18" r={raggio} className="grafico-rinnovi-sfondo" />
        {rinnovati.length > 0 && (
          <circle
            cx="18"
            cy="18"
            r={raggio}
            className="grafico-rinnovi-fetta-ok"
            strokeDasharray={`${quotaRinnovati} ${circonferenza}`}
            transform="rotate(-90 18 18)"
          />
        )}
        {nonRinnovati.length > 0 && (
          <circle
            cx="18"
            cy="18"
            r={raggio}
            className="grafico-rinnovi-fetta-warn"
            strokeDasharray={`${quotaNonRinnovati} ${circonferenza}`}
            strokeDashoffset={-quotaRinnovati}
            transform="rotate(-90 18 18)"
          />
        )}
        {esclusi.length > 0 && (
          <circle
            cx="18"
            cy="18"
            r={raggio}
            className="grafico-rinnovi-fetta-escluso"
            strokeDasharray={`${quotaEsclusi} ${circonferenza}`}
            strokeDashoffset={-(quotaRinnovati + quotaNonRinnovati)}
            transform="rotate(-90 18 18)"
          />
        )}
        <text x="18" y="17" textAnchor="middle" className="grafico-rinnovi-totale-numero">
          {totaleRighe}
        </text>
        <text x="18" y="23.5" textAnchor="middle" className="grafico-rinnovi-totale-etichetta">
          in scadenza
        </text>
      </svg>

      <dl className="grafico-rinnovi-legenda">
        <div className="grafico-rinnovi-voce">
          <dt>
            <span className="grafico-rinnovi-pallino grafico-rinnovi-pallino-ok" aria-hidden="true" />
            Rinnovati
          </dt>
          <dd>
            <strong>
              {rinnovati.length} · {percentoRinnovati}%
            </strong>
            <span className="muted"> — {euro(somma(rinnovati)) ?? '—'}</span>
          </dd>
        </div>
        <div className="grafico-rinnovi-voce">
          <dt>
            <span className="grafico-rinnovi-pallino grafico-rinnovi-pallino-warn" aria-hidden="true" />
            Non ancora rinnovati
          </dt>
          <dd>
            <strong>
              {nonRinnovati.length} · {percentoNonRinnovati}%
            </strong>
            <span className="muted"> — {euro(somma(nonRinnovati)) ?? '—'}</span>
          </dd>
        </div>
        <div className="grafico-rinnovi-voce">
          <dt>
            <span className="grafico-rinnovi-pallino grafico-rinnovi-pallino-escluso" aria-hidden="true" />
            Esclusi
          </dt>
          <dd>
            <strong>
              {esclusi.length} · {percentoEsclusi}%
            </strong>
            <span className="muted"> — {euro(somma(esclusi)) ?? '—'}</span>
          </dd>
        </div>
      </dl>

      {/* A fianco della torta, non dentro: sono un dettaglio dei "non ancora
          rinnovati" sopra (che a loro volta escludono già gli esclusi), non
          una categoria allo stesso livello. */}
      <dl className="grafico-rinnovi-dettaglio">
        <div className="grafico-rinnovi-voce">
          <dt>
            <span className="grafico-rinnovi-pallino grafico-rinnovi-pallino-info" aria-hidden="true" />
            In trattativa
          </dt>
          <dd>
            <strong>{inTrattativa.length}</strong>
            <span className="muted"> — {euro(somma(inTrattativa)) ?? '—'}</span>
          </dd>
        </div>
        <div className="grafico-rinnovi-voce">
          <dt>
            <span className="grafico-rinnovi-pallino grafico-rinnovi-pallino-perso" aria-hidden="true" />
            Perso
          </dt>
          <dd>
            <strong>{persi.length}</strong>
            <span className="muted"> — {euro(somma(persi)) ?? '—'}</span>
          </dd>
        </div>
      </dl>
    </div>
  )
}
