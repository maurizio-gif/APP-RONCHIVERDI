'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CLASSE_TIPO,
  ETICHETTE_TIPO_BREVI,
  dataBreve,
  eAppuntamentoVero,
  fasciaAdesso,
  normalizzaOra,
  testoFascia,
  type VoceAgenda,
} from '@/lib/agenda'
import { nomeDiEmail } from '@/lib/staff'
import { chiudiConEsito, registraTentativoRichiamo } from './agenda/esito-actions'
import { salvaGestione } from './richieste/actions'

// Le azioni, sul modello di Passion: una riga per azione. In dashboard si
// apre la scheda; nella scheda si chiude dalla riga — una nota se serve, e un bottone. Il resto
// (percorso sul sito, storico, trattativa) sta nella scheda della persona.
export function AzioniVeloci({
  voci,
  oggi,
  nomiStaff,
  mostraChi,
  conScheda = true,
}: {
  voci: VoceAgenda[]
  oggi: string
  nomiStaff: Record<string, string>
  mostraChi: boolean
  conScheda?: boolean
}) {
  return (
    <ul className="azioni-elenco">
      {voci.map((v) => (
        <RigaAzione key={v.chiave} v={v} oggi={oggi} nomiStaff={nomiStaff} mostraChi={mostraChi} conScheda={conScheda} />
      ))}
    </ul>
  )
}

function RigaAzione({
  v,
  oggi,
  nomiStaff,
  mostraChi,
  conScheda,
}: {
  v: VoceAgenda
  oggi: string
  nomiStaff: Record<string, string>
  mostraChi: boolean
  conScheda: boolean
}) {
  const router = useRouter()
  const [nota, setNota] = useState('')
  const [errore, setErrore] = useState<string | null>(null)
  const [fatta, setFatta] = useState(false)
  const [inCorso, avvia] = useTransition()

  // Un messaggio dal sito non si esegue e non fallisce: si segna gestito.
  // Tutto il resto (task, visite, telefonate) si chiude con l'esito.
  const soloGestito = v.origine === 'form_contatti' && !eAppuntamentoVero(v.tipo)
  const etichettaNo = v.tipo === 'appuntamento_in_sede' ? 'Non si è presentato' : 'Non risponde'
  const ora = v.dataDArrivo ? null : normalizzaOra(v.ora)
  // «Richiamami»: senza un'ora conta la fascia scelta, ed è quella che si
  // legge al posto di «oggi».
  const richiamo = v.origine === 'form_contatti' && v.fascia !== null
  const fascia = richiamo && !ora ? testoFascia(v.fascia!) : null
  const quando =
    v.data === oggi
      ? (ora ?? fascia ?? 'oggi')
      : `${dataBreve(v.data)}${ora ? ` · ${ora}` : fascia ? ` · ${fascia}` : ''}`
  const chi = nomeDiEmail(v.assegnatoA, nomiStaff) ?? 'nessuno'
  const dettaglio = v.attivita || v.note || (v.titolo !== v.persona ? v.titolo : null)

  function chiudi(esito: 'eseguita' | 'fallita' | 'gestito') {
    setErrore(null)
    // La nota resta, ma non blocca: senza, si scrive l'esito del bottone.
    const testo = nota.trim() || (esito === 'eseguita' ? 'Fatto' : esito === 'fallita' ? etichettaNo : 'Gestito')
    avvia(async () => {
      // Su un «Richiamami» «Non risponde» non chiude: registra il tentativo e
      // la richiesta resta da fare (vedi registraTentativoRichiamo).
      const r =
        esito === 'gestito'
          ? await salvaGestione({ id: v.id, gestito: true, nota: testo })
          : esito === 'fallita' && richiamo
            ? await registraTentativoRichiamo({ id: v.id, nota: testo })
            : await chiudiConEsito({ origine: v.origine, id: v.id, esito, nota: testo })
      if (!r.ok) {
        setErrore(r.errore ?? 'Non riuscito. Riprova.')
        return
      }
      if (esito === 'fallita' && richiamo) {
        setNota('')
      } else {
        setFatta(true)
      }
      router.refresh()
    })
  }

  return (
    <li className={`azione-riga${v.data < oggi ? ' is-arretrata' : ''}${fatta ? ' is-fatta' : ''}`}>
      <div className="azione-testo">
        <div className="azione-titolo">
          <span className={`badge badge-tipo ${CLASSE_TIPO[v.tipo]}`}>{ETICHETTE_TIPO_BREVI[v.tipo]}</span>
          <span className="azione-quando">{quando}</span>
          {conScheda && <span className="azione-nome">{v.persona ?? v.titolo}</span>}
          {conScheda && v.cellulare && (
            <a className="azione-tel" href={`tel:${v.cellulare}`}>
              {v.cellulare}
            </a>
          )}
          {mostraChi && <span className="muted azione-chi">· {chi}</span>}
          {richiamo && !ora && v.fascia === fasciaAdesso() && (
            <span className="badge badge-ok">è la sua fascia adesso</span>
          )}
          {v.tentativi && (
            <span className="muted">
              · {v.tentativi.numero === 1 ? '1 tentativo' : `${v.tentativi.numero} tentativi`}
            </span>
          )}
        </div>
        {dettaglio && <div className="azione-dettaglio muted">{dettaglio}</div>}
        {errore && <div className="azione-errore">{errore}</div>}
      </div>

      {conScheda && v.personaId && (
        <Link className="btn btn-ghost btn-sm" href={`/dashboard/persone/${v.personaId}`} target="_blank">
          Apri scheda ↗
        </Link>
      )}
      {/* In dashboard solo «Apri scheda»: l'azione si gestisce nella scheda. */}
      {conScheda ? null : fatta ? (
        <span className="badge badge-ok">Fatto ✓</span>
      ) : (
        <div className="azione-comandi">
          <input
            type="text"
            className="azione-nota"
            placeholder="Com'è andata"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            disabled={inCorso}
          />
          {soloGestito ? (
            <button className="btn btn-sm" disabled={inCorso} onClick={() => chiudi('gestito')}>
              Gestito ✓
            </button>
          ) : (
            <>
              <button className="btn btn-sm" disabled={inCorso} onClick={() => chiudi('eseguita')}>
                Fatto ✓
              </button>
              <button className="btn btn-ghost btn-sm" disabled={inCorso} onClick={() => chiudi('fallita')}>
                {richiamo ? 'Non risponde, riprovo' : etichettaNo}
              </button>
            </>
          )}
        </div>
      )}
    </li>
  )
}
