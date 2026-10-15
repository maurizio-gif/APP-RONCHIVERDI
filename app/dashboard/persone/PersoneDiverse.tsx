'use client'

import { useState, useTransition } from 'react'
import { segnaPersoneDiverse } from './actions'

// «Sono persone diverse», accanto alla segnalazione di possibile doppione: il
// genitore che ha compilato il modulo e il figlio che si è iscritto hanno lo
// stesso cognome e lo stesso cellulare, ma sono due persone. Chi lo sa lo
// dice qui una volta, e la segnalazione sparisce da tutte e due le schede.
export function PersoneDiverse({ idConPuntatore, nomeAltra }: { idConPuntatore: string; nomeAltra: string }) {
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, avvia] = useTransition()

  return (
    <>
      <button
        type="button"
        className="link-testo"
        disabled={inCorso}
        onClick={() => {
          if (!confirm(`Confermi che questa scheda e ${nomeAltra} sono due persone diverse?`)) return
          setErrore(null)
          avvia(async () => {
            try {
              const esito = await segnaPersoneDiverse(idConPuntatore)
              if (!esito.ok) setErrore(esito.errore)
            } catch {
              setErrore('Operazione non riuscita: controlla la connessione e riprova.')
            }
          })
        }}
      >
        {inCorso ? 'Salvo…' : 'Sono persone diverse'}
      </button>{' '}
      {errore && <span className="errore-campo">{errore}</span>}
    </>
  )
}
