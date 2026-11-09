'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  CLASSE_STATO,
  ETICHETTE_STATO,
  ETICHETTE_TIPO,
  STATI,
  dataBreve,
  durata,
  pesoLeggibile,
  type AllegatoVoce,
  type StatoVoce,
  type VocePiano,
} from '@/lib/piano-editoriale'
import { aggiornaVoce, eliminaVoce, urlFilePiano } from './actions'

// Una richiesta del piano, con i suoi file e i comandi di chi può agire:
// chi gestisce risponde (stato, nota, data, ore), chi l'ha scritta può
// eliminarla finché è ancora «richiesta».

export function SchedaVoce({
  voce,
  allegati,
  richiedente,
  gestisce,
  propria,
}: {
  voce: VocePiano
  allegati: AllegatoVoce[]
  richiedente: string
  gestisce: boolean
  propria: boolean
}) {
  const router = useRouter()
  const [inCorso, avvia] = useTransition()
  const [stato, setStato] = useState<StatoVoce>(voce.stato)
  const [nota, setNota] = useState(voce.nota_gestione ?? '')
  const [data, setData] = useState(voce.data_pubblicazione)
  const [ore, setOre] = useState(String(Math.round(Number(voce.ore_stimate) * 60)))
  const [errore, setErrore] = useState<string | null>(null)

  async function apri(id: string) {
    setErrore(null)
    const r = await urlFilePiano(id)
    if (!r.ok) setErrore(r.errore)
    else window.open(r.url, '_blank', 'noopener')
  }

  function salva() {
    setErrore(null)
    avvia(async () => {
      const r = await aggiornaVoce(voce.id, { stato, nota, data, minuti: Number(ore.replace(',', '.')) })
      if (!r.ok) setErrore(r.errore)
      else router.refresh()
    })
  }

  function elimina() {
    if (!window.confirm('Eliminare questa richiesta? Non si può annullare.')) return
    setErrore(null)
    avvia(async () => {
      const r = await eliminaVoce(voce.id)
      if (!r.ok) setErrore(r.errore)
      else router.refresh()
    })
  }

  const puoEliminare = gestisce || (propria && voce.stato === 'richiesta')

  return (
    <article id={`voce-${voce.id}`} className={`card pe-voce${voce.urgente ? ' pe-voce-urgente' : ''}`}>
      <header className="pe-voce-testa">
        <div>
          <span className="pe-voce-data">{dataBreve(voce.data_pubblicazione)}</span>
          <h3 className="pe-voce-titolo">{voce.titolo}</h3>
          <p className="muted pe-voce-meta">
            {ETICHETTE_TIPO[voce.tipo]}
            {voce.reparto ? ` · ${voce.reparto}` : ''} · chiesto da {richiedente} · ~{durata(voce.ore_stimate)}
          </p>
        </div>
        <div className="pe-voce-badge">
          {voce.urgente && <span className="badge badge-ko">Urgente</span>}
          <span className={CLASSE_STATO[voce.stato]}>{ETICHETTE_STATO[voce.stato]}</span>
        </div>
      </header>

      {voce.urgente && voce.motivo_urgenza && (
        <p className="pe-urgenza">
          <b>Perché urgente:</b> {voce.motivo_urgenza}
        </p>
      )}
      {voce.descrizione && <p className="pe-voce-testo">{voce.descrizione}</p>}
      {voce.link && (
        <p>
          <a href={voce.link} target="_blank" rel="noopener noreferrer">
            {voce.link}
          </a>
        </p>
      )}
      {allegati.length > 0 && (
        <ul className="pe-file">
          {allegati.map((a) => (
            <li key={a.id}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => apri(a.id)}>
                📎 {a.nome}
              </button>
              <span className="muted">{pesoLeggibile(a.byte)}</span>
            </li>
          ))}
        </ul>
      )}
      {voce.nota_gestione && !gestisce && (
        <p className="pe-nota">
          <b>Risposta di Giada:</b> {voce.nota_gestione}
        </p>
      )}

      {gestisce && (
        <div className="pe-gestione">
          <div className="pe-riga">
            <div className="field">
              <label htmlFor={`st-${voce.id}`}>Stato</label>
              <select id={`st-${voce.id}`} value={stato} onChange={(e) => setStato(e.target.value as StatoVoce)}>
                {STATI.map((s) => (
                  <option key={s.chiave} value={s.chiave}>
                    {s.testo}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`da-${voce.id}`}>Data</label>
              <input id={`da-${voce.id}`} type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`or-${voce.id}`}>Minuti stimati</label>
              <input
                id={`or-${voce.id}`}
                inputMode="decimal"
                value={ore}
                onChange={(e) => setOre(e.target.value)}
                style={{ maxWidth: '6rem' }}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor={`no-${voce.id}`}>Nota per chi l’ha chiesto</label>
            <textarea
              id={`no-${voce.id}`}
              rows={2}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              maxLength={1000}
              placeholder="Obbligatoria se non è realizzabile; utile se sposti la data"
            />
          </div>
        </div>
      )}

      {errore && <p className="error-banner">{errore}</p>}

      {(gestisce || puoEliminare) && (
        <div className="tk-bottoni">
          {gestisce && (
            <button type="button" className="btn btn-sm" onClick={salva} disabled={inCorso}>
              {inCorso ? 'Salvo…' : 'Salva'}
            </button>
          )}
          {puoEliminare && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={elimina} disabled={inCorso}>
              Elimina
            </button>
          )}
        </div>
      )}
    </article>
  )
}
