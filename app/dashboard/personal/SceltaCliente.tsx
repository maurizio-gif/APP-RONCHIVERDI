'use client'

import { useEffect, useRef, useState } from 'react'
import {
  dataNumerica,
  type ClienteScelto,
  type ClienteTrovato,
  type CorporateTrovato,
} from '@/lib/personal'
import { cercaClienti, cercaCorporate } from './actions'

// La scelta del cliente, pensata per il telefono del trainer: una casella di
// ricerca e un elenco di righe grandi da toccare.
//
// Due strade. La normale: il cliente è in anagrafica con un abbonamento
// attivo, lo si cerca per cognome (o nome e cognome) e lo si riconosce da
// data di nascita e abbonamento. La corporate: chi si allena usa la tessera
// della sua azienda, intestata in Info4U a una scheda «segnaposto» — lo si
// cerca per azienda e se ne scrive a mano nome e cognome.

type Modo = 'socio' | 'corporate'

/** Aspetta che si smetta di scrivere prima di chiedere al server. */
const ATTESA_MS = 300

function useRicerca<T>(
  attiva: boolean,
  query: string,
  cerca: (q: string) => Promise<{ ok: true; risultati: T[] } | { ok: false; errore: string }>
) {
  const [risultati, setRisultati] = useState<T[]>([])
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, setInCorso] = useState(false)
  const [cercato, setCercato] = useState<string | null>(null)
  const ultima = useRef(0)

  useEffect(() => {
    if (!attiva) return
    const numero = ++ultima.current
    setInCorso(true)
    const timer = setTimeout(async () => {
      try {
        const esito = await cerca(query)
        // Una risposta arrivata dopo una ricerca più recente non deve
        // sovrascriverne i risultati.
        if (numero !== ultima.current) return
        if (esito.ok) {
          setRisultati(esito.risultati)
          setErrore(null)
        } else {
          setRisultati([])
          setErrore(esito.errore)
        }
        setCercato(query)
      } catch {
        if (numero === ultima.current) setErrore('Ricerca non riuscita: controlla la connessione.')
      } finally {
        if (numero === ultima.current) setInCorso(false)
      }
    }, ATTESA_MS)
    return () => clearTimeout(timer)
  }, [attiva, query, cerca])

  return { risultati, errore, inCorso, cercato }
}

export function SceltaCliente({
  valore,
  onChange,
}: {
  valore: ClienteScelto | null
  onChange: (cliente: ClienteScelto | null) => void
}) {
  const [modo, setModo] = useState<Modo>(valore?.tipo ?? 'socio')
  const [query, setQuery] = useState('')
  const campo = useRef<HTMLInputElement>(null)

  // Due lettere almeno, come vuole il server: con una sola non si chiede
  // niente, e il campo vuoto non mostra un elenco a caso.
  const troppoCorta = modo === 'socio' && query.replace(/\s/g, '').length < 2
  const soci = useRicerca<ClienteTrovato>(!valore && modo === 'socio' && !troppoCorta, query, cercaClienti)
  const aziende = useRicerca<CorporateTrovato>(!valore && modo === 'corporate', query, cercaCorporate)

  function cambiaModo(nuovo: Modo) {
    setModo(nuovo)
    setQuery('')
    campo.current?.focus()
  }

  // ── Cliente già scelto: il riepilogo, e per un corporate i due campi.
  if (valore) {
    return (
      <div className="pt-scelto">
        <div className="pt-scelto-testa">
          {valore.tipo === 'socio' ? (
            <div>
              <div className="pt-nome">
                {valore.cognome} {valore.nome}
              </div>
              <div className="pt-dettagli">
                Nato/a il {dataNumerica(valore.dataNascita)} · {valore.abbonamenti.join(' · ')}
              </div>
            </div>
          ) : (
            <div>
              <div className="pt-nome">
                <span className="badge badge-info">Corporate</span> {valore.azienda}
              </div>
              <div className="pt-dettagli">
                {[valore.tessera, valore.abbonamento].filter(Boolean).join(' · ')}
              </div>
            </div>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setQuery('')
              onChange(null)
            }}
          >
            Cambia
          </button>
        </div>

        {valore.tipo === 'corporate' && (
          <div className="form-row pt-corporate-nome">
            <div className="field">
              <label htmlFor="pt-corp-nome">Nome di chi si allena</label>
              <input
                id="pt-corp-nome"
                type="text"
                autoComplete="off"
                autoCapitalize="words"
                value={valore.nome}
                onChange={(e) => onChange({ ...valore, nome: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="pt-corp-cognome">Cognome</label>
              <input
                id="pt-corp-cognome"
                type="text"
                autoComplete="off"
                autoCapitalize="words"
                value={valore.cognome}
                onChange={(e) => onChange({ ...valore, cognome: e.target.value })}
                required
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  const ricerca = modo === 'socio' ? soci : aziende

  return (
    <div className="pt-ricerca">
      <div className="pt-modi" role="tablist" aria-label="Tipo di cliente">
        <button
          type="button"
          role="tab"
          aria-selected={modo === 'socio'}
          className={`chip${modo === 'socio' ? ' is-attivo' : ''}`}
          onClick={() => cambiaModo('socio')}
        >
          Socio
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={modo === 'corporate'}
          className={`chip${modo === 'corporate' ? ' is-attivo' : ''}`}
          onClick={() => cambiaModo('corporate')}
        >
          Corporate aziendale
        </button>
      </div>

      <div className="field">
        <label htmlFor="pt-cerca">{modo === 'socio' ? 'Cerca il cliente' : 'Cerca l’azienda'}</label>
        <input
          ref={campo}
          id="pt-cerca"
          type="search"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={modo === 'socio' ? 'Cognome, oppure nome e cognome' : 'Nome dell’azienda'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p className="field-hint">
          {modo === 'socio'
            ? 'Compaiono solo le persone con un abbonamento attivo.'
            : 'Chiedi al cliente per quale azienda si allena, poi scrivi il suo nome.'}
        </p>
      </div>

      {ricerca.errore && !troppoCorta && <p className="error-banner">{ricerca.errore}</p>}

      {modo === 'socio' && troppoCorta ? null : ricerca.inCorso && ricerca.cercato !== query ? (
        <p className="muted pt-stato-ricerca">Cerco…</p>
      ) : modo === 'socio' ? (
        soci.risultati.length === 0 ? (
          ricerca.cercato === query &&
          !ricerca.errore && (
            <div className="pt-nessuno">
              <p>Nessun socio attivo con questo nome.</p>
              <button type="button" className="link-testo" onClick={() => cambiaModo('corporate')}>
                Si allena con un abbonamento corporate? Cercalo per azienda →
              </button>
            </div>
          )
        ) : (
          <ul className="pt-risultati">
            {soci.risultati.map((c) => (
              <li key={c.persona_id}>
                <button
                  type="button"
                  className="pt-risultato"
                  onClick={() =>
                    onChange({
                      tipo: 'socio',
                      personaId: c.persona_id,
                      abbonamentoId: c.abbonamento_id,
                      nome: c.nome ?? '',
                      cognome: c.cognome ?? '',
                      dataNascita: c.data_nascita,
                      abbonamenti: c.abbonamenti ?? [],
                    })
                  }
                >
                  <span className="pt-nome">
                    {c.cognome} {c.nome}
                  </span>
                  <span className="pt-dettagli">Nato/a il {dataNumerica(c.data_nascita)}</span>
                  <span className="pt-dettagli">{(c.abbonamenti ?? []).join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : aziende.risultati.length === 0 ? (
        ricerca.cercato === query &&
        !ricerca.errore && <p className="muted pt-stato-ricerca">Nessun abbonamento corporate attivo con questo nome.</p>
      ) : (
        <ul className="pt-risultati">
          {aziende.risultati.map((c) => (
            <li key={c.abbonamento_id}>
              <button
                type="button"
                className="pt-risultato"
                onClick={() =>
                  onChange({
                    tipo: 'corporate',
                    personaId: c.persona_id,
                    abbonamentoId: c.abbonamento_id,
                    azienda: c.azienda ?? '',
                    tessera: c.nome ?? '',
                    abbonamento: c.abbonamento,
                    nome: '',
                    cognome: '',
                  })
                }
              >
                <span className="pt-nome">{c.azienda}</span>
                <span className="pt-dettagli">
                  {c.nome} · {c.abbonamento}
                  {c.data_fine ? ` · fino al ${dataNumerica(c.data_fine)}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
