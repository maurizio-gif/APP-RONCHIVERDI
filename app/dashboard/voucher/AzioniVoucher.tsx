'use client'

import { useState, useTransition } from 'react'
import { annullaVoucher, reinviaEmail } from './actions'

// I comandi su un voucher già emesso. Stanno in un componente client
// perché servono lo stato "in corso" e la conferma sull'annullamento, che è
// l'unica azione che il socio non può vedere arrivare.
export function AzioniVoucher({
  id,
  socio,
  destinatario,
  giaInviata,
  annullabile,
  rimandabile,
  puoCancellare,
}: {
  id: string
  // Il nome e non il codice: il codice lo vede solo il socio.
  socio: string
  destinatario: string
  // L'email è già partita almeno una volta: il comando è un reinvio, non il
  // primo invio.
  giaInviata: boolean
  annullabile: boolean
  rimandabile: boolean
  puoCancellare: boolean
}) {
  const [errore, setErrore] = useState<string | null>(null)
  const [esitoOk, setEsitoOk] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function esegui(azione: () => Promise<{ ok: boolean; errore?: string; messaggio?: string }>) {
    setErrore(null)
    setEsitoOk(null)
    startTransition(async () => {
      const esito = await azione()
      if (!esito.ok) setErrore(esito.errore ?? 'Operazione non riuscita.')
      else if (esito.messaggio) setEsitoOk(esito.messaggio)
    })
  }

  return (
    <div className="voce-azioni">
      {rimandabile && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={inCorso}
          onClick={() => {
            if (!confirm(`Reinviare a ${destinatario} l’email col codice del voucher di ${socio}? Il codice resta lo stesso.`)) return
            esegui(() => reinviaEmail(id))
          }}
        >
          {inCorso ? '…' : giaInviata ? 'Reinvia email' : 'Invia email'}
        </button>
      )}

      {/* L'annullamento è riservato a chi può cancellare, come le altre
          rimozioni del pannello: brucia il diritto del socio a una visita. */}
      {annullabile && puoCancellare && (
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-danger"
          disabled={inCorso}
          onClick={() => {
            if (!confirm(`Annullare il voucher di ${socio}? Non potrà più usarlo.`)) return
            esegui(() => annullaVoucher(id))
          }}
        >
          Annulla
        </button>
      )}

      {esitoOk && <p className="muted" role="status">{esitoOk}</p>}
      {errore && <p className="error-banner">{errore}</p>}
    </div>
  )
}
