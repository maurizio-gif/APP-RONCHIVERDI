'use client'

import { useState, useTransition } from 'react'
import { leggiLeadMeta } from '@/lib/leadMeta'
import { caricaLeadMeta } from './actions'

// Un riquadro per incollare e un campo per la campagna. L'anteprima dice
// quante righe ha capito (e quali scarta) prima di salvare: l'esportazione di
// Meta cambia colonne da un modulo all'altro, e scoprirlo dopo il salvataggio
// vorrebbe dire lead senza nome o senza telefono già in carico a qualcuno.
export function CaricaLeadMetaForm() {
  const [testo, setTesto] = useState('')
  const [giro, setGiro] = useState(0)
  const [errore, setErrore] = useState<string | null>(null)
  const [avviso, setAvviso] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  const lettura = testo.trim() ? leggiLeadMeta(testo) : null

  function invia(formData: FormData) {
    setErrore(null)
    setAvviso(null)
    startTransition(async () => {
      const esito = await caricaLeadMeta(formData)
      if (!esito.ok) {
        setErrore(esito.errore)
        return
      }
      setTesto('')
      setGiro((g) => g + 1)
      const parti = [`${esito.inseriti} lead caricati`]
      if (esito.giaPresenti) parti.push(`${esito.giaPresenti} già presenti, saltati`)
      if (esito.scartate.length) parti.push(`${esito.scartate.length} righe scartate`)
      setAvviso(parti.join(' · ') + '.')
    })
  }

  return (
    <>
      {avviso && (
        <p className="info-banner" role="status">
          {avviso}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAvviso(null)}>
            Ho capito
          </button>
        </p>
      )}
      {errore && (
        <p className="error-banner" role="alert">
          {errore}
        </p>
      )}

      <form action={invia} key={giro} className="card">
        <div className="card-head">
          <h2>Carica i lead</h2>
        </div>

        <div className="field">
          <label htmlFor="campagna">Campagna</label>
          <input
            id="campagna"
            name="campagna"
            type="text"
            placeholder="Es. Open day novembre"
            autoComplete="off"
          />
          <p className="field-hint">
            Il nome della sponsorizzata: finisce nelle statistiche del traffico. Se incolli
            l&apos;esportazione di Meta con la colonna <code>campaign_name</code> si usa quella.
          </p>
        </div>

        <div className="field">
          <label htmlFor="testo">Lead (uno per riga)</label>
          <textarea
            id="testo"
            name="testo"
            rows={10}
            required
            value={testo}
            onChange={(e) => setTesto(e.target.value)}
            placeholder={'Mario\tRossi\tmario@email.it\t+39 333 1234567'}
            spellCheck={false}
          />
          <p className="field-hint">
            Copia le righe da Excel / Fogli Google, oppure incolla l&apos;esportazione CSV di
            Meta (Gestione lead → Scarica) con la sua riga di intestazione. Senza intestazione
            l&apos;ordine è: <strong>nome, cognome, email, cellulare</strong>.
          </p>
        </div>

        {lettura && (
          <p className="field-hint" role="status">
            Ho letto <strong>{lettura.righe.length}</strong> lead
            {lettura.scartate.length > 0 && (
              <>
                {' '}e scarto {lettura.scartate.length}: {lettura.scartate.slice(0, 3).join(' · ')}
                {lettura.scartate.length > 3 ? ' …' : ''}
              </>
            )}
            .
          </p>
        )}

        <button type="submit" className="btn btn-primary" disabled={inCorso || !lettura?.righe.length}>
          {inCorso ? 'Carico…' : `Carica ${lettura?.righe.length ?? ''} lead`.trim()}
        </button>
      </form>
    </>
  )
}
