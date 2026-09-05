'use client'

import { useRef, useState, useTransition } from 'react'
import { MESI_VALIDITA, SOGLIA_VISITA_INCLUSA_EURO } from '@/lib/voucher'
import { creaVoucher } from './actions'

// L'emissione a mano: per ora il trigger è questo form: la segreteria
// registra il socio che ha comprato l'abbonamento oltre soglia e il resto
// (codice, email, tracciamento) va da sé. Quando arriverà l'estrazione
// notturna dal gestionale scriverà sulla stessa tabella, e questo form
// resterà per i casi fuori flusso.
export function NuovoVoucher() {
  const [aperto, setAperto] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [fatto, setFatto] = useState<{ messaggio: string; avviso?: string } | null>(null)
  const [inCorso, startTransition] = useTransition()
  const form = useRef<HTMLFormElement>(null)

  function invia(formData: FormData) {
    setErrore(null)
    setFatto(null)
    startTransition(async () => {
      const esito = await creaVoucher(formData)
      if (!esito.ok) {
        setErrore(esito.errore)
        return
      }
      // Il form si svuota e resta aperto: i voucher si emettono a gruppetti,
      // e riaprirlo per ogni socio della lista sarebbe un click di troppo.
      form.current?.reset()
      setFatto({ messaggio: esito.messaggio, avviso: esito.avviso })
    })
  }

  if (!aperto) {
    return (
      <button type="button" className="btn" onClick={() => setAperto(true)}>
        Emetti un voucher
      </button>
    )
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Nuovo voucher</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAperto(false)}>
          Chiudi
        </button>
      </div>

      <p className="muted" style={{ marginBottom: '1rem' }}>
        Per i soci con abbonamento oltre €{SOGLIA_VISITA_INCLUSA_EURO.toLocaleString('it-IT')}: la
        visita è inclusa. Il codice parte subito per email e vale {MESI_VALIDITA} mesi.
      </p>

      {errore && <p className="error-banner">{errore}</p>}
      {fatto && (
        <>
          <p className="ok-banner">{fatto.messaggio}</p>
          {fatto.avviso && <p className="error-banner">{fatto.avviso}</p>}
        </>
      )}

      <form action={invia} ref={form}>
        <div className="form-row">
          <div className="field">
            <label htmlFor="nome">Nome</label>
            <input id="nome" name="nome" type="text" required autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="cognome">Cognome</label>
            <input id="cognome" name="cognome" type="text" required autoComplete="off" />
          </div>
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="off" />
            <p className="field-hint">Il voucher arriva qui: controlla che sia quella giusta.</p>
          </div>
          <div className="field">
            <label htmlFor="telefono">Telefono</label>
            <input id="telefono" name="telefono" type="tel" autoComplete="off" />
          </div>
        </div>

        <div className="form-row">
          <div className="field" style={{ flexBasis: '100%' }}>
            <label htmlFor="note">Note interne</label>
            <input
              id="note"
              name="note"
              type="text"
              autoComplete="off"
              placeholder="es. contratto n. 1234 · Club Full"
            />
            <p className="field-hint">Restano nel pannello: il socio non le vede.</p>
          </div>
        </div>

        <button type="submit" className="btn" disabled={inCorso}>
          {inCorso ? 'Emissione…' : 'Emetti e invia per email'}
        </button>
      </form>
    </div>
  )
}
