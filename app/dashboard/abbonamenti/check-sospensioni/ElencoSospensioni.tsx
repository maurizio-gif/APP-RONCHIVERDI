'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { dataOra } from '@/lib/persone'
import { nomeDiEmail } from '@/lib/staff'
import { LUNGHEZZA_MASSIMA_MOTIVO, type MotivoSospensione } from '@/lib/sospensioni'
import { CampoNote } from '@/components/CampoNote'
import { aggiungiMotivoSospensione } from './actions'

export type RigaCheck = {
  source_log_id: number
  data_operazione: string
  operatore_nome: string | null
  source_iscrizione_id: number | null
  persona_id: string | null
  persona_nome: string | null
  persona_cognome: string | null
  abbonamento: string | null
  variante: string | null
  fine_precedente: string | null
  fine_nuova: string | null
  proroga_giorni: number
  // La più recente in cima.
  motivi: MotivoSospensione[]
}

const data = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')

export function ElencoSospensioni({
  righe,
  nomiStaff,
  mostraOperatore,
  daMotivare,
}: {
  righe: RigaCheck[]
  nomiStaff: Record<string, string>
  mostraOperatore: boolean
  // In «Da motivare» il campo è già aperto; in «Motivate» si apre con Rettifica.
  daMotivare: boolean
}) {
  // In «Da motivare» la riga esce dall'elenco appena salvata (la pagina si
  // ricarica dal server): resta questa conferma, per sapere che è andata.
  const [salvato, setSalvato] = useState<string | null>(null)

  return (
    <>
    {salvato && (
      <p className="field-hint check-sosp-salvato" role="status">
        ✓ Motivo salvato: {salvato}.
      </p>
    )}
    <div className="tabella-wrap">
      <table className="tabella tabella-compatta">
        <thead>
          <tr>
            <th>Inserita il</th>
            <th>Socio</th>
            <th>Abbonamento</th>
            <th className="cella-importo" title="Di quanti giorni è stata spostata la scadenza">
              Sospensione
            </th>
            {mostraOperatore && <th>Operatore</th>}
            <th className="check-sosp-col-motivo">Motivo</th>
          </tr>
        </thead>
        <tbody>
          {righe.map((r) => {
            const persona = [r.persona_cognome, r.persona_nome].filter(Boolean).join(' ') || 'Senza nome'
            return (
              <tr key={r.source_log_id}>
                <td className="cella-nowrap">{dataOra(r.data_operazione)}</td>
                <td className="cella-persona">
                  {r.persona_id ? <Link href={`/dashboard/persone/${r.persona_id}`}>{persona}</Link> : persona}
                </td>
                <td className="cella-troncata" title={[r.abbonamento, r.variante].filter(Boolean).join(' · ') || undefined}>
                  {r.abbonamento ?? '—'}
                  {r.variante && <span className="nota-in-riga">{r.variante}</span>}
                </td>
                <td className="cella-importo cella-nowrap">
                  <strong>{r.proroga_giorni} giorni</strong>
                  <span className="nota-in-riga">
                    fine {data(r.fine_precedente)} → {data(r.fine_nuova)}
                  </span>
                </td>
                {mostraOperatore && <td className="cella-nowrap">{r.operatore_nome ?? '—'}</td>}
                <td className="check-sosp-col-motivo">
                  <CellaMotivo
                    sourceLogId={r.source_log_id}
                    noteIniziali={r.motivi}
                    nomiStaff={nomiStaff}
                    apertoDaSubito={daMotivare}
                    onSalvato={() => setSalvato(persona)}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    </>
  )
}

function CellaMotivo({
  sourceLogId,
  noteIniziali,
  nomiStaff,
  apertoDaSubito,
  onSalvato,
}: {
  sourceLogId: number
  noteIniziali: MotivoSospensione[]
  nomiStaff: Record<string, string>
  apertoDaSubito: boolean
  onSalvato: () => void
}) {
  const [note, setNote] = useState(noteIniziali)
  const [scrivo, setScrivo] = useState(apertoDaSubito && noteIniziali.length === 0)
  const [storico, setStorico] = useState(false)
  const [testo, setTesto] = useState('')
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  const ultima = note[0]
  const rettifica = note.length > 0

  function salva() {
    if (!testo.trim() || inCorso) return
    setErrore(null)
    startTransition(async () => {
      const esito = await aggiungiMotivoSospensione(sourceLogId, testo)
      if (esito.ok) {
        setNote((v) => [esito.nota, ...v])
        setTesto('')
        setScrivo(false)
        onSalvato()
      } else {
        setErrore(esito.errore)
      }
    })
  }

  return (
    <div className="check-sosp-motivo">
      {ultima && (
        <div className="check-sosp-ultima">
          <p className="note-storico-testo">{ultima.testo}</p>
          <span className="note-storico-meta">
            {nomeDiEmail(ultima.autore, nomiStaff) ?? ultima.autore} · {dataOra(ultima.creato_il)}
            {note.length > 1 && ' · rettifica'}
          </span>
        </div>
      )}

      {scrivo ? (
        <div className="note-nuova is-scritta">
          <CampoNote
            className="textarea-inline"
            rows={2}
            value={testo}
            maxLength={LUNGHEZZA_MASSIMA_MOTIVO}
            placeholder={rettifica ? 'Rettifica: cosa va corretto…' : 'Motivo della sospensione e giustificativo ricevuto…'}
            onChange={(e) => setTesto(e.target.value)}
            onKeyDown={(e) => {
              // Cmd/Ctrl + Invio salva, come nelle note dei rinnovi.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                salva()
              }
            }}
            disabled={inCorso}
            aria-label={rettifica ? 'Rettifica del motivo' : 'Motivo della sospensione'}
          />
          <div className="note-gestione-azioni">
            <button type="button" className="btn btn-sm" onClick={salva} disabled={inCorso || !testo.trim()}>
              {inCorso ? 'Salvo…' : rettifica ? 'Salva rettifica' : 'Salva motivo'}
            </button>
            {(rettifica || !apertoDaSubito) && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setScrivo(false)
                  setTesto('')
                  setErrore(null)
                }}
                disabled={inCorso}
              >
                Annulla
              </button>
            )}
          </div>
          <p className="field-hint">Una volta salvato non si modifica: si può solo aggiungere una rettifica.</p>
        </div>
      ) : (
        <div className="note-gestione-riga">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setScrivo(true)}>
            {rettifica ? 'Aggiungi rettifica' : 'Scrivi il motivo'}
          </button>
          {note.length > 1 && (
            <button type="button" className="note-contatore" onClick={() => setStorico((v) => !v)} aria-expanded={storico}>
              Storico ({note.length})
            </button>
          )}
        </div>
      )}

      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)' }}>
          {errore}
        </p>
      )}

      {storico && note.length > 1 && (
        <ul className="note-storico">
          {note.map((n, i) => (
            <li key={n.id}>
              <span className="note-storico-meta">
                {nomeDiEmail(n.autore, nomiStaff) ?? n.autore} · {dataOra(n.creato_il)}
                {i === note.length - 1 ? ' · motivo' : ' · rettifica'}
              </span>
              <p className="note-storico-testo">{n.testo}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
