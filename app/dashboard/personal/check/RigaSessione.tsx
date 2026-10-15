'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { dataBreve, normalizzaOra } from '@/lib/agenda'
import {
  CLASSE_STATO_SESSIONE,
  ETICHETTE_STATO_SESSIONE,
  dataDiIstante,
  mancaNomeScritto,
  nomeCliente,
  type ClienteScelto,
  type SessionePersonal,
} from '@/lib/personal'
import { nomeStaff, type RigaStaff } from '@/lib/staff'
import { confermaSessioni, eliminaSessione, modificaSessione, rimettiInAttesa, type EsitoAzione } from '../actions'
import { SceltaCliente } from '../SceltaCliente'
import { SceltaDataOra } from '../SceltaDataOra'

const COLONNE = 7

/**
 * Il cliente già salvato, nella forma del modulo: la correzione parte da lì,
 * e se il responsabile non lo tocca il server tiene quello di prima (vedi
 * verificaClienteOAttuale).
 */
function clienteDellaSessione(s: SessionePersonal): ClienteScelto | null {
  if (s.corporate && !s.persona_id) {
    return { tipo: 'azienda_manuale', azienda: s.azienda ?? '', nome: s.cliente_nome, cognome: s.cliente_cognome }
  }
  if (!s.persona_id || !s.abbonamento_id) return null
  if (s.corporate) {
    return {
      tipo: 'corporate',
      personaId: s.persona_id,
      abbonamentoId: s.abbonamento_id,
      azienda: s.azienda ?? '',
      tessera: '',
      abbonamento: s.abbonamento_nome ?? '',
      nome: s.cliente_nome,
      cognome: s.cliente_cognome,
    }
  }
  return {
    tipo: 'socio',
    personaId: s.persona_id,
    abbonamentoId: s.abbonamento_id,
    nome: s.cliente_nome,
    cognome: s.cliente_cognome,
    dataNascita: null,
    abbonamenti: s.abbonamento_nome ? [s.abbonamento_nome] : [],
  }
}

export function RigaSessione({
  sessione: s,
  trainer,
  nomiStaff,
  oggi,
}: {
  sessione: SessionePersonal
  trainer: RigaStaff[]
  nomiStaff: Record<string, string>
  oggi: string
}) {
  const [aperta, setAperta] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  // Lo stato della correzione, inizializzato dalla sessione.
  const [cliente, setCliente] = useState<ClienteScelto | null>(() => clienteDellaSessione(s))
  const [quando, setQuando] = useState<{ data: string; ora: string | null }>({
    data: s.data,
    ora: normalizzaOra(s.ora),
  })
  const [trainerEmail, setTrainerEmail] = useState(s.trainer_email)

  function esegui(azione: () => Promise<EsitoAzione>, dopo?: () => void) {
    setErrore(null)
    startTransition(async () => {
      try {
        const esito = await azione()
        if (!esito.ok) setErrore(esito.errore)
        else dopo?.()
      } catch {
        setErrore('Operazione non riuscita: controlla la connessione e riprova.')
      }
    })
  }

  function apriModifica() {
    setCliente(clienteDellaSessione(s))
    setQuando({ data: s.data, ora: normalizzaOra(s.ora) })
    setTrainerEmail(s.trainer_email)
    setErrore(null)
    setAperta(true)
  }

  const nomeCorporateMancante = mancaNomeScritto(cliente)
  const pronta = !!cliente && !nomeCorporateMancante && !!quando.ora

  // Il trainer della sessione resta fra le scelte anche se non ha più la
  // sezione: correggere l'ora non deve obbligare a cambiarlo.
  const sceltaTrainer = trainer.some((t) => t.email === s.trainer_email)
    ? trainer
    : [{ email: s.trainer_email, nome: s.trainer_nome }, ...trainer]

  return (
    <>
      <tr className={s.stato === 'in_attesa' ? 'pt-riga-attesa' : undefined}>
        <td className="cella-nowrap">
          <strong>{dataBreve(s.data)}</strong>
          <div className="cella-chi-dettagli">ore {normalizzaOra(s.ora)}</div>
        </td>
        <td>{s.trainer_nome || nomiStaff[s.trainer_email] || s.trainer_email}</td>
        <td>
          <div className="cella-chi-nome">
            {s.persona_id ? (
              <Link href={`/dashboard/persone/${s.persona_id}`} className="link">
                {nomeCliente(s)}
              </Link>
            ) : (
              nomeCliente(s)
            )}
          </div>
          {s.corporate && (
            <div className="cella-chi-dettagli">
              <span className="badge badge-info">Corporate</span> {s.azienda}
              {/* Scritta a mano dal trainer: da verificare, ed eventualmente
                  agganciare all'abbonamento giusto con Modifica. */}
              {!s.persona_id && <span className="badge badge-warn">azienda scritta a mano</span>}
            </div>
          )}
        </td>
        <td className="cella-chi-dettagli">{s.abbonamento_nome ?? '—'}</td>
        <td className="cella-nowrap">
          <span className={CLASSE_STATO_SESSIONE[s.stato]}>{ETICHETTE_STATO_SESSIONE[s.stato]}</span>
          {s.stato === 'confermata' && s.confermata_il && (
            <div className="cella-chi-dettagli">
              {dataDiIstante(s.confermata_il)}
              {s.confermata_da ? ` · ${nomiStaff[s.confermata_da] ?? s.confermata_da}` : ''}
            </div>
          )}
        </td>
        <td className="cella-nowrap cella-chi-dettagli">
          {dataDiIstante(s.created_at)}
          {s.modificata_il && <div>corretta da {nomiStaff[s.modificata_da ?? ''] ?? s.modificata_da}</div>}
        </td>
        <td>
          <div className="voce-azioni">
            {s.stato === 'in_attesa' ? (
              <button
                type="button"
                className="btn btn-sm"
                disabled={inCorso}
                onClick={() => esegui(() => confermaSessioni([s.id]))}
              >
                Conferma
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={inCorso}
                onClick={() => esegui(() => rimettiInAttesa(s.id))}
              >
                Rimetti in attesa
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={inCorso}
              onClick={() => (aperta ? setAperta(false) : apriModifica())}
            >
              {aperta ? 'Chiudi' : 'Modifica'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-danger"
              disabled={inCorso}
              onClick={() => {
                if (!confirm(`Eliminare la sessione di ${nomeCliente(s)} del ${dataBreve(s.data)}? Non si recupera.`)) return
                esegui(() => eliminaSessione(s.id))
              }}
            >
              Elimina
            </button>
          </div>
          {errore && !aperta && <p className="error-banner">{errore}</p>}
        </td>
      </tr>

      {aperta && (
        <tr className="pt-riga-modifica">
          <td colSpan={COLONNE}>
            <div className="pt-modifica">
              <div className="field">
                <label htmlFor={`trainer-${s.id}`}>Trainer</label>
                <select id={`trainer-${s.id}`} value={trainerEmail} onChange={(e) => setTrainerEmail(e.target.value)}>
                  {sceltaTrainer.map((t) => (
                    <option key={t.email} value={t.email}>
                      {nomeStaff(t)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-modifica-colonne">
                <div>
                  <h3 className="pt-modifica-titolo">Cliente</h3>
                  <SceltaCliente valore={cliente} onChange={setCliente} />
                </div>
                <div>
                  <h3 className="pt-modifica-titolo">Quando</h3>
                  <SceltaDataOra data={quando.data} ora={quando.ora} oggi={oggi} onChange={setQuando} />
                </div>
              </div>

              {errore && <p className="error-banner">{errore}</p>}

              <div className="voce-azioni">
                <button
                  type="button"
                  className="btn"
                  disabled={!pronta || inCorso}
                  onClick={() =>
                    cliente &&
                    quando.ora &&
                    esegui(
                      () => modificaSessione(s.id, { cliente, data: quando.data, ora: quando.ora!, trainerEmail }),
                      () => setAperta(false)
                    )
                  }
                >
                  {inCorso ? 'Salvataggio…' : 'Salva modifica'}
                </button>
                <button type="button" className="btn btn-ghost" disabled={inCorso} onClick={() => setAperta(false)}>
                  Annulla
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
