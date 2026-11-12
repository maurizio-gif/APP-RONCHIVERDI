'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { registraSegnalazione } from '../actions'
import { CampoNote } from '@/components/CampoNote'
import { RicercaSocio, type SocioScelto } from './RicercaSocio'
import { SceltaFoto, useFoto } from '../Foto'
import { ETICHETTE_CANALE, URGENZE, type Canale, type Voce } from '@/lib/segnalazioni'

// Il modulo della reception. Settore, motivo e urgenza sono scelte da
// elenchi chiusi (l'Excel aveva 65 modi di scrivere i settori); il resto è il
// racconto, e il nome del socio se c'è.

export function NuovaSegnalazione({ settori, motivi }: { settori: Voce[]; motivi: Voce[] }) {
  const router = useRouter()
  const [settore, setSettore] = useState('')
  const [motivo, setMotivo] = useState('')
  const [urgenza, setUrgenza] = useState('disservizio')
  const [canale, setCanale] = useState<Canale>('reception')
  const [descrizione, setDescrizione] = useState('')
  const [socio, setSocio] = useState<SocioScelto | null>(null)
  const [richiamo, setRichiamo] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, setInCorso] = useState(false)
  const foto = useFoto()

  async function invia(e: React.FormEvent) {
    e.preventDefault()
    setErrore(null)
    setInCorso(true)
    try {
      const caricate = await foto.carica()
      const esito = await registraSegnalazione({
        settore,
        motivo,
        urgenza,
        canale,
        descrizione,
        personaId: socio?.personaId ?? null,
        socioNome: socio?.nome ?? '',
        richiamoRichiesto: richiamo,
        foto: caricate,
      })
      if (!esito.ok) {
        setErrore(esito.errore)
        setInCorso(false)
        return
      }
      router.push(`/dashboard/segnalazioni/${esito.id}?registrata=1`)
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'Qualcosa è andato storto. Riprova.')
      setInCorso(false)
    }
  }

  return (
    <form className="card tk-form" onSubmit={invia}>
      <div className="sg-coppia">
        <div className="field">
          <label htmlFor="sg-settore">Dove</label>
          <select id="sg-settore" value={settore} onChange={(e) => setSettore(e.target.value)} required>
            <option value="">Scegli il settore…</option>
            {settori.map((s) => (
              <option key={s.chiave} value={s.chiave}>
                {s.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sg-motivo">Cosa</label>
          <select id="sg-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} required>
            <option value="">Scegli il motivo…</option>
            {motivi.map((m) => (
              <option key={m.chiave} value={m.chiave}>
                {m.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="field sg-urgenza">
        <legend>Quanto è urgente</legend>
        {URGENZE.map((u) => (
          <label key={u.chiave} className={`sg-opzione${urgenza === u.chiave ? ' sg-opzione-attiva' : ''}`}>
            <input type="radio" name="urgenza" value={u.chiave} checked={urgenza === u.chiave} onChange={() => setUrgenza(u.chiave)} />
            <span>
              <b>{u.nome}</b>
              <span className="muted">{u.criterio}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="field">
        <label htmlFor="sg-descrizione">Cosa è successo</label>
        <CampoNote
          id="sg-descrizione"
          rows={4}
          value={descrizione}
          onChange={(e) => setDescrizione(e.target.value)}
          maxLength={4000}
          placeholder="es. Nella sauna nessuno usa il telo e ci sono molte sacche all’interno."
          required
        />
      </div>

      <div className="field">
        <span className="campo-etichetta">Foto (facoltativa)</span>
        <SceltaFoto foto={foto} disabilitato={inCorso} />
      </div>

      <RicercaSocio valore={socio} onChange={setSocio} />

      <div className="field">
        <label htmlFor="sg-canale">Come è arrivata</label>
        <select id="sg-canale" value={canale} onChange={(e) => setCanale(e.target.value as Canale)}>
          {(Object.keys(ETICHETTE_CANALE) as Canale[]).map((c) => (
            <option key={c} value={c}>
              {ETICHETTE_CANALE[c]}
            </option>
          ))}
        </select>
      </div>

      <label className="sg-spunta">
        <input type="checkbox" checked={richiamo} onChange={(e) => setRichiamo(e.target.checked)} />
        <span>
          Il socio vuole essere richiamato
          <span className="muted"> — la segnalazione resta aperta finché la customer care non lo richiama.</span>
        </span>
      </label>

      {errore && <p className="error-banner">{errore}</p>}

      <div className="tk-invia">
        <button type="submit" className="btn" disabled={inCorso}>
          {inCorso ? 'Registro…' : 'Registra la segnalazione'}
        </button>
        <span className="muted">Va al responsabile del settore, se c’è; altrimenti resta da assegnare.</span>
      </div>
    </form>
  )
}
