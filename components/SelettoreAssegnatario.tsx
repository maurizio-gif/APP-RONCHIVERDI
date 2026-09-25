'use client'

import { nomeDiEmail } from '@/lib/staff'

// Un solo gesto per "a chi è assegnato", ovunque compaia: prima erano tre —
// una tendina chiusa sulla trattativa, un campo di testo con suggerimenti
// sull'evento, un bottone di sola presa in carico altrove. Stessa tendina,
// stessa lista di persone tra cui scegliere; cambia solo l'etichetta della
// voce vuota, perché "nessuno" e "assegna a me di default" sono due cose
// diverse a seconda di dove si trova.
export function SelettoreAssegnatario({
  value,
  onChange,
  operatori,
  io,
  nomiStaff = {},
  etichettaVuoto = '— nessuno —',
  disabled = false,
  id,
  ariaLabel = 'Assegnato a',
}: {
  value: string | null
  onChange: (valore: string | null) => void
  /** Le email tra cui si può scegliere: solo i commerciali per una
   * trattativa, tutto lo staff per un evento. */
  operatori: string[]
  io?: string | null
  nomiStaff?: Record<string, string>
  etichettaVuoto?: string
  disabled?: boolean
  id?: string
  ariaLabel?: string
}) {
  // Un valore già assegnato ma non (più) nell'elenco — chi non ha ancora il
  // flag giusto, o chi se n'è andato — non deve leggersi come "nessuno": la
  // select lo mostrerebbe comunque vuota (nessuna option combacia), anche se
  // il dato sotto è ancora quello giusto. Un'opzione in più, solo quando
  // serve, tiene la tendina fedele allo stato reale.
  const valoreFuoriElenco = value && !operatori.includes(value)

  return (
    <select
      id={id}
      className="trattativa-select"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={ariaLabel}
    >
      <option value="">{etichettaVuoto}</option>
      {valoreFuoriElenco && (
        <option value={value}>{nomeDiEmail(value, nomiStaff)}</option>
      )}
      {operatori.map((o) => (
        <option key={o} value={o}>
          {o === io ? `${nomeDiEmail(o, nomiStaff)} (tu)` : nomeDiEmail(o, nomiStaff)}
        </option>
      ))}
    </select>
  )
}
