'use client'

import { useState, useTransition } from 'react'
import { salvaNota, segnaGestita } from './actions'
import { Trattativa, type DatiTrattativa } from './Trattativa'

export type Richiesta = {
  id: string
  created_at: string
  nome: string | null
  cognome: string | null
  email: string | null
  cellulare: string | null
  attivita_label: string | null
  settore: string | null
  azione: string | null
  data_scelta: string | null
  ora_scelta: string | null
  messaggio: string | null
  dettagli: string[] | null
  minore_nome: string | null
  minore_cognome: string | null
  minore_data_nascita: string | null
  marketing: boolean | null
  gestito: boolean
  gestito_da: string | null
  gestito_il: string | null
  note: string | null
  utm_source: string | null
  utm_campaign: string | null
  opportunita_id: string | null
}

/** Diritti e anagrafica del team, passati dal Server Component. */
export type ContestoTrattativa = {
  io: string | null
  sonoCommerciale: boolean
  possoRiassegnare: boolean
  commerciali: string[]
  /** Le trattative per id: una sola riga anche se la persona ha più richieste. */
  trattative: Record<string, DatiTrattativa>
}

function dataOra(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Numero pronto per wa.me: solo cifre, senza + né spazi. */
function soloCifre(numero: string): string {
  return numero.replace(/[^0-9]/g, '')
}

export function RigaRichiesta({
  r,
  contesto,
}: {
  r: Richiesta
  contesto?: ContestoTrattativa
}) {
  const [aperta, setAperta] = useState(false)
  const [nota, setNota] = useState(r.note ?? '')
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  const nome = [r.nome, r.cognome].filter(Boolean).join(' ') || '—'
  const minore = [r.minore_nome, r.minore_cognome].filter(Boolean).join(' ')

  function esegui(azione: () => Promise<{ ok: true } | { ok: false; errore: string }>) {
    setErrore(null)
    startTransition(async () => {
      const esito = await azione()
      if (!esito.ok) setErrore(esito.errore)
    })
  }

  return (
    <li className={`richiesta${r.gestito ? ' is-gestita' : ''}`}>
      <div className="richiesta-testa">
        <div>
          <strong>{nome}</strong>
          {minore && <span className="muted"> · per {minore}</span>}
          <div className="richiesta-meta muted">
            {dataOra(r.created_at)}
            {r.attivita_label && ` · ${r.attivita_label}`}
            {r.settore && ` · settore ${r.settore}`}
            {r.utm_campaign && ` · campagna ${r.utm_campaign}`}
          </div>
        </div>

        <div className="richiesta-azioni">
          {/* I contatti sono la prima cosa che serve a un responsabile:
              cliccabili, non da copiare a mano. */}
          {r.cellulare && (
            <>
              <a className="btn btn-ghost btn-sm" href={`tel:${soloCifre(r.cellulare)}`}>
                Chiama
              </a>
              <a
                className="btn btn-ghost btn-sm"
                href={`https://wa.me/${soloCifre(r.cellulare)}`}
                target="_blank"
                rel="noopener"
              >
                WhatsApp
              </a>
            </>
          )}
          {r.email && (
            <a className="btn btn-ghost btn-sm" href={`mailto:${r.email}`}>
              Email
            </a>
          )}
          <button
            type="button"
            className={`btn btn-sm${r.gestito ? ' btn-ghost' : ''}`}
            disabled={inCorso}
            onClick={() => esegui(() => segnaGestita(r.id, !r.gestito))}
          >
            {r.gestito ? 'Riapri' : 'Presa in carico'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAperta((v) => !v)}>
            {aperta ? 'Chiudi' : 'Dettagli'}
          </button>
        </div>
      </div>

      {/* La trattativa è della persona: compare solo su Club e Family, dove
          esiste un team che se la prende in carico. */}
      {contesto && r.opportunita_id && contesto.trattative[r.opportunita_id] && (
        <Trattativa
          t={contesto.trattative[r.opportunita_id]}
          io={contesto.io}
          sonoCommerciale={contesto.sonoCommerciale}
          possoRiassegnare={contesto.possoRiassegnare}
          commerciali={contesto.commerciali}
        />
      )}

      {r.gestito && (
        <p className="richiesta-meta muted" style={{ margin: '0.35rem 0 0' }}>
          Presa in carico
          {r.gestito_da && ` da ${r.gestito_da}`}
          {r.gestito_il && ` il ${dataOra(r.gestito_il)}`}
        </p>
      )}

      {aperta && (
        <div className="richiesta-dettagli">
          <dl className="dettagli-lista">
            {r.email && (
              <>
                <dt>Email</dt>
                <dd>{r.email}</dd>
              </>
            )}
            {r.cellulare && (
              <>
                <dt>Cellulare</dt>
                <dd>{r.cellulare}</dd>
              </>
            )}
            {minore && (
              <>
                <dt>Bambino/a</dt>
                <dd>
                  {minore}
                  {r.minore_data_nascita && ` · nato/a il ${r.minore_data_nascita}`}
                </dd>
              </>
            )}
            {r.azione && (
              <>
                <dt>Richiesta</dt>
                <dd>
                  {r.azione}
                  {r.data_scelta && ` · ${r.data_scelta}`}
                  {r.ora_scelta && ` ore ${String(r.ora_scelta).slice(0, 5)}`}
                </dd>
              </>
            )}
            {r.dettagli && r.dettagli.length > 0 && (
              <>
                <dt>Interessi</dt>
                <dd>{r.dettagli.join(', ')}</dd>
              </>
            )}
            {r.messaggio && (
              <>
                <dt>Messaggio</dt>
                <dd>{r.messaggio}</dd>
              </>
            )}
            <dt>Marketing</dt>
            <dd>{r.marketing ? 'acconsente' : 'no'}</dd>
            {r.utm_source && (
              <>
                <dt>Provenienza</dt>
                <dd>
                  {r.utm_source}
                  {r.utm_campaign && ` · ${r.utm_campaign}`}
                </dd>
              </>
            )}
          </dl>

          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={`nota-${r.id}`}>Note</label>
            <textarea
              id={`nota-${r.id}`}
              rows={2}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Cosa è stato detto, cosa resta da fare…"
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginTop: '0.5rem' }}
              disabled={inCorso || nota === (r.note ?? '')}
              onClick={() => esegui(() => salvaNota(r.id, nota))}
            >
              {inCorso ? 'Salvataggio…' : 'Salva nota'}
            </button>
          </div>
        </div>
      )}

      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)' }}>
          {errore}
        </p>
      )}
    </li>
  )
}
