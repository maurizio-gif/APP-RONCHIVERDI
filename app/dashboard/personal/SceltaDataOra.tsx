'use client'

import { dataLunga, giornoPiu } from '@/lib/agenda'
import { MINUTI_SESSIONE, ORE_SESSIONE } from '@/lib/personal'

// Giorno e ora della sessione, al pollice: tre scorciatoie per il giorno
// (quasi sempre è oggi), il calendario del telefono per gli altri, e l'ora in
// due tocchi — l'ora su una griglia, poi il quarto.
//
// Non un <input type="time">: su iPhone ignora il passo di quindici minuti e
// apre una ruota da scorrere minuto per minuto, che è proprio il gesto lento
// che qui si vuole evitare.

export function SceltaDataOra({
  data,
  ora,
  oggi,
  min,
  max,
  onChange,
}: {
  data: string
  ora: string | null
  oggi: string
  min?: string
  max?: string
  onChange: (valore: { data: string; ora: string | null }) => void
}) {
  const scorciatoie = [
    { giorno: giornoPiu(oggi, -1), testo: 'Ieri' },
    { giorno: oggi, testo: 'Oggi' },
    { giorno: giornoPiu(oggi, 1), testo: 'Domani' },
  ].filter((s) => (!min || s.giorno >= min) && (!max || s.giorno <= max))

  const [oreScelte, minutiScelti] = ora ? ora.split(':') : [null, null]

  function scegliOre(ore: string) {
    onChange({ data, ora: `${ore}:${minutiScelti ?? '00'}` })
  }

  function scegliMinuti(minuti: string) {
    if (!oreScelte) return
    onChange({ data, ora: `${oreScelte}:${minuti}` })
  }

  return (
    <div className="pt-quando">
      <fieldset className="pt-fieldset">
        <legend>Giorno</legend>
        <div className="pt-giorni">
          {scorciatoie.map((s) => (
            <button
              key={s.giorno}
              type="button"
              className={`pt-tasto${data === s.giorno ? ' is-attivo' : ''}`}
              aria-pressed={data === s.giorno}
              onClick={() => onChange({ data: s.giorno, ora })}
            >
              {s.testo}
            </button>
          ))}
          <label className={`pt-tasto pt-altro-giorno${scorciatoie.some((s) => s.giorno === data) ? '' : ' is-attivo'}`}>
            <span>Altro giorno</span>
            <input
              type="date"
              value={data}
              min={min}
              max={max}
              onChange={(e) => e.target.value && onChange({ data: e.target.value, ora })}
              aria-label="Scegli un altro giorno"
            />
          </label>
        </div>
        <p className="pt-scelta-letta">{data ? dataLunga(data) : 'Nessun giorno scelto'}</p>
      </fieldset>

      <fieldset className="pt-fieldset">
        <legend>Ora d’inizio</legend>
        <div className="pt-ore">
          {ORE_SESSIONE.map((ore) => (
            <button
              key={ore}
              type="button"
              className={`pt-tasto${oreScelte === ore ? ' is-attivo' : ''}`}
              aria-pressed={oreScelte === ore}
              onClick={() => scegliOre(ore)}
            >
              {ore}
            </button>
          ))}
        </div>
        <p className="pt-sottotitolo">Minuti</p>
        <div className="pt-minuti" aria-label="Minuti">
          {MINUTI_SESSIONE.map((minuti) => (
            <button
              key={minuti}
              type="button"
              className={`pt-tasto${minutiScelti === minuti ? ' is-attivo' : ''}`}
              aria-pressed={minutiScelti === minuti}
              disabled={!oreScelte}
              onClick={() => scegliMinuti(minuti)}
            >
              :{minuti}
            </button>
          ))}
        </div>
        <p className="pt-scelta-letta">{ora ? `Alle ${ora}` : 'Tocca l’ora, poi i minuti'}</p>
      </fieldset>
    </div>
  )
}
