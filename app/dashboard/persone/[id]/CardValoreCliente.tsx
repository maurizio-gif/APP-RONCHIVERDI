import { dataBreve } from '@/lib/persone'
import { euro } from '@/lib/pipeline'
import { type ValoreCliente } from '@/lib/valoreCliente'

// Quanto ha speso nel club questa persona, nella scheda contatto. Solo
// presentazione: il calcolo è in lib/valoreCliente.ts. Se non ha mai pagato
// il riquadro non c'è, invece di dire «0 €» a chi è solo un lead.
export function CardValoreCliente({ valore }: { valore: ValoreCliente | null }) {
  if (!valore) return null
  return (
    <div className="card">
      <div className="card-head">
        <h2>Valore cliente</h2>
        <span className="muted">speso nel club</span>
      </div>
      <div className="frequenza-griglia">
        <div className="frequenza-cella">
          <span className="muted frequenza-periodo">Speso in totale</span>
          <strong className="frequenza-numero">{euro(valore.totale)}</strong>
          <span className="muted frequenza-mediana">
            dal {dataBreve(valore.primoAcquisto)} · {valore.pagamenti} pagament{valore.pagamenti === 1 ? 'o' : 'i'}
          </span>
        </div>
        <div className="frequenza-cella">
          <span className="muted frequenza-periodo">Ultimi 12 mesi</span>
          <strong className="frequenza-numero">{euro(valore.ultimi12Mesi)}</strong>
          <span className="muted frequenza-mediana">ultimo acquisto il {dataBreve(valore.ultimoAcquisto)}</span>
        </div>
      </div>
      {valore.perAnno.length > 1 && (
        <>
          <h3 className="frequenza-titolo">Per anno</h3>
          <ul className="storia">
            {valore.perAnno.map((a) => (
              <li key={a.anno}>
                <strong>{a.anno}</strong> · {euro(a.totale)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
