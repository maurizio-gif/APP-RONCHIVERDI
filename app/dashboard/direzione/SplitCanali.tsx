import { percentuale } from '@/lib/analytics'
import type { Provenienza } from '@/lib/provenienza'

export type VoceCanale = { provenienza: Provenienza; conteggio: number }

/**
 * Due (o tre) numeri affiancati con la loro quota, più una barra a segmenti
 * proporzionali — per canali di grandezza paragonabile (sito vs in sede). Con
 * un bucket che domina tutti gli altri (vedi "Non attribuito" nelle vendite)
 * la barra diventerebbe un blocco unico: lì si usa invece una tabella (vedi
 * page.tsx).
 */
export function SplitCanali({ voci, totale }: { voci: VoceCanale[]; totale: number }) {
  if (totale === 0) return <p className="muted">Nessun contatto in questo periodo.</p>

  return (
    <div className="split-canali">
      <div className="split-canali-numeri">
        {voci.map(({ provenienza, conteggio }) => (
          <div key={provenienza.chiave} className="split-canali-voce">
            <span className="stat-valore">{conteggio}</span>
            <span className={`tag-provenienza ${provenienza.classe}`}>{provenienza.etichetta}</span>
            <span className="muted">{percentuale(conteggio, totale)}</span>
          </div>
        ))}
      </div>
      <div className="split-canali-barra">
        {voci.map(({ provenienza, conteggio }) => (
          <span
            key={provenienza.chiave}
            className={`split-canali-segmento ${provenienza.classe}`}
            style={{ width: `${(conteggio / totale) * 100}%` }}
          />
        ))}
      </div>
    </div>
  )
}
