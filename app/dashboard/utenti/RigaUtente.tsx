'use client'

import { useState } from 'react'
import { CHIAVI_SEZIONI } from '@/lib/auth/sezioni'
import {
  impostaCommerciale,
  impostaPuoCancellare,
  impostaPuoInvitare,
  impostaPuoRiassegnare,
} from './actions'
import { TogglePermesso } from './TogglePermesso'
import { SezioniToggle } from './SezioniToggle'
import { RimuoviButton } from './RimuoviButton'

export type DatiUtente = {
  email: string
  nome: string | null
  cognome: string | null
  sezioni_consentite: string[] | null
  puo_invitare: boolean
  puo_cancellare: boolean
  commerciale: boolean
  puo_riassegnare: boolean
}

// Una riga per persona: chiusa dice chi è e cosa può fare, aperta si modifica.
//
// Prima ogni riga portava in chiaro quattro interruttori e quindici caselle di
// sezione: con sei persone la pagina diventava un muro di caselle in cui
// trovare qualcuno era più lento che cercarlo a memoria. Le stesse cose ci
// sono ancora, ma una alla volta e solo per la persona che si sta cambiando.
export function RigaUtente({
  u,
  amministra,
  eSeStesso,
}: {
  u: DatiUtente
  amministra: boolean
  eSeStesso: boolean
}) {
  const [aperta, setAperta] = useState(false)

  const nome = [u.nome, u.cognome].filter(Boolean).join(' ') || '—'
  const sezioni = u.sezioni_consentite ?? []

  // Il riassunto dei permessi a riga chiusa: solo quelli attivi, con
  // l'etichetta corta. Elencare anche quelli spenti raddoppierebbe la riga
  // per dire cosa una persona *non* può fare, che non è la domanda.
  const permessiAttivi = [
    u.puo_invitare && 'Amministra',
    u.commerciale && 'Commerciale',
    u.puo_riassegnare && 'Riassegna',
    u.puo_cancellare && 'Cancella',
  ].filter(Boolean) as string[]

  const etichettaSezioni =
    sezioni.length === 0
      ? 'nessuna sezione'
      : sezioni.length === CHIAVI_SEZIONI.length
        ? 'tutte le sezioni'
        : `${sezioni.length} sezioni`

  return (
    <li className={`utente${aperta ? ' is-aperta' : ''}`}>
      <div className="utente-testa">
        <button
          type="button"
          className="btn-espandi"
          aria-expanded={aperta}
          aria-label={`${aperta ? 'Chiudi' : 'Apri'} i permessi di ${nome}`}
          onClick={() => setAperta((v) => !v)}
        >
          {aperta ? '−' : '+'}
        </button>

        {/* Tutta la riga apre, non solo il segno: è il bersaglio naturale col
            mouse. Il pulsante qui sopra è quello che la rende raggiungibile
            da tastiera e che annuncia se è aperta. */}
        <div className="utente-identita" onClick={() => setAperta((v) => !v)}>
          <span className="utente-nome">
            {nome}
            {eSeStesso && (
              <span className="badge" style={{ marginLeft: '0.4rem' }}>
                tu
              </span>
            )}
          </span>
          <span className="utente-email muted">{u.email}</span>
        </div>

        <div className="utente-riassunto">
          {permessiAttivi.length > 0 ? (
            permessiAttivi.map((p) => (
              <span className="badge" key={p}>
                {p}
              </span>
            ))
          ) : (
            <span className="badge badge-off">solo lettura</span>
          )}
          <span className={`badge ${sezioni.length === 0 ? 'badge-warn' : 'badge-off'}`}>
            {etichettaSezioni}
          </span>
        </div>
      </div>

      {aperta && (
        <div className="utente-dettagli">
          <div className="utente-blocco">
            <div className="utente-blocco-titolo">Permessi</div>
            <TogglePermesso
              email={u.email}
              valoreIniziale={u.puo_invitare}
              etichetta="Può invitare e amministrare"
              azione={impostaPuoInvitare}
              disabilitato={!amministra || eSeStesso}
              motivoDisabilitato={
                eSeStesso
                  ? 'Non puoi togliere a te stesso il permesso di amministrare'
                  : 'Serve il permesso di amministrare'
              }
            />
            <TogglePermesso
              email={u.email}
              valoreIniziale={u.puo_cancellare}
              etichetta="Può cancellare record"
              azione={impostaPuoCancellare}
              disabilitato={!amministra}
              motivoDisabilitato="Serve il permesso di amministrare"
            />
            <TogglePermesso
              email={u.email}
              valoreIniziale={u.commerciale}
              etichetta="Commerciale"
              azione={impostaCommerciale}
              disabilitato={!amministra}
              motivoDisabilitato="Serve il permesso di amministrare"
            />
            <TogglePermesso
              email={u.email}
              valoreIniziale={u.puo_riassegnare}
              etichetta="Può riassegnare le trattative"
              azione={impostaPuoRiassegnare}
              disabilitato={!amministra}
              motivoDisabilitato="Serve il permesso di amministrare"
            />
          </div>

          <div className="utente-blocco">
            <div className="utente-blocco-titolo">Sezioni visibili</div>
            <SezioniToggle
              email={u.email}
              sezioniIniziali={sezioni}
              disabilitato={!amministra}
            />
          </div>

          {amministra && (
            <div className="utente-blocco">
              <RimuoviButton email={u.email} disabilitato={eSeStesso} />
            </div>
          )}
        </div>
      )}
    </li>
  )
}
