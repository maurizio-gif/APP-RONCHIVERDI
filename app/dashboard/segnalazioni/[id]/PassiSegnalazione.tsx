'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { passoSegnalazione, type Passo } from '../actions'
import { CampoNote } from '@/components/CampoNote'
import { SceltaFoto, useFoto } from '../Foto'
import type { StatoSegnalazione } from '@/lib/segnalazioni'

// I comandi di una segnalazione. Quello che c'è da fare dipende dallo stato:
// da prendere in carico → in carico → (da richiamare) → risolta. L'assegnazione
// a un collega e la nota valgono sempre finché è aperta.

export function PassiSegnalazione({
  id,
  stato,
  assegnatoA,
  sonoIo,
  operatori,
  richiamoDaFare,
}: {
  id: string
  stato: StatoSegnalazione
  assegnatoA: string | null
  sonoIo: boolean
  operatori: { email: string; nome: string }[]
  richiamoDaFare: boolean
}) {
  const router = useRouter()
  const [testo, setTesto] = useState('')
  const [assegna, setAssegna] = useState(assegnatoA ?? '')
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, setInCorso] = useState<Passo | null>(null)
  const foto = useFoto()

  async function esegui(passo: Passo) {
    setErrore(null)
    setInCorso(passo)
    try {
      // La foto accompagna il passo che la porta (una nota, la risoluzione…):
      // assegnare e prendere in carico non ne hanno.
      const caricate = passo === 'assegna' || passo === 'prendi' ? [] : await foto.carica()
      const esito = await passoSegnalazione(id, passo, testo, passo === 'assegna' ? assegna : undefined, caricate)
      if (!esito.ok) {
        setErrore(esito.errore)
        return
      }
      setTesto('')
      if (caricate.length) foto.svuota()
      router.refresh()
    } catch (e) {
      setErrore(e instanceof Error ? e.message : 'Qualcosa è andato storto. Riprova.')
    } finally {
      setInCorso(null)
    }
  }
  const occupato = (p: Passo, t: string) => (inCorso === p ? '…' : t)
  const chiusa = stato === 'risolta' || stato === 'archiviata'

  return (
    <aside className="card tk-comandi">
      <div className="card-head">
        <h2>Gestione</h2>
      </div>

      {chiusa ? (
        <>
          <p className="muted">{stato === 'risolta' ? 'Segnalazione risolta.' : 'Segnalazione archiviata.'}</p>
          <button type="button" className="btn btn-ghost" onClick={() => esegui('riapri')} disabled={!!inCorso}>
            {occupato('riapri', 'Riaprila')}
          </button>
        </>
      ) : (
        <>
          {stato === 'ricevuta' && (
            <div className="tk-bottoni">
              <button type="button" className="btn" onClick={() => esegui('prendi')} disabled={!!inCorso}>
                {occupato('prendi', sonoIo || !assegnatoA ? 'La prendo in carico' : 'Prendila in carico tu')}
              </button>
            </div>
          )}

          {stato === 'da_richiamare' && (
            <>
              <p>Il problema è sistemato, ma il socio ha chiesto di essere richiamato. Scrivi come è andata la telefonata.</p>
              <CampoNote
                rows={4}
                value={testo}
                onChange={(e) => setTesto(e.target.value)}
                maxLength={4000}
                placeholder="es. Richiamata la sig.ra Rossi: ha ringraziato, il problema non si ripresenta."
                disabled={!!inCorso}
              />
              <SceltaFoto foto={foto} disabilitato={!!inCorso} />
              <div className="tk-bottoni">
                <button type="button" className="btn" onClick={() => esegui('richiamato')} disabled={!!inCorso}>
                  {occupato('richiamato', 'Socio richiamato, chiudi')}
                </button>
              </div>
            </>
          )}

          {(stato === 'ricevuta' || stato === 'in_carico') && (
            <>
              <CampoNote
                rows={4}
                value={testo}
                onChange={(e) => setTesto(e.target.value)}
                maxLength={4000}
                placeholder="Cosa è stato fatto, o una nota…"
                disabled={!!inCorso}
              />
              <SceltaFoto foto={foto} disabilitato={!!inCorso} />
              <div className="tk-bottoni">
                <button type="button" className="btn" onClick={() => esegui('risolvi')} disabled={!!inCorso}>
                  {occupato('risolvi', richiamoDaFare ? 'Risolta, resta da richiamare il socio' : 'Segna come risolta')}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => esegui('nota')} disabled={!!inCorso}>
                  {occupato('nota', 'Salva come nota')}
                </button>
              </div>
            </>
          )}

          <div className="field sg-assegna">
            <label htmlFor="sg-assegna">Assegnata a</label>
            <div className="sg-riga">
              <select id="sg-assegna" value={assegna} onChange={(e) => setAssegna(e.target.value)} disabled={!!inCorso}>
                <option value="">Scegli…</option>
                {operatori.map((o) => (
                  <option key={o.email} value={o.email}>
                    {o.nome}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => esegui('assegna')}
                disabled={!!inCorso || !assegna || assegna === assegnatoA}
              >
                {occupato('assegna', 'Assegna')}
              </button>
            </div>
          </div>

          <div className="tk-bottoni">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => esegui('archivia')} disabled={!!inCorso}>
              {occupato('archivia', 'Archivia (non pertinente o doppia)')}
            </button>
          </div>
          <p className="muted tk-nota-comandi">Per archiviare serve scrivere il perché nel riquadro sopra.</p>
        </>
      )}
      {errore && <p className="error-banner">{errore}</p>}
    </aside>
  )
}
