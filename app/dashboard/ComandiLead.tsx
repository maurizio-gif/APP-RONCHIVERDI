'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  DOMANDA_MOTIVO,
  ETICHETTE_STATO,
  STATI,
  chiedeMotivo,
  chiedeValore,
  puoAnnullare,
  puoAssegnare,
  valoreDaTesto,
  type StatoTrattativa,
} from '@/lib/pipeline'
import { nomeDiEmail } from '@/lib/staff'
import { assegnaTrattativa, cambiaStato } from './richieste/trattativa-actions'

// Assegnare e cambiare stato a un lead, senza aprire niente: due tendine.
// Gli stati che chiedono una nota (vinta, persa, annullata) aprono sotto
// la casella e il bottone per confermare.
export function ComandiLead({
  id,
  stato,
  assegnatoA,
  io,
  commerciali,
  nomiStaff,
  sonoCommerciale,
  possoRiassegnare,
}: {
  id: string
  stato: StatoTrattativa
  assegnatoA: string | null
  io: string | null
  commerciali: string[]
  nomiStaff: Record<string, string>
  sonoCommerciale: boolean
  possoRiassegnare: boolean
}) {
  const router = useRouter()
  const [inCorso, avvia] = useTransition()
  const [errore, setErrore] = useState<string | null>(null)
  const [scelto, setScelto] = useState<StatoTrattativa | null>(null)
  const [motivo, setMotivo] = useState('')
  const [valore, setValore] = useState('')

  const diritti = { assegnatoA, io, sonoCommerciale, possoRiassegnare }
  const puo = puoAssegnare(diritti)
  const puoStato = puo || puoAnnullare(diritti)
  // Chi non è fra i commerciali ma ha già il lead resta scelto in tendina.
  const persone = assegnatoA && !commerciali.includes(assegnatoA) ? [assegnatoA, ...commerciali] : commerciali

  function esegui(fn: () => Promise<{ ok: boolean; errore?: string }>) {
    setErrore(null)
    avvia(async () => {
      const r = await fn()
      if (!r.ok) {
        setErrore(r.errore ?? 'Non riuscito. Riprova.')
        return
      }
      setScelto(null)
      setMotivo('')
      setValore('')
      router.refresh()
    })
  }

  function sceltoStato(nuovo: StatoTrattativa) {
    if (nuovo === stato) return setScelto(null)
    if (chiedeMotivo(nuovo)) return setScelto(nuovo)
    esegui(() => cambiaStato(id, nuovo))
  }

  return (
    <div className="lead-comandi">
      <select
        aria-label="In carico a"
        value={assegnatoA ?? ''}
        disabled={!puo || inCorso}
        onChange={(e) => esegui(() => assegnaTrattativa(id, e.target.value || null))}
      >
        <option value="">Nessuno</option>
        {persone.map((p) => (
          <option key={p} value={p}>
            {p === io ? 'Io' : (nomeDiEmail(p, nomiStaff) ?? p)}
          </option>
        ))}
      </select>
      <select
        aria-label="Stato"
        value={scelto ?? stato}
        disabled={!puoStato || inCorso}
        onChange={(e) => sceltoStato(e.target.value as StatoTrattativa)}
      >
        {STATI.map((s) => (
          <option key={s} value={s}>
            {ETICHETTE_STATO[s]}
          </option>
        ))}
      </select>

      {scelto && (
        <div className="lead-chiusura">
          <input
            type="text"
            placeholder={DOMANDA_MOTIVO[scelto]}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            disabled={inCorso}
            autoFocus
          />
          {chiedeValore(scelto) && (
            <input
              type="text"
              inputMode="decimal"
              placeholder="€"
              className="lead-valore"
              value={valore}
              onChange={(e) => setValore(e.target.value)}
              disabled={inCorso}
            />
          )}
          <button
            className="btn btn-sm"
            disabled={inCorso || !motivo.trim()}
            onClick={() => esegui(() => cambiaStato(id, scelto, motivo, valore ? valoreDaTesto(valore) : null))}
          >
            Salva
          </button>
          <button className="btn btn-ghost btn-sm" disabled={inCorso} onClick={() => setScelto(null)}>
            Annulla
          </button>
        </div>
      )}
      {errore && <div className="azione-errore">{errore}</div>}
    </div>
  )
}
