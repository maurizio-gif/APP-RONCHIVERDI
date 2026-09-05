'use client'

import { useState, useTransition } from 'react'
import { dataOraRoma, dataRoma } from '@/lib/voucher'
import { usaCodice, verificaCodice, type Verifica } from './actions'

// Una cella e un pulsante: è tutto quello che serve a chi risponde al
// telefono al centro medico. La verifica è separata dall'utilizzo perché la
// bruciatura è irreversibile — prima si legge a chi è intestato e si conferma
// con il socio, poi si spende.

const COLORE_STATO: Record<Verifica['stato'], string> = {
  attivo: 'badge badge-ok',
  utilizzato: 'badge',
  annullato: 'badge badge-off',
  scaduto: 'badge badge-warn',
  inesistente: 'badge badge-ko',
}

export function Validatore() {
  const [codice, setCodice] = useState('')
  const [verifica, setVerifica] = useState<Verifica | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [usato, setUsato] = useState<{ codice: string; intestatario: string; quando: string } | null>(null)
  const [inCorso, startTransition] = useTransition()

  function pulisci() {
    setVerifica(null)
    setErrore(null)
    setUsato(null)
  }

  function controlla(e: React.FormEvent) {
    e.preventDefault()
    pulisci()
    startTransition(async () => {
      const esito = await verificaCodice(codice)
      if ('errore' in esito) setErrore(esito.errore)
      else setVerifica(esito)
    })
  }

  function conferma() {
    setErrore(null)
    startTransition(async () => {
      const esito = await usaCodice(codice)
      if (!esito.ok) {
        setErrore(esito.errore)
        // Lo stato mostrato è ormai vecchio: si rilegge, così la pagina non
        // continua a proporre il pulsante su un codice appena bruciato.
        const aggiornata = await verificaCodice(codice)
        if (!('errore' in aggiornata)) setVerifica(aggiornata)
        return
      }
      setVerifica(null)
      setUsato(esito)
      setCodice('')
    })
  }

  return (
    <>
      <form onSubmit={controlla}>
        <div className="field">
          <label htmlFor="codice">Codice del voucher</label>
          <input
            id="codice"
            name="codice"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            placeholder="1234 5678"
            value={codice}
            onChange={(e) => {
              setCodice(e.target.value)
              pulisci()
            }}
            style={{ fontSize: '1.4rem', letterSpacing: '0.12em' }}
          />
          <p className="field-hint">Le cifre che ti detta il socio: spazi e trattini non contano.</p>
        </div>

        <button type="submit" className="btn btn-block" disabled={inCorso || !codice.trim()}>
          {inCorso ? 'Controllo…' : 'Verifica codice'}
        </button>
      </form>

      {errore && <p className="error-banner" style={{ marginTop: '1rem' }}>{errore}</p>}

      {usato && (
        <div className="card" style={{ marginTop: '1.25rem' }}>
          <p className="ok-banner">Codice {usato.codice} registrato come utilizzato.</p>
          <p className="muted">
            Intestato a <strong>{usato.intestatario}</strong> · {dataOraRoma(usato.quando)}
            <br />
            Il socio ha ricevuto ora la notifica di utilizzo. Ricordati di confermargli per iscritto
            giorno e ora della visita.
          </p>
        </div>
      )}

      {verifica && (
        <div className="card" style={{ marginTop: '1.25rem' }}>
          <div className="card-head">
            <h2 style={{ fontVariantNumeric: 'tabular-nums' }}>{verifica.codice}</h2>
            <span className={COLORE_STATO[verifica.stato]}>{verifica.etichetta}</span>
          </div>

          {verifica.intestatario ? (
            <p className="muted">
              Intestato a <strong>{verifica.intestatario}</strong>
              {verifica.validoFino ? ` · valido fino al ${dataRoma(verifica.validoFino)}` : ''}
              {verifica.utilizzatoIl ? ` · utilizzato il ${dataOraRoma(verifica.utilizzatoIl)}` : ''}
            </p>
          ) : (
            <p className="muted">
              Nessun voucher con questo codice. Fatti ridettare le cifre: se non risulta, la visita
              non è inclusa e il socio la prenota a suo carico.
            </p>
          )}

          {verifica.stato === 'attivo' ? (
            <>
              <p className="muted" style={{ marginTop: '0.75rem' }}>
                Controlla il nominativo con chi è al telefono, poi conferma: il codice si consuma
                subito e non è più riutilizzabile.
              </p>
              <button
                type="button"
                className="btn btn-block"
                style={{ marginTop: '0.75rem' }}
                disabled={inCorso}
                onClick={conferma}
              >
                {inCorso ? 'Registrazione…' : 'Conferma la prenotazione e usa il codice'}
              </button>
            </>
          ) : (
            verifica.stato !== 'inesistente' && (
              <p className="muted" style={{ marginTop: '0.75rem' }}>
                Il codice non è spendibile: la visita non è coperta dal voucher.
              </p>
            )
          )}
        </div>
      )}
    </>
  )
}
