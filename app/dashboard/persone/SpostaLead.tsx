'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PREFISSI_TELEFONO, PREFISSO_PREDEFINITO, nomePersona, separaPrefisso } from '@/lib/persone'
import { VerificaContatto } from '../agenda/VerificaContatto'
import type { CampiIndovinati } from '../agenda/nuovo-contatto'
import type { ContattoScegliibile } from '../agenda/NuovaVoce'
import { spostaTrattativaSuPersona } from '../richieste/trattativa-actions'

const VUOTO = { nome: '', cognome: '', email: '', cellulare: '' }

// «La richiesta è per un'altra persona», sulla scheda del lead.
//
// Il marito compila il modulo per la moglie, ed è lei a iscriversi: la
// trattativa è sulla scheda di lui, la vendita arriva su quella di lei, e non
// si incontrano. Qui si sposta la trattativa sulla persona giusta — trovata
// in anagrafica con la stessa verifica di Phone In, o scritta qui — e se ha
// già comprato si chiude da sola come vinta (spostaTrattativaSuPersona).
// Chiuso di default: è un'eccezione, e un pannello aperto su ogni lead
// sembrerebbe dire che va fatto.
export function SpostaLead({ id, personaAttuale }: { id: string; personaAttuale: string }) {
  const router = useRouter()
  const [aperto, setAperto] = useState(false)
  const [scelto, setScelto] = useState<ContattoScegliibile | null>(null)
  const [nuovo, setNuovo] = useState<typeof VUOTO | null>(null)
  const [prefisso, setPrefisso] = useState(PREFISSO_PREDEFINITO)
  const [errore, setErrore] = useState<string | null>(null)
  const [avviso, setAvviso] = useState<string | null>(null)
  const [inCorso, avvia] = useTransition()

  function creaDaVerifica(campi: CampiIndovinati) {
    const separato = campi.cellulare ? separaPrefisso(campi.cellulare) : null
    setPrefisso(separato?.prefisso ?? PREFISSO_PREDEFINITO)
    setNuovo({ ...VUOTO, ...campi, ...(separato ? { cellulare: separato.numero } : {}) })
    setScelto(null)
    setErrore(null)
  }

  function sposta() {
    setErrore(null)
    if (scelto && scelto.id === personaAttuale) {
      setErrore('È già intestata a questa persona: scegline un’altra.')
      return
    }
    avvia(async () => {
      const r = await spostaTrattativaSuPersona({
        id,
        personaId: scelto?.id ?? null,
        nuovo: !scelto && nuovo ? { ...nuovo, prefisso } : null,
      })
      if (!r.ok) {
        setErrore(r.errore)
        return
      }
      setAvviso(r.avviso)
      // La trattativa adesso vive sulla scheda dell'altra persona: si va lì.
      router.push(`/dashboard/persone/${r.personaId}`)
    })
  }

  if (avviso) return <p className="info-banner" role="status">{avviso}</p>

  if (!aperto) {
    return (
      <button type="button" className="link-testo sposta-lead-apri" onClick={() => setAperto(true)}>
        La richiesta è per un’altra persona?
      </button>
    )
  }

  const destinatario = scelto ? nomePersona(scelto) : nuovo ? [nuovo.nome, nuovo.cognome].filter(Boolean).join(' ') : ''

  return (
    <div className="sposta-lead">
      <p className="field-hint" style={{ marginTop: 0 }}>
        Cerca la persona interessata davvero (per esempio la moglie che si è iscritta). Trattativa e
        richiesta passano a lei; se ha già comprato, si chiude come vinta.{' '}
        <button
          type="button"
          className="link-testo"
          onClick={() => {
            setAperto(false)
            setScelto(null)
            setNuovo(null)
            setErrore(null)
          }}
        >
          Annulla
        </button>
      </p>

      {nuovo ? (
        <>
          <div className="form-row">
            <div className="field">
              <label htmlFor="sposta-nome">
                Nome <span aria-hidden="true">*</span>
              </label>
              <input
                id="sposta-nome"
                value={nuovo.nome}
                onChange={(e) => setNuovo({ ...nuovo, nome: e.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="sposta-cognome">
                Cognome <span aria-hidden="true">*</span>
              </label>
              <input
                id="sposta-cognome"
                value={nuovo.cognome}
                onChange={(e) => setNuovo({ ...nuovo, cognome: e.target.value })}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="field field-cellulare">
              <label htmlFor="sposta-cellulare">
                Cellulare <span aria-hidden="true">*</span>
              </label>
              <div className="cellulare-con-prefisso">
                <select aria-label="Prefisso internazionale" value={prefisso} onChange={(e) => setPrefisso(e.target.value)}>
                  {PREFISSI_TELEFONO.map((p) => (
                    <option key={p.prefisso} value={p.prefisso} title={p.paese}>
                      {p.prefisso} {p.sigla}
                    </option>
                  ))}
                </select>
                <input
                  id="sposta-cellulare"
                  type="tel"
                  value={nuovo.cellulare}
                  onChange={(e) => setNuovo({ ...nuovo, cellulare: e.target.value })}
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="sposta-email">Email</label>
              <input
                id="sposta-email"
                type="email"
                value={nuovo.email}
                onChange={(e) => setNuovo({ ...nuovo, email: e.target.value })}
                autoComplete="off"
              />
            </div>
          </div>
          <p className="field-hint">
            <button type="button" className="link-testo" onClick={() => setNuovo(null)}>
              Torna alla ricerca
            </button>
          </p>
        </>
      ) : (
        <VerificaContatto scelto={scelto} onScegli={setScelto} onCreaNuovo={creaDaVerifica} />
      )}

      {errore && <p className="error-banner">{errore}</p>}

      {(scelto || nuovo) && (
        <button type="button" className="btn btn-sm" disabled={inCorso} onClick={sposta}>
          {inCorso ? 'Spostamento…' : `Sposta su ${destinatario || 'questa persona'}`}
        </button>
      )}
    </div>
  )
}
