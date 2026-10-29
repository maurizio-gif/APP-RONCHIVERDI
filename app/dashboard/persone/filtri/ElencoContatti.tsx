'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { dataBreve, inizialiPersona, nomePersona } from '@/lib/persone'
import { giorniFra } from '@/lib/accessi'
import { ETICHETTE_STATO, type StatoTrattativa } from '@/lib/pipeline'
import type { RigaContatto } from '@/lib/contatti-filtri-server'
import { recapitiDellaLista } from './actions'

// L'elenco dei contatti filtrati, con le caselle per scegliere i nominativi:
// la pagina intera, o tutta la lista (anche oltre la prima pagina). Su chi è
// scelto — o su tutta la lista se nessuno lo è — si scarica il CSV e si copiano
// email e cellulari. La lista vera la rilegge il server dai parametri: qui si
// tiene solo chi è spuntato.

function trascorso(da: string | null, oggi: string): string | null {
  if (!da) return null
  const n = giorniFra(da, oggi) - 1
  if (n <= 0) return 'oggi'
  return n === 1 ? 'ieri' : `${n} giorni fa`
}

export function ElencoContatti({
  righe,
  totale,
  parametri,
  oggi,
  nomiStaff,
}: {
  righe: RigaContatto[]
  totale: number
  /** La query string dei filtri attuali (senza pagina e senza spunte). */
  parametri: string
  oggi: string
  nomiStaff: Record<string, string>
}) {
  const [spuntati, setSpuntati] = useState<Set<string>>(new Set())
  const [tuttaLaLista, setTuttaLaLista] = useState(false)
  const [messaggio, setMessaggio] = useState<string | null>(null)
  const [inCorso, avvia] = useTransition()

  const idPagina = righe.map((r) => r.id)
  const tuttiInPagina = idPagina.length > 0 && idPagina.every((id) => spuntati.has(id))
  const nessunaScelta = !tuttaLaLista && spuntati.size === 0
  const quanti = tuttaLaLista ? totale : spuntati.size || totale

  const alterna = (id: string) => {
    setTuttaLaLista(false)
    setSpuntati((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  const spuntaPagina = () => {
    setTuttaLaLista(false)
    setSpuntati((s) => {
      const n = new Set(s)
      if (tuttiInPagina) idPagina.forEach((id) => n.delete(id))
      else idPagina.forEach((id) => n.add(id))
      return n
    })
  }
  const azzera = () => {
    setSpuntati(new Set())
    setTuttaLaLista(false)
  }

  // Se si è scelta tutta la lista, o nessuno, si passa solo dai filtri; altrimenti dalle persone spuntate.
  const idDaUsare = tuttaLaLista || spuntati.size === 0 ? [] : [...spuntati]
  const hrefCsv = (() => {
    const q = new URLSearchParams(parametri)
    if (idDaUsare.length > 0) q.set('ids', idDaUsare.join(','))
    return `/dashboard/persone/filtri/export?${q.toString()}`
  })()

  const copia = (campo: 'email' | 'cellulare') =>
    avvia(async () => {
      setMessaggio(null)
      const r = await recapitiDellaLista(parametri, idDaUsare, campo)
      if (!r.ok) return setMessaggio(r.errore)
      if (r.valori.length === 0) return setMessaggio(`Nessun ${campo === 'email' ? 'indirizzo email' : 'cellulare'} fra queste persone.`)
      try {
        await navigator.clipboard.writeText(r.valori.join(campo === 'email' ? '; ' : '\n'))
        setMessaggio(`Copiati ${r.valori.length} ${campo === 'email' ? 'indirizzi email' : 'cellulari'} (${r.persone} persone).`)
      } catch {
        setMessaggio('Il browser non permette di copiare: scarica il CSV.')
      }
    })

  return (
    <>
      <div className="contatti-azioni">
        <label className="check-riga">
          <input type="checkbox" checked={tuttiInPagina} onChange={spuntaPagina} />
          <span>Tutta la pagina</span>
        </label>
        {totale > righe.length && !tuttaLaLista && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTuttaLaLista(true)}>
            Seleziona tutti i {totale.toLocaleString('it-IT')} contatti
          </button>
        )}
        {!nessunaScelta && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={azzera}>
            Deseleziona
          </button>
        )}
        <span className="muted contatti-selezione">
          {tuttaLaLista
            ? `Tutti i ${totale.toLocaleString('it-IT')} contatti della lista`
            : spuntati.size > 0
              ? `${spuntati.size} ${spuntati.size === 1 ? 'selezionato' : 'selezionati'}`
              : 'Nessuno scelto: le azioni valgono per tutta la lista'}
        </span>
        <span className="contatti-azioni-destra">
          <a className="btn btn-sm" href={hrefCsv}>
            Scarica CSV ({quanti.toLocaleString('it-IT')})
          </a>
          <button type="button" className="btn btn-sm btn-ghost" disabled={inCorso} onClick={() => copia('email')}>
            Copia email
          </button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={inCorso} onClick={() => copia('cellulare')}>
            Copia cellulari
          </button>
        </span>
      </div>
      {messaggio && <p className="muted contatti-messaggio">{messaggio}</p>}

      <ul className="persone contatti-lista">
        {righe.map((r) => {
          const nome = nomePersona(r)
          const attivo = !!r.abbonamento
          const scadenza = r.ultima_scadenza
          const stato = r.lead_stato as StatoTrattativa | null
          return (
            <li key={r.id} className={spuntati.has(r.id) || tuttaLaLista ? 'is-scelta' : undefined}>
              <div className="persona-riga contatti-riga">
                <input
                  type="checkbox"
                  className="contatti-casella"
                  aria-label={`Seleziona ${nome}`}
                  checked={tuttaLaLista || spuntati.has(r.id)}
                  disabled={tuttaLaLista}
                  onChange={() => alterna(r.id)}
                />
                <span className="user-badge" aria-hidden="true">
                  {inizialiPersona(r)}
                </span>
                <span className="persona-corpo">
                  <span className="persona-nome">
                    <Link href={`/dashboard/persone/${r.id}`} className="link">
                      {nome}
                    </Link>
                    {r.richieste_da_lavorare > 0 && (
                      <span className="badge badge-warn" style={{ marginLeft: '0.5rem' }}>
                        {r.richieste_da_lavorare} da lavorare
                      </span>
                    )}
                    {stato && ETICHETTE_STATO[stato] && (
                      <span className="badge badge-info" style={{ marginLeft: '0.5rem' }}>
                        {ETICHETTE_STATO[stato]}
                        {r.lead_assegnato && ` · ${nomiStaff[r.lead_assegnato] ?? r.lead_assegnato}`}
                      </span>
                    )}
                  </span>
                  <span className="persona-meta muted">{[r.email, r.cellulare].filter(Boolean).join(' · ') || 'nessun contatto'}</span>
                  <span className="persona-meta contatti-dettaglio">
                    {attivo ? (
                      <>
                        <span className="badge badge-ok">Attivo</span> {r.abbonamento}
                        {r.fine_abbonamento ? <span className="muted"> · fino al {dataBreve(r.fine_abbonamento)}</span> : null}
                      </>
                    ) : scadenza ? (
                      <>
                        <span className="badge">Scaduto</span> <span className="muted">il {dataBreve(scadenza)}</span>
                      </>
                    ) : (
                      <span className="muted">Nessun abbonamento</span>
                    )}
                  </span>
                </span>
                <span className="persona-numeri muted">
                  {r.ultimo_accesso ? (
                    <>
                      ultimo ingresso
                      <br />
                      {dataBreve(r.ultimo_accesso)} · {trascorso(r.ultimo_accesso, oggi)}
                    </>
                  ) : (
                    'mai entrato'
                  )}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
