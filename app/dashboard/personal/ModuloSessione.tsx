'use client'

import { useState, useTransition } from 'react'
import { mancaNomeScritto, primaDataRegistrabile, ultimaDataRegistrabile, type ClienteScelto } from '@/lib/personal'
import { registraSessione } from './actions'
import { SceltaCliente } from './SceltaCliente'
import { SceltaDataOra } from './SceltaDataOra'

// Il modulo del trainer: chi, quando, conferma. Tre blocchi in colonna, uno
// sotto l'altro, perché si compila con il pollice in piedi in sala.
export function ModuloSessione({ oggi }: { oggi: string }) {
  const [cliente, setCliente] = useState<ClienteScelto | null>(null)
  const [quando, setQuando] = useState<{ data: string; ora: string | null }>({ data: oggi, ora: null })
  const [errore, setErrore] = useState<string | null>(null)
  const [fatto, setFatto] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  const nomeCorporateMancante = mancaNomeScritto(cliente)
  const pronto = !!cliente && !nomeCorporateMancante && !!quando.data && !!quando.ora

  function invia() {
    if (!cliente || !quando.ora) return
    setErrore(null)
    setFatto(null)
    startTransition(async () => {
      try {
        const esito = await registraSessione({ cliente, data: quando.data, ora: quando.ora! })
        if (!esito.ok) {
          setErrore(esito.errore)
          return
        }
        // Si riparte da capo, sul giorno di oggi: la prossima sessione è di
        // un altro cliente, e quasi sempre è di oggi.
        setFatto(esito.messaggio)
        setCliente(null)
        setQuando({ data: oggi, ora: null })
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } catch {
        setErrore('Non siamo riusciti a registrare la sessione: controlla la connessione e riprova.')
      }
    })
  }

  return (
    <div className="pt-modulo">
      {fatto && <p className="ok-banner">{fatto}</p>}

      <section className="card pt-blocco">
        <h2 className="pt-blocco-titolo">
          <span className="pt-passo">1</span> Cliente
        </h2>
        <SceltaCliente
          valore={cliente}
          onChange={(c) => {
            setCliente(c)
            setFatto(null)
          }}
        />
      </section>

      <section className="card pt-blocco">
        <h2 className="pt-blocco-titolo">
          <span className="pt-passo">2</span> Quando
        </h2>
        <SceltaDataOra
          data={quando.data}
          ora={quando.ora}
          oggi={oggi}
          min={primaDataRegistrabile(oggi)}
          max={ultimaDataRegistrabile(oggi)}
          onChange={setQuando}
        />
      </section>

      {errore && <p className="error-banner">{errore}</p>}

      <button type="button" className="btn btn-block pt-invia" disabled={!pronto || inCorso} onClick={invia}>
        {inCorso ? 'Registrazione…' : 'Registra sessione'}
      </button>
      {!pronto && (
        <p className="field-hint pt-manca">
          {!cliente
            ? 'Scegli il cliente.'
            : nomeCorporateMancante
              ? cliente.tipo === 'azienda_manuale'
                ? 'Scrivi azienda, nome e cognome di chi si allena.'
                : 'Scrivi nome e cognome di chi si allena.'
              : 'Scegli l’ora d’inizio.'}
        </p>
      )}
    </div>
  )
}
