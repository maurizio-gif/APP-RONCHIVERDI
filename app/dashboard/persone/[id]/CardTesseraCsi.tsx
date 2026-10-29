import { dataIt, descriviTessera, giorniA, oggiRoma, type TesseraCsi } from '@/lib/tesseramenti'

// Il tesseramento CSI in corso, nella scheda della persona: numero di tessera,
// tipo, stagione e date. Si mostra solo se c'è una tessera non scaduta (vista
// tessere_csi_attive, legata alla persona per codice fiscale).
export function CardTesseraCsi({ tessera }: { tessera: TesseraCsi | null }) {
  if (!tessera) return null
  const giorni = tessera.scadenza ? giorniA(tessera.scadenza, oggiRoma()) : null
  return (
    <div className="card">
      <div className="card-head">
        <h2>Tesseramento CSI</h2>
        <span className={`badge ${giorni != null && giorni <= 30 ? 'badge-warn' : 'badge-ok'}`}>
          {giorni != null && giorni <= 30 ? `Scade tra ${giorni} gg` : 'In corso'}
        </span>
      </div>
      <ul className="storia">
        <li>
          <strong>Tessera {tessera.tessera}</strong>
          <div className="storia-testo muted">{descriviTessera(tessera)}</div>
          <div className="storia-testo muted">
            Stagione {tessera.stagione} · rilasciata il {dataIt(tessera.rilascio)} · scade il {dataIt(tessera.scadenza)}
          </div>
        </li>
      </ul>
    </div>
  )
}
