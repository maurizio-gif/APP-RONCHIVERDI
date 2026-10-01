import Link from 'next/link'
import { nomePersona } from '@/lib/persone'
import { CLASSE_RIGA_STATO, eChiusa } from '@/lib/pipeline'
import { CLASSE_URGENZA, fraseAttesa, giorniDa, urgenzaAttesa } from '@/lib/attesa'
import { CLASSE_TIPO, ETICHETTE_TIPO_BREVI } from '@/lib/agenda'
import { provenienzaTrattativa } from '@/lib/provenienza'
import { ComandiLead } from './ComandiLead'
import type { TrattativaConPersona } from './TrattativeDashboard'

// I lead in dashboard, sul modello di Passion: una striscia per lead con
// chi è, da dove arriva, da quanto aspetta, e a destra le due tendine
// (in carico a, stato) e «Apri scheda». Le azioni si gestiscono nella scheda.
export function ElencoLead({
  lead,
  io,
  commerciali,
  nomiStaff,
  sonoCommerciale,
  possoRiassegnare,
}: {
  lead: TrattativaConPersona[]
  io: string | null
  commerciali: string[]
  nomiStaff: Record<string, string>
  sonoCommerciale: boolean
  possoRiassegnare: boolean
}) {
  return (
    <ul className="lead-elenco">
      {lead.map((t) => {
        const provenienza = provenienzaTrattativa({
          origineRichiesta: t.evento?.origine,
          origineTrattativa: t.origine,
          haRichiesta: !!t.evento,
        })
        const giorni = !eChiusa(t.stato) ? giorniDa(t.creatoIl) : null
        const tipo = t.tourInSede ? 'appuntamento_in_sede' : t.evento?.tipo
        const interesse = t.evento?.attivita || t.evento?.messaggio
        return (
          <li key={t.id} className={`lead-riga riga-stato ${CLASSE_RIGA_STATO[t.stato]}`}>
            <div className="lead-testo">
              <div className="azione-titolo">
                <span className="azione-nome">{nomePersona(t) || 'Senza nome'}</span>
                <span className={`tag-provenienza ${provenienza.classe}`}>{provenienza.etichetta}</span>
                {tipo && <span className={`badge-tipo ${CLASSE_TIPO[tipo]}`}>{ETICHETTE_TIPO_BREVI[tipo]}</span>}
                {giorni !== null && (
                  <span className={`attesa ${CLASSE_URGENZA[urgenzaAttesa(giorni)]}`}>
                    {fraseAttesa(giorni, 'aperta')}
                  </span>
                )}
              </div>
              {interesse && <div className="azione-dettaglio muted">{interesse}</div>}
            </div>
            <ComandiLead
              id={t.id}
              stato={t.stato}
              assegnatoA={t.assegnato_a}
              io={io}
              commerciali={commerciali}
              nomiStaff={nomiStaff}
              sonoCommerciale={sonoCommerciale}
              possoRiassegnare={possoRiassegnare}
            />
            {t.personaId && (
              <Link className="btn btn-ghost btn-sm" href={`/dashboard/persone/${t.personaId}`} target="_blank">
                Apri scheda ↗
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}
