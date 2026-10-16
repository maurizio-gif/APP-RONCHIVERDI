'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { StatoTicket } from '@/lib/ticket'
import { passoTicket, type Passo } from '../actions'
import { SceltaAllegati, useAllegati } from '../Allegati'
import { CampoNote } from '@/components/CampoNote'

// I comandi del ticket, diversi per chi lo legge.
//
// Chi l'ha aperto, davanti a una risposta, deve confermare la lettura in uno
// dei due modi che fanno andare avanti il ticket: «Risolto, chiudi» oppure
// «Rispondi». Finché non lo fa, l'avviso nel CRM resta acceso.
//
// Chi gestisce scrive una volta e sceglie cosa farne: nota interna, risposta
// a chi l'ha aperto, passaggio al secondo livello (o rimando al primo),
// chiusura.

export function PassiTicket({
  ticketId,
  stato,
  livello,
  gestore,
  richiedente,
  motivoDaLeggere,
}: {
  ticketId: string
  stato: StatoTicket
  livello: 1 | 2
  gestore: boolean
  richiedente: boolean
  motivoDaLeggere: string | null
}) {
  const router = useRouter()
  const allegati = useAllegati()
  const [testo, setTesto] = useState('')
  const [scrivo, setScrivo] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, setInCorso] = useState<Passo | null>(null)

  async function esegui(passo: Passo) {
    setErrore(null)
    setInCorso(passo)
    try {
      const caricati = ['nota', 'risposta', 'replica'].includes(passo) ? await allegati.carica() : []
      const esito = await passoTicket(ticketId, passo, testo, caricati)
      if (!esito.ok) {
        setErrore(esito.errore)
        return
      }
      setTesto('')
      setScrivo(false)
      allegati.svuota()
      router.refresh()
    } catch (e) {
      setErrore(e instanceof Error ? e.message : 'Qualcosa è andato storto. Riprova.')
    } finally {
      setInCorso(null)
    }
  }

  const campoTesto = (placeholder: string) => (
    <>
      <CampoNote
        rows={5}
        value={testo}
        onChange={(e) => setTesto(e.target.value)}
        placeholder={placeholder}
        maxLength={8000}
        disabled={!!inCorso}
      />
      <SceltaAllegati allegati={allegati} disabilitato={!!inCorso} />
    </>
  )
  const occupato = (p: Passo, t: string) => (inCorso === p ? '…' : t)

  // ── chi gestisce ───────────────────────────────────────────────────────────
  if (gestore) {
    return (
      <aside className="card tk-comandi">
        <div className="card-head">
          <h2>Gestione</h2>
          <span className="muted">{livello === 2 ? 'secondo livello' : 'primo livello'}</span>
        </div>
        {stato === 'chiuso' ? (
          <>
            <p className="muted">Ticket chiuso.</p>
            <button type="button" className="btn btn-ghost" onClick={() => esegui('riapri')} disabled={!!inCorso}>
              {occupato('riapri', 'Riapri il ticket')}
            </button>
          </>
        ) : (
          <>
            {campoTesto('Scrivi una nota interna, la risposta, o perché lo passi…')}
            <div className="tk-bottoni">
              <button type="button" className="btn" onClick={() => esegui('risposta')} disabled={!!inCorso}>
                {occupato('risposta', 'Invia la risposta a chi l’ha aperto')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => esegui('nota')} disabled={!!inCorso}>
                {occupato('nota', 'Salva come nota interna')}
              </button>
              {livello === 1 ? (
                <button type="button" className="btn btn-ghost tk-escalation" onClick={() => esegui('escalation')} disabled={!!inCorso}>
                  {occupato('escalation', 'Passa a Maurizio (secondo livello)')}
                </button>
              ) : (
                <button type="button" className="btn btn-ghost" onClick={() => esegui('rimando')} disabled={!!inCorso}>
                  {occupato('rimando', 'Rimanda a Simone (primo livello)')}
                </button>
              )}
              <button type="button" className="btn btn-ghost" onClick={() => esegui('chiudi')} disabled={!!inCorso}>
                {occupato('chiudi', 'Chiudi il ticket')}
              </button>
            </div>
            <p className="muted tk-nota-comandi">
              La nota interna resta nella storia e non la vede chi ha aperto il ticket. La risposta sì, e gli resta in
              evidenza finché non la legge.
            </p>
          </>
        )}
        {errore && <p className="error-banner">{errore}</p>}
      </aside>
    )
  }

  // ── chi ha aperto il ticket ────────────────────────────────────────────────
  return (
    <aside className={`card tk-comandi${motivoDaLeggere ? ' tk-comandi-evidenza' : ''}`}>
      {stato === 'risposto' && (
        <>
          <div className="card-head">
            <h2>Hai una risposta</h2>
          </div>
          <p>Leggila nella storia qui accanto, poi conferma la lettura: il problema è risolto, o vuoi rispondere?</p>
          {!scrivo ? (
            <div className="tk-bottoni">
              <button type="button" className="btn" onClick={() => esegui('chiudi')} disabled={!!inCorso}>
                {occupato('chiudi', '✓ Risolto, chiudi il ticket')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setScrivo(true)} disabled={!!inCorso}>
                Rispondi
              </button>
            </div>
          ) : (
            <>
              {campoTesto('Cosa non torna ancora? Aggiungi nomi ed esempi.')}
              <div className="tk-bottoni">
                <button type="button" className="btn" onClick={() => esegui('replica')} disabled={!!inCorso}>
                  {occupato('replica', 'Invia la risposta')}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setScrivo(false)} disabled={!!inCorso}>
                  Annulla
                </button>
              </div>
            </>
          )}
        </>
      )}

      {stato === 'aperto' && (
        <>
          <div className="card-head">
            <h2>In gestione</h2>
          </div>
          <p className="muted">Simone lo sta guardando. Se hai altro da aggiungere, scrivilo qui.</p>
          {campoTesto('Altri dettagli, nomi, esempi…')}
          <div className="tk-bottoni">
            <button type="button" className="btn" onClick={() => esegui('replica')} disabled={!!inCorso || !testo.trim()}>
              {occupato('replica', 'Aggiungi')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => esegui('chiudi')} disabled={!!inCorso}>
              {occupato('chiudi', 'Si è risolto, chiudi')}
            </button>
          </div>
        </>
      )}

      {stato === 'chiuso' && (
        <>
          <div className="card-head">
            <h2>Ticket chiuso</h2>
          </div>
          {motivoDaLeggere ? (
            <p>Il ticket è stato chiuso. Conferma di averlo letto, o riaprilo se il problema c’è ancora.</p>
          ) : (
            <p className="muted">Se il problema si ripresenta, puoi riaprirlo.</p>
          )}
          <div className="tk-bottoni">
            {motivoDaLeggere && (
              <button type="button" className="btn" onClick={() => esegui('conferma')} disabled={!!inCorso}>
                {occupato('conferma', '✓ Ho letto')}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => esegui('riapri')} disabled={!!inCorso}>
              {occupato('riapri', 'Riapri')}
            </button>
          </div>
        </>
      )}
      {errore && <p className="error-banner">{errore}</p>}
    </aside>
  )
}
