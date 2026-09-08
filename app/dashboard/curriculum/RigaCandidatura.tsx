'use client'

import { useState, useTransition } from 'react'
import {
  CLASSE_BADGE,
  ETICHETTE_STATO,
  STATI,
  dataOraRoma,
  formatoCv,
  nomeCompleto,
  pesoLeggibile,
  type Candidatura,
} from '@/lib/candidature'
import { cambiaStato, linkCurriculum, salvaNota } from './actions'

// Una candidatura nell'elenco. Chiusa mostra chi è, per cosa si candida e se
// ha il curriculum; aperta mostra i due testi lunghi per intero, che sono la
// ragione per cui questa sezione esiste — un CV si legge dopo aver deciso che
// la persona interessa, non prima.

export function RigaCandidatura({ candidatura }: { candidatura: Candidatura }) {
  const [aperta, setAperta] = useState(false)
  const [nota, setNota] = useState(candidatura.note ?? '')
  const [notaSalvata, setNotaSalvata] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  const peso = pesoLeggibile(candidatura.cv_dimensione)

  function esegui(azione: () => Promise<{ ok: boolean; errore?: string }>) {
    setErrore(null)
    startTransition(async () => {
      const esito = await azione()
      if (!esito.ok) setErrore(esito.errore ?? 'Operazione non riuscita.')
    })
  }

  function scaricaCv() {
    setErrore(null)
    startTransition(async () => {
      const esito = await linkCurriculum(candidatura.id)
      if (!esito.ok) {
        setErrore(esito.errore)
        return
      }
      // Il link firmato dura un minuto: si usa subito e non si tiene in stato,
      // così non resta un pulsante che dopo cinque minuti non funziona più.
      window.location.href = esito.url
    })
  }

  return (
    <div className="card cand-card">
      <div className="cand-testa">
        <button
          type="button"
          className="cand-apri"
          aria-expanded={aperta}
          onClick={() => setAperta((v) => !v)}
        >
          <span className="cand-nome">{nomeCompleto(candidatura)}</span>
          <span className="cand-dettagli">
            {candidatura.area_label ?? 'Area non indicata'}
            {candidatura.citta ? ` · ${candidatura.citta}` : ''}
            {candidatura.disponibilita ? ` · ${candidatura.disponibilita}` : ''}
          </span>
          <span className="cand-dettagli">
            {candidatura.email} · {candidatura.cellulare}
          </span>
        </button>

        <div className="cand-meta">
          <span className={CLASSE_BADGE[candidatura.stato]}>
            {ETICHETTE_STATO[candidatura.stato]}
          </span>
          <span className="cand-data">{dataOraRoma(candidatura.created_at)}</span>
        </div>
      </div>

      <div className="cand-azioni">
        {candidatura.cv_path ? (
          <button type="button" className="btn btn-sm" disabled={inCorso} onClick={scaricaCv}>
            {inCorso ? '…' : `Scarica CV · ${formatoCv(candidatura.cv_tipo, candidatura.cv_nome)}`}
            {peso ? ` (${peso})` : ''}
          </button>
        ) : (
          <span className="badge badge-ko">Curriculum mancante</span>
        )}

        {STATI.filter((s) => s !== candidatura.stato).map((s) => (
          <button
            key={s}
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={inCorso}
            onClick={() => esegui(() => cambiaStato(candidatura.id, s))}
          >
            {s === 'archiviata' ? 'Archivia' : `Segna “${ETICHETTE_STATO[s]}”`}
          </button>
        ))}

        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAperta((v) => !v)}>
          {aperta ? 'Chiudi' : 'Leggi la candidatura'}
        </button>
      </div>

      {candidatura.gestita_da && (
        <p className="cand-storia">
          Ultimo intervento di {candidatura.gestita_da}
          {candidatura.gestita_il ? ` il ${dataOraRoma(candidatura.gestita_il)}` : ''}
        </p>
      )}

      {errore && <p className="error-banner">{errore}</p>}

      {aperta && (
        <div className="cand-corpo">
          <section>
            <h3>Parla di sé</h3>
            <p className="cand-testo">{candidatura.presentazione}</p>
          </section>

          {candidatura.esperienza && (
            <section>
              <h3>Il suo percorso</h3>
              <p className="cand-testo">{candidatura.esperienza}</p>
            </section>
          )}

          {(candidatura.utm_source || candidatura.utm_campaign) && (
            <p className="cand-storia">
              Provenienza: {[candidatura.utm_source, candidatura.utm_campaign].filter(Boolean).join(' · ')}
            </p>
          )}

          <section>
            <h3>Nota interna</h3>
            <textarea
              className="cand-nota"
              rows={3}
              value={nota}
              placeholder="Cosa ne pensi, con chi l'hai condivisa, quando l'hai richiamata."
              onChange={(e) => {
                setNota(e.target.value)
                setNotaSalvata(false)
              }}
            />
            <div className="cand-azioni">
              <button
                type="button"
                className="btn btn-sm"
                disabled={inCorso || nota === (candidatura.note ?? '')}
                onClick={() =>
                  esegui(async () => {
                    const esito = await salvaNota(candidatura.id, nota)
                    if (esito.ok) setNotaSalvata(true)
                    return esito
                  })
                }
              >
                Salva nota
              </button>
              {notaSalvata && <span className="cand-dettagli">Nota salvata.</span>}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
