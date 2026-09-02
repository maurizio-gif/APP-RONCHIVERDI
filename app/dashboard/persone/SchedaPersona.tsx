'use client'

import { useState, useTransition } from 'react'
import { salvaNomePersona, salvaNotaPersona } from './actions'

// Correzione del nome e nota: entrambe si salvano da sé, senza un pulsante
// "Salva" globale che si dimentica di premere. Email e cellulare non sono
// modificabili — sono le chiavi con cui il database riconosce la persona.
export function SchedaPersona({
  id,
  nome,
  cognome,
  note,
}: {
  id: string
  nome: string | null
  cognome: string | null
  note: string | null
}) {
  const [n, setN] = useState(nome ?? '')
  const [c, setC] = useState(cognome ?? '')
  const [nota, setNota] = useState(note ?? '')
  const [errore, setErrore] = useState<string | null>(null)
  const [salvato, setSalvato] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function esegui(azione: () => Promise<{ ok: true } | { ok: false; errore: string }>, cosa: string) {
    setErrore(null)
    setSalvato(null)
    startTransition(async () => {
      const esito = await azione()
      if (esito.ok) setSalvato(cosa)
      else setErrore(esito.errore)
    })
  }

  const nomeCambiato = n !== (nome ?? '') || c !== (cognome ?? '')

  return (
    <div className="card">
      <div className="card-head">
        <h2>Scheda</h2>
        {salvato && <span className="badge badge-ok">{salvato} salvato</span>}
      </div>

      {errore && <p className="error-banner">{errore}</p>}

      <div className="form-row">
        <div className="field">
          <label htmlFor="p-nome">Nome</label>
          <input id="p-nome" type="text" value={n} onChange={(e) => setN(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="p-cognome">Cognome</label>
          <input id="p-cognome" type="text" value={c} onChange={(e) => setC(e.target.value)} autoComplete="off" />
        </div>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={inCorso || !nomeCambiato}
        onClick={() => esegui(() => salvaNomePersona(id, n, c), 'Nome')}
      >
        {inCorso ? 'Salvataggio…' : 'Correggi nome'}
      </button>

      <div className="field" style={{ marginTop: '1.5rem', marginBottom: 0 }}>
        <label htmlFor="p-note">Note</label>
        <textarea
          id="p-note"
          rows={3}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Cosa sapere di questa persona: preferenze, storia, cosa è stato detto…"
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: '0.5rem' }}
          disabled={inCorso || nota === (note ?? '')}
          onClick={() => esegui(() => salvaNotaPersona(id, nota), 'Nota')}
        >
          {inCorso ? 'Salvataggio…' : 'Salva nota'}
        </button>
      </div>
    </div>
  )
}
