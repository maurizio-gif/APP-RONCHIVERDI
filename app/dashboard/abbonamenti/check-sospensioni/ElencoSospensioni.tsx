'use client'

import Link from 'next/link'
import { useState, useTransition, type Dispatch, type SetStateAction } from 'react'
import { dataOra } from '@/lib/persone'
import { nomeDiEmail } from '@/lib/staff'
import { pesoLeggibile } from '@/lib/ticket'
import { LUNGHEZZA_MASSIMA_MOTIVO, type DocumentoSospensione, type MotivoSospensione } from '@/lib/sospensioni'
import { CampoNote } from '@/components/CampoNote'
import { aggiungiMotivoSospensione, urlDocumentoSospensione } from './actions'
import { SceltaDocumenti, useDocumenti } from './Documenti'

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
  // In «Da motivare», aperta la riga il campo è già pronto; in «Motivate» si
  // apre con Rettifica.
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
            <th aria-label="Gestione"></th>
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
          {righe.map((r) => (
            <RigaSospensione
              key={r.source_log_id}
              r={r}
              nomiStaff={nomiStaff}
              mostraOperatore={mostraOperatore}
              daMotivare={daMotivare}
              onSalvato={setSalvato}
            />
          ))}
        </tbody>
      </table>
    </div>
    </>
  )
}

// Una sospensione: la riga chiusa mostra solo l'anteprima del motivo, se c'è;
// «Gestisci» apre sotto il motivo intero, il campo per scriverlo o rettificarlo
// e i documenti. Le note stanno qui e non nella cella aperta, così l'anteprima
// si aggiorna anche a riga richiusa.
function RigaSospensione({
  r,
  nomiStaff,
  mostraOperatore,
  daMotivare,
  onSalvato,
}: {
  r: RigaCheck
  nomiStaff: Record<string, string>
  mostraOperatore: boolean
  daMotivare: boolean
  onSalvato: (persona: string) => void
}) {
  const [aperta, setAperta] = useState(false)
  const [note, setNote] = useState(r.motivi)
  const persona = [r.persona_cognome, r.persona_nome].filter(Boolean).join(' ') || 'Senza nome'
  const anteprima = note[0]?.testo
  const colonne = mostraOperatore ? 7 : 6
  const idGestione = `check-sosp-${r.source_log_id}`

  return (
    <>
      <tr>
        {/* Il pulsante sta a sinistra, dove si apre la gestione: a destra
            bisognerebbe scorrere la tabella per trovarlo. */}
        <td className="check-sosp-col-gestisci">
          <button
            type="button"
            className="btn btn-ghost btn-sm richiesta-espandi"
            onClick={() => setAperta((v) => !v)}
            aria-expanded={aperta}
            aria-controls={idGestione}
            aria-label={`Gestisci la sospensione di ${persona}`}
          >
            Gestisci <span className="richiesta-caret" aria-hidden="true">▼</span>
          </button>
        </td>
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
          <span className="check-sosp-anteprima" title={anteprima}>
            {anteprima}
          </span>
        </td>
      </tr>
      {aperta && (
        <tr id={idGestione} className="check-sosp-gestione">
          <td colSpan={colonne}>
            <CellaMotivo
              sourceLogId={r.source_log_id}
              note={note}
              setNote={setNote}
              nomiStaff={nomiStaff}
              apertoDaSubito={daMotivare}
              onSalvato={() => onSalvato(persona)}
            />
          </td>
        </tr>
      )}
    </>
  )
}

function CellaMotivo({
  sourceLogId,
  note,
  setNote,
  nomiStaff,
  apertoDaSubito,
  onSalvato,
}: {
  sourceLogId: number
  note: MotivoSospensione[]
  setNote: Dispatch<SetStateAction<MotivoSospensione[]>>
  nomiStaff: Record<string, string>
  apertoDaSubito: boolean
  onSalvato: () => void
}) {
  const [scrivo, setScrivo] = useState(apertoDaSubito && note.length === 0)
  const [storico, setStorico] = useState(false)
  const [testo, setTesto] = useState('')
  const [errore, setErrore] = useState<string | null>(null)
  const [avviso, setAvviso] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()
  const documenti = useDocumenti()

  const ultima = note[0]
  const rettifica = note.length > 0

  function salva() {
    if (!testo.trim() || inCorso) return
    setErrore(null)
    setAvviso(null)
    startTransition(async () => {
      // Prima i documenti, poi la nota: se un file non sale la nota non si
      // salva (una nota non si cancella) e si può riprovare.
      let caricati
      try {
        caricati = await documenti.carica()
      } catch (e) {
        setErrore(e instanceof Error ? e.message : 'Non è stato possibile caricare i documenti.')
        return
      }
      const esito = await aggiungiMotivoSospensione(sourceLogId, testo, caricati)
      if (esito.ok) {
        setNote((v) => [esito.nota, ...v])
        setTesto('')
        documenti.svuota()
        setScrivo(false)
        if (esito.avviso) setAvviso(esito.avviso)
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
          <ElencoDocumenti documenti={ultima.documenti} />
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
          <SceltaDocumenti documenti={documenti} disabilitato={inCorso} />
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
                  documenti.svuota()
                }}
                disabled={inCorso}
              >
                Annulla
              </button>
            )}
          </div>
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
      {avviso && (
        <p className="field-hint" style={{ color: 'var(--error)' }} role="status">
          {avviso}
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
              <ElencoDocumenti documenti={n.documenti} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// I documenti allegati a una nota: il nome si clicca e il documento si apre in
// una tab nuova, da vedere (non si scarica). Rimuoverli, una volta visionati,
// si gestisce dal CRM più avanti.
function ElencoDocumenti({ documenti }: { documenti: DocumentoSospensione[] | undefined }) {
  const [inApertura, setInApertura] = useState<string | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  if (!documenti?.length) return null

  async function apri(id: string) {
    if (inApertura) return
    setErrore(null)
    setInApertura(id)
    // La tab si apre subito, dentro il clic, perché dopo l'attesa il browser
    // potrebbe bloccarla; l'indirizzo firmato la raggiunge appena arriva.
    const finestra = window.open('', '_blank')
    if (finestra) finestra.opener = null
    const esito = await urlDocumentoSospensione(id)
    if (esito.ok) {
      if (finestra) finestra.location.href = esito.url
      else window.open(esito.url, '_blank', 'noopener')
    } else {
      finestra?.close()
      setErrore(esito.errore)
    }
    setInApertura(null)
  }

  return (
    <>
      <ul className="tk-allegati-elenco">
        {documenti.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              className="check-sosp-documento"
              onClick={() => apri(d.id)}
              disabled={inApertura === d.id}
              title="Apri il documento in una tab nuova"
            >
              📎 {d.nome}
            </button>
            <span className="muted">{inApertura === d.id ? 'Apro…' : pesoLeggibile(d.byte)}</span>
          </li>
        ))}
      </ul>
      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)' }}>
          {errore}
        </p>
      )}
    </>
  )
}
