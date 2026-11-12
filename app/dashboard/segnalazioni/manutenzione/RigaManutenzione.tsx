'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { passoSegnalazione, type Passo } from '../actions'
import {
  CLASSE_LIVELLO,
  ETICHETTA_COLORE,
  giornoLeggibile,
  quando,
  type ColoreManutenzione,
} from '@/lib/segnalazioni'

// Una riga della manutenzione: il colore dice a che punto è, la data prevista
// e chi interviene si scrivono qui, senza aprire la scheda. «Fatto» chiude
// l'intervento (la nota e le foto, se servono, si aggiungono dalla scheda).

export function RigaManutenzione({
  id,
  numero,
  titolo,
  descrizione,
  livello,
  richiestoDa,
  ricevutaIl,
  colore,
  aperta,
  inRitardo,
  assegnatoA,
  dataPrevista,
  fattaIl,
  manutentori,
}: {
  id: string
  numero: number
  titolo: string
  descrizione: string
  livello: number
  richiestoDa: string
  ricevutaIl: string
  colore: ColoreManutenzione
  aperta: boolean
  inRitardo: boolean
  assegnatoA: string | null
  dataPrevista: string | null
  fattaIl: string | null
  manutentori: { email: string; nome: string }[]
}) {
  const router = useRouter()
  const [data, setData] = useState(dataPrevista ?? '')
  const [chi, setChi] = useState(assegnatoA ?? '')
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, setInCorso] = useState<Passo | null>(null)
  // Cambiato rispetto a quello salvato: il pulsante Salva compare solo allora.
  const modificato = data !== (dataPrevista ?? '') || chi !== (assegnatoA ?? '')

  async function esegui(passo: Passo) {
    setErrore(null)
    setInCorso(passo)
    try {
      const esito = await passoSegnalazione(
        id,
        passo,
        '',
        passo === 'programma' && chi ? chi : undefined,
        [],
        passo === 'programma' ? data : undefined
      )
      if (!esito.ok) {
        setErrore(esito.errore)
        return
      }
      router.refresh()
    } catch (e) {
      setErrore(e instanceof Error ? e.message : 'Qualcosa è andato storto. Riprova.')
    } finally {
      setInCorso(null)
    }
  }

  return (
    <tr className={`sg-riga sg-riga-${colore}`}>
      <td className="cella-nowrap">
        <Link href={`/dashboard/segnalazioni/${id}`}>#{numero}</Link>
      </td>
      <td>
        <Link href={`/dashboard/segnalazioni/${id}`} className="cella-chi-nome">
          {titolo}
        </Link>
        <div className="cella-chi-dettagli sg-anteprima">{descrizione}</div>
      </td>
      <td className="cella-nowrap">
        <span className={CLASSE_LIVELLO[livello] ?? 'badge'}>{livello} / 5</span>
      </td>
      <td>
        {richiestoDa}
        <div className="cella-chi-dettagli">{quando(ricevutaIl)}</div>
      </td>
      <td>
        {aperta ? (
          <select value={chi} onChange={(e) => setChi(e.target.value)} disabled={!!inCorso} aria-label={`Chi interviene, richiesta ${numero}`}>
            <option value="">—</option>
            {manutentori.map((m) => (
              <option key={m.email} value={m.email}>
                {m.nome}
              </option>
            ))}
          </select>
        ) : (
          (manutentori.find((m) => m.email === assegnatoA)?.nome ?? assegnatoA ?? '—')
        )}
      </td>
      <td>
        {aperta ? (
          <div className="sg-riga-data">
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              disabled={!!inCorso}
              aria-label={`Data prevista, richiesta ${numero}`}
            />
            {modificato && (
              <button type="button" className="btn btn-sm" onClick={() => esegui('programma')} disabled={!!inCorso}>
                {inCorso === 'programma' ? '…' : 'Salva'}
              </button>
            )}
          </div>
        ) : (
          <span>
            {giornoLeggibile(dataPrevista)}
            {fattaIl && <div className="cella-chi-dettagli">fatto il {quando(fattaIl)}</div>}
          </span>
        )}
        {errore && <p className="field-hint errore-campo">{errore}</p>}
      </td>
      <td className="cella-nowrap">
        <span className={`badge sg-colore-${colore}`}>{ETICHETTA_COLORE[colore]}</span>
        {inRitardo && <span className="badge badge-ko sg-ritardo">in ritardo</span>}
        <div style={{ marginTop: '0.35rem' }}>
          {aperta ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => esegui('risolvi')} disabled={!!inCorso}>
              {inCorso === 'risolvi' ? '…' : '✓ Fatto'}
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => esegui('riapri')} disabled={!!inCorso}>
              {inCorso === 'riapri' ? '…' : 'Riapri'}
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
