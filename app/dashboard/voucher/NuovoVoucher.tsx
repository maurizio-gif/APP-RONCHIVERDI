'use client'

import { useState, useTransition } from 'react'
import { nomePersona } from '@/lib/persone'
import { MESI_VALIDITA, dataRoma, emailValida } from '@/lib/voucher'
import { cercaSocioVoucher, inviaVoucherASocio, type SocioVoucher } from './actions'

// L'invio a mano: si cerca il socio in anagrafica (nome e cognome, email o
// cellulare), si vede il suo abbonamento attivo e si manda il voucher. Senza un
// abbonamento attivo oggi il pulsante non c'è. Nome, cognome, telefono ed
// email vengono dall'anagrafica; se l'email manca si scrive qui e vale solo
// per questo voucher.
export function NuovoVoucher() {
  const [aperto, setAperto] = useState(false)
  const [testo, setTesto] = useState('')
  const [cercatoPer, setCercatoPer] = useState<string | null>(null)
  const [soci, setSoci] = useState<SocioVoucher[]>([])
  const [altri, setAltri] = useState(false)
  const [scelto, setScelto] = useState<SocioVoucher | null>(null)
  const [abbonamentoId, setAbbonamentoId] = useState('')
  const [email, setEmail] = useState('')
  const [errore, setErrore] = useState<string | null>(null)
  const [fatto, setFatto] = useState<{ messaggio: string; avviso?: string } | null>(null)
  const [inCorso, startTransition] = useTransition()

  function cerca() {
    const termine = testo.trim()
    setErrore(null)
    setFatto(null)
    startTransition(async () => {
      const esito = await cercaSocioVoucher(termine)
      if (!esito.ok) {
        setErrore(esito.errore)
        return
      }
      setSoci(esito.soci)
      setAltri(esito.altri)
      setCercatoPer(termine)
    })
  }

  function scegli(s: SocioVoucher) {
    setScelto(s)
    setAbbonamentoId(s.abbonamenti[0]?.id ?? '')
    setEmail(emailValida(s.email) ? (s.email ?? '') : '')
    setErrore(null)
  }

  function ricomincia() {
    setScelto(null)
    setAbbonamentoId('')
    setEmail('')
    setTesto('')
    setCercatoPer(null)
    setSoci([])
    setAltri(false)
    setErrore(null)
  }

  function invia() {
    if (!scelto) return
    setErrore(null)
    setFatto(null)
    startTransition(async () => {
      const esito = await inviaVoucherASocio({ personaId: scelto.id, abbonamentoId, email: email.trim() })
      if (!esito.ok) {
        setErrore(esito.errore)
        return
      }
      // Si riparte da una ricerca vuota, con la conferma in alto: i voucher
      // si mandano a gruppetti.
      ricomincia()
      setFatto({ messaggio: esito.messaggio, avviso: esito.avviso })
    })
  }

  if (!aperto) {
    return (
      <button type="button" className="btn" onClick={() => setAperto(true)}>
        Invia un voucher a un socio
      </button>
    )
  }

  const verificato = cercatoPer !== null && cercatoPer === testo.trim()

  return (
    <div className="card">
      <div className="card-head">
        <h2>Invia un voucher a mano</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAperto(false)}>
          Chiudi
        </button>
      </div>

      <p className="muted" style={{ marginBottom: '1rem' }}>
        Cerca il socio in anagrafica: se ha un abbonamento attivo il codice parte subito per email e
        vale {MESI_VALIDITA} mesi.
      </p>

      {errore && <p className="error-banner">{errore}</p>}
      {fatto && (
        <>
          <p className="ok-banner">{fatto.messaggio}</p>
          {fatto.avviso && <p className="error-banner">{fatto.avviso}</p>}
        </>
      )}

      {scelto ? (
        <div>
          <div className="field">
            <span className="campo-etichetta">Socio</span>
            <p className="campo-fisso">
              {nomePersona(scelto)}
              {scelto.cellulare ? ` · ${scelto.cellulare}` : ''}{' '}
              <button type="button" className="link-testo" onClick={ricomincia}>
                Cambia
              </button>
            </p>
          </div>

          {scelto.abbonamenti.length === 0 ? (
            <p className="error-banner">
              Nessun abbonamento attivo oggi: il voucher si manda solo a chi ha un abbonamento in
              corso.
            </p>
          ) : (
            <>
              <div className="field">
                <label htmlFor="vm-abbonamento">Abbonamento attivo</label>
                <select id="vm-abbonamento" value={abbonamentoId} onChange={(e) => setAbbonamentoId(e.target.value)}>
                  {scelto.abbonamenti.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.abbonamento}
                      {a.dataFine ? ` · fino al ${dataRoma(a.dataFine)}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="vm-email">Email a cui arriva il voucher</label>
                <input
                  id="vm-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nome@esempio.it"
                  autoComplete="off"
                />
                <p className="field-hint">
                  {emailValida(scelto.email)
                    ? 'È quella in anagrafica: cambiala solo se è sbagliata.'
                    : 'In anagrafica manca un’email valida: scrivila qui.'}
                </p>
              </div>

              <button type="button" className="btn" onClick={invia} disabled={inCorso || !abbonamentoId || !emailValida(email)}>
                {inCorso ? 'Invio…' : 'Invia il voucher per email'}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="field">
          <label htmlFor="vm-cerca">Socio</label>
          <div className="verifica-contatto">
            <input
              id="vm-cerca"
              type="search"
              value={testo}
              onChange={(e) => {
                setTesto(e.target.value)
                setErrore(null)
              }}
              // Invio cerca, non invia: il campo è dentro una pagina con altri form.
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (testo.trim().length >= 3) cerca()
                }
              }}
              placeholder="Nome e cognome, email o cellulare"
              autoComplete="off"
            />
            <button type="button" className="btn btn-sm" onClick={cerca} disabled={inCorso || testo.trim().length < 3}>
              {inCorso ? 'Cerco…' : 'Cerca'}
            </button>
          </div>
          {!verificato && <p className="field-hint">La ricerca è su tutta l’anagrafica, soci Info4U compresi.</p>}

          {verificato &&
            (soci.length > 0 ? (
              <ul className="verifica-risultati">
                {soci.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="verifica-riga" onClick={() => scegli(s)}>
                      <strong>{nomePersona(s)}</strong>
                      {s.email && <span className="muted"> · {s.email}</span>}
                      {s.cellulare && <span className="muted"> · {s.cellulare}</span>}
                      <span className={s.abbonamenti.length > 0 ? 'badge badge-ok' : 'badge badge-off'} style={{ marginLeft: '0.5rem' }}>
                        {s.abbonamenti.length > 0 ? 'abbonamento attivo' : 'nessun abbonamento attivo'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="field-hint">Nessuno trovato per «{cercatoPer}».</p>
            ))}
          {verificato && altri && (
            <p className="field-hint">Ci sono altri risultati: aggiungi il cognome o cerca per cellulare per restringere.</p>
          )}
        </div>
      )}
    </div>
  )
}
