'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ETICHETTE_TIPO, TIPI_INSERIBILI, eSoloRegistrato, type TipoVoce } from '@/lib/agenda'
import { nomeDiEmail } from '@/lib/staff'
import { creaVoce } from '../../agenda/actions'

// Una nuova azione per questa persona, come il «Nuovo task» di Passion:
// tipo, quando, a chi, e la nota. Email e WhatsApp si registrano già fatti.
export function NuovaAzione({
  personaId,
  nome,
  oggi,
  io,
  operatori,
  nomiStaff,
}: {
  personaId: string
  nome: string
  oggi: string
  io: string | null
  operatori: string[]
  nomiStaff: Record<string, string>
}) {
  const router = useRouter()
  const modulo = useRef<HTMLFormElement>(null)
  const [tipo, setTipo] = useState<TipoVoce>('appuntamento_telefonico')
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, avvia] = useTransition()
  const registra = eSoloRegistrato(tipo)

  function invia(dati: FormData) {
    setErrore(null)
    dati.set('persona_id', personaId)
    dati.set('contatto_modo', 'elenco')
    dati.set('titolo', nome)
    dati.set('modo', registra ? 'registra' : 'programma')
    if (registra) {
      dati.set('esito', 'eseguita')
      dati.set('nota_esito', String(dati.get('note') ?? ''))
    }
    avvia(async () => {
      const r = await creaVoce(dati)
      if (!r.ok) {
        setErrore(r.errore ?? 'Non riuscito. Riprova.')
        return
      }
      modulo.current?.reset()
      router.refresh()
    })
  }

  return (
    <form ref={modulo} action={invia} className="nuova-azione">
      <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoVoce)} aria-label="Tipo">
        {TIPI_INSERIBILI.map((t) => (
          <option key={t} value={t}>
            {ETICHETTE_TIPO[t]}
          </option>
        ))}
      </select>
      <input type="date" name="data" defaultValue={oggi} aria-label="Giorno" required />
      <input type="time" name="ora" aria-label="Ora" />
      <select name="assegnato_a" defaultValue={io ?? ''} aria-label="A chi">
        {operatori.map((o) => (
          <option key={o} value={o}>
            {o === io ? 'Io' : (nomeDiEmail(o, nomiStaff) ?? o)}
          </option>
        ))}
      </select>
      <input type="text" name="note" placeholder="Cosa c'è da fare" className="nuova-azione-nota" required />
      <button className="btn btn-sm" disabled={inCorso}>
        {registra ? 'Registra' : 'Aggiungi'}
      </button>
      {errore && <div className="azione-errore">{errore}</div>}
    </form>
  )
}
