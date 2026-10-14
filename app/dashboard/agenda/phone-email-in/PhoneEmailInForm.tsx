'use client'

import { useState, useTransition } from 'react'
import { DURATA_PREDEFINITA, oggiRoma, type TipoVoce } from '@/lib/agenda'
import {
  PREFISSI_TELEFONO,
  PREFISSO_PREDEFINITO,
  separaPrefisso,
  validaNuovoContatto,
} from '@/lib/persone'
import { VerificaContatto } from '../VerificaContatto'
import type { CampiIndovinati } from '../nuovo-contatto'
import type { ContattoScegliibile } from '../NuovaVoce'
import { registraPhoneEmailIn } from '../actions'

/** Un commerciale a cui assegnare il lead, già col nome da mostrare. */
export type CommercialeLead = { email: string; nome: string }

const CONTATTO_VUOTO = { nome: '', cognome: '', email: '', cellulare: '' }

// Il form di Phone In / Email In, in tre sezioni nell'ordine in cui le cose
// succedono al telefono:
//
//  1. Contatto — chi è (verificato prima di crearlo) e a chi va il lead;
//  2. Registra — cosa è appena successo: telefonata o email, e le note.
//     Giorno, ora ed esito non si chiedono: sono adesso ed «eseguita»;
//  3. Programma — facoltativo: il seguito, una telefonata o un tour in sede,
//     con giorno, ora e durata da scegliere.
//
// Era il form generico dell'agenda con alcuni campi nascosti: chiedeva giorno
// e ora di una cosa appena successa, e l'esito di una telefonata che c'era
// stata per forza. Le regole stanno in registraPhoneEmailIn
// (app/dashboard/agenda/actions.ts), che le ricontrolla tutte.
export function PhoneEmailInForm({ commerciali }: { commerciali: CommercialeLead[] }) {
  const [scelto, setScelto] = useState<ContattoScegliibile | null>(null)
  const [contattoNuovo, setContattoNuovo] = useState(false)
  const [nuovo, setNuovo] = useState(CONTATTO_VUOTO)
  const [prefisso, setPrefisso] = useState(PREFISSO_PREDEFINITO)
  const [programma, setProgramma] = useState(false)
  const [tipoProgramma, setTipoProgramma] = useState<TipoVoce>('appuntamento_telefonico')
  // Cambia a ogni salvataggio riuscito: rimonta il form, così i campi non
  // controllati (note, giorno, ora...) ripartono vuoti senza azzerarli uno a uno.
  const [giro, setGiro] = useState(0)
  const [errore, setErrore] = useState<string | null>(null)
  const [avviso, setAvviso] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  /** Dalla verifica al contatto nuovo, con i campi presi dal testo cercato. */
  function creaDaVerifica(campi: CampiIndovinati) {
    // Un numero cercato col prefisso («+39 388…») si divide fra la tendina e
    // il campo, invece di restare con il «+39» scritto anche nel numero.
    const separato = campi.cellulare ? separaPrefisso(campi.cellulare) : null
    setPrefisso(separato?.prefisso ?? PREFISSO_PREDEFINITO)
    setNuovo({ ...CONTATTO_VUOTO, ...campi, ...(separato ? { cellulare: separato.numero } : {}) })
    setContattoNuovo(true)
    setScelto(null)
    setErrore(null)
  }

  function invia(formData: FormData) {
    setErrore(null)
    setAvviso(null)

    // Le stesse regole del server, dette prima di partire.
    if (!contattoNuovo && !scelto) {
      setErrore('Prima verifica se il contatto c’è già: cercalo e sceglilo, o crealo dopo la ricerca.')
      return
    }
    if (contattoNuovo) {
      const validato = validaNuovoContatto({ ...nuovo, prefisso }, { completo: true })
      if ('errore' in validato) {
        setErrore(validato.errore)
        return
      }
    }

    startTransition(async () => {
      const esito = await registraPhoneEmailIn(formData)
      if (esito.ok) {
        setScelto(null)
        setContattoNuovo(false)
        setNuovo(CONTATTO_VUOTO)
        setPrefisso(PREFISSO_PREDEFINITO)
        setProgramma(false)
        setTipoProgramma('appuntamento_telefonico')
        setGiro((g) => g + 1)
        setAvviso(esito.avviso ?? 'Registrato.')
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        setErrore(esito.errore)
      }
    })
  }

  return (
    <>
      {avviso && (
        <p className="info-banner" role="status">
          {avviso}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAvviso(null)}>
            Ho capito
          </button>
        </p>
      )}

      <form action={invia} key={giro}>
        <input type="hidden" name="contatto_modo" value={contattoNuovo ? 'nuovo' : 'elenco'} />

        {/* ── 1. Contatto ─────────────────────────────────────────────── */}
        <section className="card">
          <div className="card-head">
            <h2>Contatto</h2>
          </div>

          {contattoNuovo ? (
            <>
              <p className="field-hint" style={{ margin: '0 0 0.75rem' }}>
                Contatto nuovo: nome, cognome e cellulare sono obbligatori. Se in anagrafica ci fosse
                già — stesso nome, cognome e cellulare — la voce va sulla scheda che c’è, senza
                doppioni.{' '}
                <button
                  type="button"
                  className="link-testo"
                  onClick={() => {
                    setContattoNuovo(false)
                    setErrore(null)
                  }}
                >
                  Torna alla ricerca
                </button>
              </p>
              <div className="form-row">
                <div className="field">
                  <label htmlFor="nuovo_nome">
                    Nome <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="nuovo_nome"
                    name="nuovo_nome"
                    type="text"
                    required
                    value={nuovo.nome}
                    onChange={(e) => setNuovo({ ...nuovo, nome: e.target.value })}
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="nuovo_cognome">
                    Cognome <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="nuovo_cognome"
                    name="nuovo_cognome"
                    type="text"
                    required
                    value={nuovo.cognome}
                    onChange={(e) => setNuovo({ ...nuovo, cognome: e.target.value })}
                    autoComplete="off"
                  />
                </div>
                <div className="field field-cellulare">
                  <label htmlFor="nuovo_cellulare">
                    Cellulare <span aria-hidden="true">*</span>
                  </label>
                  {/* Prefisso a tendina, +39 già scelto: chi chiama da un
                      numero italiano non deve fare niente, chi chiama
                      dall'estero lo cambia con un clic. */}
                  <div className="cellulare-con-prefisso">
                    <select
                      name="nuovo_prefisso"
                      aria-label="Prefisso internazionale"
                      value={prefisso}
                      onChange={(e) => setPrefisso(e.target.value)}
                    >
                      {PREFISSI_TELEFONO.map((p) => (
                        <option key={p.prefisso} value={p.prefisso} title={p.paese}>
                          {p.prefisso} {p.sigla}
                        </option>
                      ))}
                    </select>
                    <input
                      id="nuovo_cellulare"
                      name="nuovo_cellulare"
                      type="tel"
                      required
                      value={nuovo.cellulare}
                      onChange={(e) => setNuovo({ ...nuovo, cellulare: e.target.value })}
                      autoComplete="off"
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="nuovo_email">Email</label>
                  <input
                    id="nuovo_email"
                    name="nuovo_email"
                    type="email"
                    value={nuovo.email}
                    onChange={(e) => setNuovo({ ...nuovo, email: e.target.value })}
                    autoComplete="off"
                  />
                </div>
              </div>
            </>
          ) : (
            <VerificaContatto scelto={scelto} onScegli={setScelto} onCreaNuovo={creaDaVerifica} />
          )}

          {/* Il lead va sempre a qualcuno: una telefonata registrata dalla
              segreteria apriva una trattativa di nessuno, che restava lì
              finché un commerciale non passava a prenderla. */}
          <div className="form-row">
            <div className="field">
              <label htmlFor="assegna_lead_a">
                Assegna il lead a <span aria-hidden="true">*</span>
              </label>
              <select id="assegna_lead_a" name="assegna_lead_a" required defaultValue="">
                <option value="">— scegli il commerciale —</option>
                {commerciali.map((c) => (
                  <option key={c.email} value={c.email}>
                    {c.nome}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                Obbligatorio: chi richiamerà questa persona. Se il contatto ha già una trattativa
                seguita da un collega, resta a chi la segue.
              </p>
            </div>
          </div>
        </section>

        {/* ── 2. Registra ─────────────────────────────────────────────── */}
        <section className="card">
          <div className="card-head">
            <h2>Registra</h2>
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="tipo">Cosa è arrivato</label>
              <select id="tipo" name="tipo" defaultValue="appuntamento_telefonico">
                <option value="appuntamento_telefonico">Telefonata</option>
                <option value="email">Email</option>
              </select>
              <p className="field-hint">
                Giorno e ora si registrano da soli, al salvataggio. Si dà per eseguita.
              </p>
            </div>
          </div>
          <div className="form-row">
            <div className="field" style={{ flexBasis: '100%' }}>
              <label htmlFor="note">
                Note <span aria-hidden="true">*</span>
              </label>
              <textarea
                id="note"
                name="note"
                rows={3}
                required
                placeholder="Cosa ha chiesto o scritto, com'è andata, e cosa succede adesso"
              />
            </div>
          </div>
        </section>

        {/* ── 3. Programma (facoltativo) ──────────────────────────────── */}
        <section className="card">
          <div className="card-head">
            <h2>Programma</h2>
            <span className="muted">Facoltativo</span>
          </div>
          <input type="hidden" name="programma" value={programma ? '1' : '0'} />
          <div className="esito-gruppi" role="group" aria-label="Programmare un seguito">
            <button
              type="button"
              className={`btn btn-sm${programma ? ' btn-ghost' : ''}`}
              aria-pressed={!programma}
              onClick={() => setProgramma(false)}
            >
              Niente da programmare
            </button>
            <button
              type="button"
              className={`btn btn-sm${programma ? '' : ' btn-ghost'}`}
              aria-pressed={programma}
              onClick={() => setProgramma(true)}
            >
              Programma un seguito
            </button>
          </div>

          {programma && (
            <>
              <div className="form-row">
                <div className="field">
                  <label htmlFor="prog_tipo">Cosa</label>
                  <select
                    id="prog_tipo"
                    name="prog_tipo"
                    value={tipoProgramma}
                    onChange={(e) => setTipoProgramma(e.target.value as TipoVoce)}
                  >
                    <option value="appuntamento_telefonico">Telefonata</option>
                    <option value="appuntamento_in_sede">Tour in sede</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="prog_data">
                    Giorno <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="prog_data"
                    name="prog_data"
                    type="date"
                    required
                    min={oggiRoma()}
                    defaultValue={oggiRoma()}
                  />
                </div>
                <div className="field">
                  <label htmlFor="prog_ora">
                    Ora <span aria-hidden="true">*</span>
                  </label>
                  <input id="prog_ora" name="prog_ora" type="time" required />
                </div>
                <div className="field">
                  <label htmlFor="prog_durata">Durata (min)</label>
                  <input
                    id="prog_durata"
                    name="prog_durata"
                    type="number"
                    min={5}
                    max={480}
                    step={5}
                    key={tipoProgramma}
                    defaultValue={DURATA_PREDEFINITA[tipoProgramma]}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="field" style={{ flexBasis: '100%' }}>
                  <label htmlFor="prog_note">Note per chi richiama o accoglie</label>
                  <input
                    id="prog_note"
                    name="prog_note"
                    type="text"
                    autoComplete="off"
                    placeholder="Lascia vuoto per riportare le note della registrazione"
                  />
                  <p className="field-hint">
                    Va in agenda del commerciale a cui assegni il lead.
                  </p>
                </div>
              </div>
            </>
          )}
        </section>

        {errore && <p className="error-banner">{errore}</p>}

        <button type="submit" className="btn" disabled={inCorso}>
          {inCorso ? 'Salvataggio…' : programma ? 'Registra e programma' : 'Registra'}
        </button>
      </form>
    </>
  )
}
