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
// **gestito o no**, e una **nota**. La nota è obbligatoria come ovunque si
// dica che qualcosa è stato lavorato — una richiesta segnata gestita e muta,
// fra un mese, non dice se la persona si è iscritta o se il numero era
// sbagliato — ma resta sempre modificabile: si scrive prima di gestire,
// insieme, o un mese dopo, e si riscrive quante volte serve. È lì la
// differenza con GestioneEsito, non nell'obbligo.

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
  notaDa,
  notaIl,
}: {
  id: string
  gestito: boolean
  nota: string | null
  /** Chi ha segnato il gestito e quando, già come nome e cognome. */
  gestitoDa: string | null
  gestitoIl: string | null
  /**
   * Chi ha scritto l'ultima versione della nota, e quando. Distinta dal
   * gestito: la nota si corregge senza riaprire la richiesta, e dopo una
   * correzione le due firme sono di due persone diverse.
   */
  notaDa?: string | null
  notaIl?: string | null
}) {
  const [nota, setNota] = useState(notaSalvata ?? '')
  const [gestitoLocale, setGestitoLocale] = useState(gestito)
  const [errore, setErrore] = useState<string | null>(null)
  // Quello che il server ha fatto in più: segnando gestita una richiesta, la
  // trattativa libera di quel contatto passa a chi la segna (vedi
  // prendiChiudendoEvento). Dirlo, o è un'assegnazione che nessuno sa di
  // avere.
  const [avviso, setAvviso] = useState<string | null>(null)
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
    // Detto qui prima che parta la richiesta: il server rifiuta comunque, ma
    // farglielo scoprire dopo un giro di rete su un campo vuoto che si ha
    // davanti è tempo perso e sembra un guasto.
    if (!nota.trim()) {
      return setErrore(
        gestitoLocale
          ? 'La nota è obbligatoria: scrivi com’è andata.'
          : 'La nota è obbligatoria: scrivi perché la rimetti fra quelle da fare.'
      )
    }
    setErrore(null)
    setAvviso(null)
    startTransition(async () => {
      const esito = await salvaGestione({ id, gestito: gestitoLocale, nota })
      if (!esito.ok) setErrore(esito.errore)
      else if (esito.avviso) setAvviso(esito.avviso)
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
        <label htmlFor={`nota-gestione-${id}`}>
          Nota <span aria-hidden="true">*</span>
        </label>
        <textarea
          id={`nota-gestione-${id}`}
          rows={3}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Cosa è stato detto, cosa ricordarsi."
        />
        {/* Obbligatoria ma non definitiva, e le due cose vanno dette insieme:
            una nota che sembra incisa nella pietra si scrive con esitazione, e
            un obbligo senza via d'uscita si aggira scrivendo «ok». */}
        <p className="field-hint">
          Obbligatoria, e sempre modificabile: si può correggere e completare quando serve.
        </p>
        {/* Chi l'ha scritta: la nota che si sta per riscrivere può essere di
            un collega, e sovrascrivere il suo appunto senza saperlo è il modo
            di perdere l'unica traccia di una telefonata. */}
        {notaSalvata && notaDa && (
          <p className="field-hint">
            Scritta da {notaDa}
            {notaIl && ` il ${dataOra(notaIl)}`}.
          </p>
        )}
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

      {avviso && <p className="esito-avviso">{avviso}</p>}

      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)' }}>
          {errore}
        </p>
      )}
    </div>
  )
}
