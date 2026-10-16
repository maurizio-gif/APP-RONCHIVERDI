'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apriTicket } from '../actions'
import { SceltaAllegati, useAllegati } from '../Allegati'
import { CampoNote } from '@/components/CampoNote'

// Il modulo per aprire un ticket: dove (fra le sezioni del proprio menu),
// cosa, e una descrizione analitica — chi, quando, un paio di esempi.

export function NuovoTicket({ sezioni }: { sezioni: { chiave: string; label: string }[] }) {
  const router = useRouter()
  const allegati = useAllegati()
  const [sezione, setSezione] = useState('')
  const [titolo, setTitolo] = useState('')
  const [descrizione, setDescrizione] = useState('')
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, setInCorso] = useState(false)

  async function invia(e: React.FormEvent) {
    e.preventDefault()
    setErrore(null)
    setInCorso(true)
    try {
      const caricati = await allegati.carica()
      const esito = await apriTicket({ sezione, titolo, descrizione, allegati: caricati })
      if (!esito.ok) {
        setErrore(esito.errore)
        setInCorso(false)
        return
      }
      router.push(`/dashboard/ticket/${esito.id}?aperto=1`)
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'Qualcosa è andato storto. Riprova.')
      setInCorso(false)
    }
  }

  return (
    <form className="card tk-form" onSubmit={invia}>
      <div className="field">
        <label htmlFor="tk-sezione">Dove si presenta il problema</label>
        <select id="tk-sezione" value={sezione} onChange={(e) => setSezione(e.target.value)}>
          <option value="">In generale / non legato a una sezione</option>
          {sezioni.map((s) => (
            <option key={s.chiave} value={s.chiave}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="tk-titolo">In breve</label>
        <input
          id="tk-titolo"
          value={titolo}
          onChange={(e) => setTitolo(e.target.value)}
          maxLength={160}
          placeholder="es. Nella scheda di un contatto non vedo l’abbonamento"
          required
        />
      </div>

      <div className="tk-guida">
        <b>Come descrivere il problema</b>
        <ul>
          <li>
            Sii <strong>analitico</strong>: cosa stavi facendo, cosa ti aspettavi, cosa è successo invece.
          </li>
          <li>
            Se riguarda una persona, scrivi <strong>sempre nome e cognome</strong> (cliente, socio o collega).
          </li>
          <li>
            Metti <strong>un paio di esempi</strong>: due nomi, due date, due richieste in cui succede.
          </li>
          <li>Se puoi, allega uno screenshot: vale più di molte parole.</li>
        </ul>
      </div>

      <div className="field">
        <label htmlFor="tk-descrizione">Descrizione</label>
        <CampoNote
          id="tk-descrizione"
          rows={8}
          value={descrizione}
          onChange={(e) => setDescrizione(e.target.value)}
          maxLength={8000}
          placeholder={
            'es. Nella scheda di Mario Rossi non compare l’abbonamento Gold venduto ieri.\n' +
            'Succede anche con Laura Bianchi (vendita del 14/10).\n' +
            'Mi aspettavo di vederlo nel riquadro Abbonamenti.'
          }
          required
        />
        <span className="muted tk-conta">{descrizione.trim().length < 30 ? 'Almeno qualche riga, con nomi ed esempi' : ' '}</span>
      </div>

      <SceltaAllegati allegati={allegati} disabilitato={inCorso} />

      {errore && <p className="error-banner">{errore}</p>}

      <div className="tk-invia">
        <button type="submit" className="btn" disabled={inCorso}>
          {inCorso ? 'Invio in corso…' : 'Apri il ticket'}
        </button>
        <span className="muted">Lo riceve Simone, che ti risponde qui nel CRM.</span>
      </div>
    </form>
  )
}
