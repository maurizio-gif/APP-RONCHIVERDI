'use client'

import { useState, useTransition } from 'react'
import { annullaVoucher, rimandaEmail } from './actions'

// I due comandi su un voucher già emesso. Stanno in un componente client
// perché servono lo stato "in corso" e la conferma sull'annullamento, che è
// l'unica azione che il socio non può vedere arrivare.
export function AzioniVoucher({
  id,
  codice,
  annullabile,
  rimandabile,
  puoCancellare,
}: {
  id: string
  codice: string
  annullabile: boolean
  rimandabile: boolean
  puoCancellare: boolean
}) {
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function esegui(azione: () => Promise<{ ok: boolean; errore?: string }>) {
    setErrore(null)
    startTransition(async () => {
      const esito = await azione()
      if (!esito.ok) setErrore(esito.errore ?? 'Operazione non riuscita.')
    })
  }

  return (
    <div className="voce-azioni">
      {rimandabile && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={inCorso}
          onClick={() => esegui(() => rimandaEmail(id))}
        >
          {inCorso ? '…' : 'Rimanda email'}
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
            if (!confirm(`Annullare il voucher ${codice}? Il socio non potrà più usarlo.`)) return
            esegui(() => annullaVoucher(id))
          }}
        >
          Annulla
        </button>
      )}

      {errore && <p className="error-banner">{errore}</p>}
    </div>
  )
}
