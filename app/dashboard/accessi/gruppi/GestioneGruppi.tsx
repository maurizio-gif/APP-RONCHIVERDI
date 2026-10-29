'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { COLORI_GRUPPO, type Gruppo, type Varco } from '@/lib/accessi'
import { aggiornaGruppoAccessi, creaGruppoAccessi, eliminaGruppoAccessi, salvaAssegnazioniVarchi, type Esito } from './actions'

function Colori({ valore, onCambia }: { valore: string; onCambia: (c: string) => void }) {
  return (
    <span className="accessi-colori" role="radiogroup" aria-label="Colore del gruppo">
      {COLORI_GRUPPO.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={valore.toLowerCase() === c}
          aria-label={c}
          className={`accessi-colore ${valore.toLowerCase() === c ? 'is-scelto' : ''}`}
          style={{ background: c }}
          onClick={() => onCambia(c)}
        />
      ))}
    </span>
  )
}

function Messaggio({ esito }: { esito: Esito | null }) {
  if (!esito) return null
  return esito.ok ? <span className="muted">Salvato.</span> : <span className="accessi-errore">{esito.errore}</span>
}

export function NuovoGruppo() {
  const router = useRouter()
  const [nome, setNome] = useState('')
  const [colore, setColore] = useState<string>(COLORI_GRUPPO[0])
  const [esito, setEsito] = useState<Esito | null>(null)
  const [inCorso, avvia] = useTransition()

  return (
    <form
      className="accessi-nuovo-gruppo"
      onSubmit={(e) => {
        e.preventDefault()
        avvia(async () => {
          const r = await creaGruppoAccessi(nome, colore)
          setEsito(r)
          if (r.ok) {
            setNome('')
            router.refresh()
          }
        })
      }}
    >
      <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome del gruppo (es. Palestra)" maxLength={40} aria-label="Nome del gruppo" />
      <Colori valore={colore} onCambia={setColore} />
      <button type="submit" className="btn btn-sm" disabled={inCorso || !nome.trim()}>
        Crea gruppo
      </button>
      <Messaggio esito={esito} />
    </form>
  )
}

export function RigaGruppo({ gruppo, varchi }: { gruppo: Gruppo; varchi: number }) {
  const router = useRouter()
  const [nome, setNome] = useState(gruppo.nome)
  const [colore, setColore] = useState(gruppo.colore)
  const [esito, setEsito] = useState<Esito | null>(null)
  const [inCorso, avvia] = useTransition()
  const modificato = nome !== gruppo.nome || colore.toLowerCase() !== gruppo.colore.toLowerCase()

  return (
    <li className="accessi-riga-gruppo">
      <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} aria-label="Nome del gruppo" />
      <Colori valore={colore} onCambia={setColore} />
      <span className="muted">{varchi === 1 ? '1 varco' : `${varchi} varchi`}</span>
      <button
        type="button"
        className="btn btn-sm"
        disabled={inCorso || !modificato}
        onClick={() =>
          avvia(async () => {
            const r = await aggiornaGruppoAccessi(gruppo.id, nome, colore)
            setEsito(r)
            if (r.ok) router.refresh()
          })
        }
      >
        Salva
      </button>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        disabled={inCorso}
        onClick={() => {
          const avviso =
            varchi > 0
              ? `Eliminare il gruppo «${gruppo.nome}»? I suoi ${varchi} varchi tornano senza gruppo; i numeri restano.`
              : `Eliminare il gruppo «${gruppo.nome}»?`
          if (!window.confirm(avviso)) return
          avvia(async () => {
            const r = await eliminaGruppoAccessi(gruppo.id)
            setEsito(r)
            if (r.ok) router.refresh()
          })
        }}
      >
        Elimina
      </button>
      <Messaggio esito={esito} />
    </li>
  )
}

/** Un varco per riga con la tendina del gruppo; si salva tutto insieme. */
export function AssegnaVarchi({ varchi, gruppi }: { varchi: Varco[]; gruppi: Gruppo[] }) {
  const router = useRouter()
  const [scelte, setScelte] = useState<Record<string, string>>(() =>
    Object.fromEntries(varchi.map((v) => [v.chiave, v.gruppoId ?? '']))
  )
  const [esito, setEsito] = useState<Esito | null>(null)
  const [inCorso, avvia] = useTransition()
  const cambiati = varchi.filter((v) => (scelte[v.chiave] || null) !== (v.gruppoId ?? null))

  return (
    <>
      <div className="tabella-wrap">
        <table className="tabella">
          <thead>
            <tr>
              <th>Varco</th>
              <th>Gruppo</th>
            </tr>
          </thead>
          <tbody>
            {varchi.map((v) => {
              const scelto = gruppi.find((g) => g.id === scelte[v.chiave])
              return (
                <tr key={v.chiave} className={cambiati.includes(v) ? 'accessi-riga-cambiata' : ''}>
                  <td>
                    {v.descrizione}
                    {!v.attivo && <span className="badge badge-off"> non attivo</span>}
                  </td>
                  <td>
                    <span className="accessi-scelta-gruppo">
                      <i className="accessi-pallino" style={{ background: scelto?.colore ?? 'transparent', borderColor: scelto ? 'transparent' : 'var(--border-strong)' }} />
                      <select value={scelte[v.chiave]} onChange={(e) => setScelte({ ...scelte, [v.chiave]: e.target.value })} aria-label={`Gruppo di ${v.descrizione}`}>
                        <option value="">Senza gruppo</option>
                        {gruppi.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.nome}
                          </option>
                        ))}
                      </select>
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="accessi-salva">
        <button
          type="button"
          className="btn"
          disabled={inCorso || cambiati.length === 0}
          onClick={() =>
            avvia(async () => {
              const r = await salvaAssegnazioniVarchi(cambiati.map((v) => ({ chiave: v.chiave, gruppoId: scelte[v.chiave] || null })))
              setEsito(r)
              if (r.ok) router.refresh()
            })
          }
        >
          Salva assegnazioni{cambiati.length > 0 ? ` (${cambiati.length})` : ''}
        </button>
        <Messaggio esito={esito} />
      </div>
    </>
  )
}
