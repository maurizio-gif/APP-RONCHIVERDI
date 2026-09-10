'use client'

import { useState, useTransition } from 'react'
import { salvaGestione } from './actions'

// La gestione delle Young School e degli altri corsi: una nota e un
// interruttore.
//
// Il pannello di Club e Family (GestioneEsito) chiede di scegliere fra
// quattro esiti, obbliga a scrivere il perché e offre un programmatore di
// eventi con sei campi a testa: è giusto là, dove ogni richiesta è una
// trattativa da far avanzare e il seguito va fissato in agenda.
//
// Qui il lavoro è un altro. Il responsabile del nuoto chiama la mamma che ha
// chiesto del corso, le dice gli orari, e la richiesta è finita: non c'è una
// vendita da seguire, nessun secondo appuntamento da mettere in calendario,
// nessuna pipeline. Quel pannello gli chiedeva di compilare un modulo di
// vendita per dire «l'ho chiamata» — e la nota, essendo il verbale di una
// chiusura, non si poteva né scrivere prima né correggere dopo.
//
// Restano due cose, e sono le uniche due che qualcuno guarda davvero:
// **gestito o no**, e una **nota** libera. La nota si scrive quando si vuole
// — prima di gestire, insieme, o un mese dopo — e si riscrive sempre.

function dataOra(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function GestioneSemplice({
  id,
  gestito,
  nota: notaSalvata,
  gestitoDa,
  gestitoIl,
}: {
  id: string
  gestito: boolean
  nota: string | null
  gestitoDa: string | null
  gestitoIl: string | null
}) {
  const [nota, setNota] = useState(notaSalvata ?? '')
  const [gestitoLocale, setGestitoLocale] = useState(gestito)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  // Dopo il salvataggio il server rilegge la riga e rimanda le prop nuove, ma
  // lo stato locale è già stato inizializzato e resterebbe quello di prima:
  // il pannello continuerebbe a dire «da salvare» su qualcosa di già salvato.
  // Quando le prop cambiano si riallinea (il pattern React di correggere lo
  // stato in fase di render, che rifà subito il render senza toccare il DOM).
  const [ultimeProp, setUltimeProp] = useState({ nota: notaSalvata, gestito })
  if (ultimeProp.nota !== notaSalvata || ultimeProp.gestito !== gestito) {
    setUltimeProp({ nota: notaSalvata, gestito })
    setNota(notaSalvata ?? '')
    setGestitoLocale(gestito)
    setErrore(null)
  }

  const daSalvare = nota.trim() !== (notaSalvata ?? '').trim() || gestitoLocale !== gestito

  function salva() {
    setErrore(null)
    startTransition(async () => {
      const esito = await salvaGestione({ id, gestito: gestitoLocale, nota })
      if (!esito.ok) setErrore(esito.errore)
    })
  }

  return (
    <div className="gestione">
      <div className="gestione-titolo">
        Gestione
        {/* L'interruttore non salva da solo: chi lo scatta e va via crederebbe
            di aver segnato la richiesta. Detto qui, accanto al titolo, si
            legge prima di allontanarsi dal pannello. */}
        {daSalvare && <span className="gestione-da-salvare">da salvare</span>}
      </div>

      {/* L'interruttore prima della nota: è la cosa che si viene a fare, e la
          nota è quello che si aggiunge se c'è qualcosa da aggiungere.
          `role="switch"` e non una casella, perché non è una scelta da
          confermare altrove: è lo stato della richiesta, acceso o spento. */}
      <button
        type="button"
        role="switch"
        aria-checked={gestitoLocale}
        className={`gestione-toggle${gestitoLocale ? ' is-attivo' : ''}`}
        disabled={inCorso}
        onClick={() => {
          setErrore(null)
          setGestitoLocale((v) => !v)
        }}
      >
        <span className="gestione-toggle-pista" aria-hidden="true">
          <span className="gestione-toggle-pallino" />
        </span>
        <span className="gestione-toggle-testo">{gestitoLocale ? 'Gestito' : 'Non gestito'}</span>
      </button>

      <div className="field">
        <label htmlFor={`nota-gestione-${id}`}>Nota</label>
        <textarea
          id={`nota-gestione-${id}`}
          rows={3}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Cosa è stato detto, cosa ricordarsi. Facoltativa."
        />
        {/* Che si possa tornarci sopra va detto: una nota che sembra
            definitiva si scrive con più esitazione, o non si scrive. */}
        <p className="field-hint">
          Facoltativa, e sempre modificabile: si può scrivere adesso o fra un mese.
        </p>
      </div>

      <div className="gestione-azioni">
        <button
          type="button"
          className="btn btn-sm"
          disabled={inCorso || !daSalvare}
          onClick={salva}
        >
          {inCorso ? 'Salvataggio…' : daSalvare ? 'Salva' : 'Salvato'}
        </button>

        {/* Chi e quando, se è già gestita: è la stessa riga che compare sotto
            la testa della richiesta, ma qui serve a chi sta per riaprirla —
            togliere il gestito di un collega senza sapere che è suo è il modo
            di richiamare due volte la stessa persona. */}
        {gestito && (
          <p className="field-hint">
            Gestita
            {gestitoDa && ` da ${gestitoDa}`}
            {gestitoIl && ` il ${dataOra(gestitoIl)}`}.
          </p>
        )}
      </div>

      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)' }}>
          {errore}
        </p>
      )}
    </div>
  )
}
