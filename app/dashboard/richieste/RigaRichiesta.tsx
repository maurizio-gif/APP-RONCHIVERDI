'use client'

import { useState, useTransition } from 'react'
import { ETICHETTE_ESITO, eEsitoValido } from '@/lib/agenda'
import { GestioneEsito } from '@/components/GestioneEsito'
import { riapriRichiesta, salvaNota } from './actions'
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
  esito_tipo: string | null
  esito: string | null
  utm_source: string | null
  utm_campaign: string | null
  opportunita_id: string | null
  /** La persona riconosciuta dal database: è la chiave con cui si contano le richieste ripetute. */
  persona_id: string | null
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
  operatori = [],
  puoCancellare = false,
  storico,
}: {
  r: Richiesta
  contesto?: ContestoTrattativa
  /** Chi può essere assegnatario di un evento programmato chiudendo la richiesta. */
  operatori?: string[]
  puoCancellare?: boolean
  /** Che numero è questa richiesta nella storia della persona. */
  storico?: { ordinale: number; totale: number; precedenteIl: string | null }
}) {
  const [aperta, setAperta] = useState(false)
  const [nota, setNota] = useState(r.note ?? '')
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  const nome = [r.nome, r.cognome].filter(Boolean).join(' ') || '—'
  const minore = [r.minore_nome, r.minore_cognome].filter(Boolean).join(' ')

  // Una richiesta ripetuta va detta prima di chiamare: il database riusa la
  // trattativa già aperta senza cambiare niente, quindi in elenco questa riga
  // sarebbe indistinguibile da un contatto nuovo. Chi la prende in mano
  // rischia di ripresentarsi come se fosse il primo contatto — o di
  // richiamare qualcuno che un collega sta già seguendo.
  const ripetuta = !!storico && storico.ordinale > 1
  const trattativa = r.opportunita_id ? contesto?.trattative[r.opportunita_id] : undefined
  const giaSeguitaDa = trattativa?.stato === 'in_gestione' ? trattativa.assegnato_a : null

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
          {ripetuta && (
            <span className="badge badge-warn" style={{ marginLeft: '0.5rem' }}>
              {storico!.ordinale}ª richiesta
            </span>
          )}
          <div className="richiesta-meta muted">
            {dataOra(r.created_at)}
            {r.attivita_label && ` · ${r.attivita_label}`}
            {r.settore && ` · settore ${r.settore}`}
            {r.utm_campaign && ` · campagna ${r.utm_campaign}`}
          </div>
          {ripetuta && (
            <div className="richiesta-meta richiesta-ripetuta">
              Ha già scritto {storico!.totale === 2 ? 'una volta' : `${storico!.totale - 1} volte`}
              {storico!.precedenteIl && ` · la precedente il ${dataOra(storico!.precedenteIl)}`}
              {giaSeguitaDa && ` · trattativa già seguita da ${giaSeguitaDa}`}
            </div>
          )}
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
          {/* Solo la riapertura: prendere in carico segnava la richiesta
              lavorata senza esito e senza il perché, e "Chiudi con esito" —
              nei dettagli qui sotto — continuava a proporla da chiudere. La
              stessa richiesta risultava fatta in agenda e ancora aperta nel
              pannello dell'esito. */}
          {r.gestito && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={inCorso}
              onClick={() => esegui(() => riapriRichiesta(r.id))}
            >
              Riapri
            </button>
          )}
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

      {/* Non è un comando ma il fatto già avvenuto: chi l'ha chiusa e quando.
          Diceva "presa in carico" quando la si prendeva in carico a mano; ora
          `gestito` lo scrive solo la chiusura con esito. */}
      {r.gestito && (
        <p className="richiesta-meta muted" style={{ margin: '0.35rem 0 0' }}>
          Chiusa
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
                {/* Se la persona ha prenotato, quel testo è l'oggetto che ha
                    scritto scegliendo giorno e ora: chiamarlo "Messaggio" lo
                    farebbe sembrare un commento in più, non la ragione
                    dell'incontro. */}
                <dt>
                  {r.azione === 'appuntamento' || r.azione === 'telefonata' ? 'Oggetto' : 'Messaggio'}
                </dt>
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
            {eEsitoValido(r.esito_tipo) && (
              <>
                <dt>Esito</dt>
                <dd>{ETICHETTE_ESITO[r.esito_tipo]}</dd>
              </>
            )}
            {r.esito && (
              <>
                <dt>Nota di chiusura</dt>
                <dd>{r.esito}</dd>
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

          {/* La chiusura con esito è lo stesso pannello dell'agenda: una
              richiesta dal sito e una voce di segreteria si chiudono con lo
              stesso gesto, e chi lavora non deve imparare due schemi. */}
          <GestioneEsito
            origine="form_contatti"
            id={r.id}
            titolo={nome}
            operatori={operatori}
            puoCancellare={puoCancellare}
          />
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
