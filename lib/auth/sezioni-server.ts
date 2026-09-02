import { headers } from 'next/headers'
import { HEADER_EMAIL, type SezioneChiave } from './sezioni'
import { rigaStaffCorrente } from './staff-server'

export async function getSezioniConsentite(email: string | null | undefined): Promise<string[]> {
  const riga = await rigaStaffCorrente(email)
  return riga?.sezioni_consentite ?? []
}

// Email dell'operatore corrente, già validata dal middleware e propagata via
// header: le pagine sotto /dashboard non devono richiamare getUser().
export function emailCorrente(): string | null {
  return headers().get(HEADER_EMAIL)
}

// Per le pagine sotto /dashboard: controlla il permesso sulla sezione.
export async function utenteHaSezione(chiave: SezioneChiave): Promise<boolean> {
  const sezioni = await getSezioniConsentite(emailCorrente())
  return sezioni.includes(chiave)
}

// Nome e cognome impostati all'invito o al primo accesso: usato per il badge
// utente nella sidebar, al posto della sola email.
export async function getNomeUtente(email: string | null | undefined): Promise<string | null> {
  const riga = await rigaStaffCorrente(email)
  const nomeCompleto = `${riga?.nome ?? ''} ${riga?.cognome ?? ''}`.trim()
  return nomeCompleto || null
}
