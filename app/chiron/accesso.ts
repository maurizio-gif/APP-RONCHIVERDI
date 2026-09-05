import { cookies } from 'next/headers'

// L'accesso del partner alla pagina di validazione.
//
// Un codice condiviso e non un utente Supabase Auth: al centro medico
// risponde chi c'è al telefono, e una credenziale personale per persona
// significherebbe gestire (e revocare) account di gente che non lavora per il
// Club. Quello che serve davvero — chi ha bruciato cosa e quando — resta
// tracciato lo stesso, perché la bruciatura scrive sempre timestamp e
// partner. Il codice si cambia da Vercel senza deploy.
export const COOKIE_ACCESSO = 'rv_chiron'

// 30 giorni: il telefono di Chiron non deve rifare il login a ogni chiamata,
// ma un dispositivo dimenticato acceso non resta dentro per sempre.
const DURATA_GIORNI = 30

export function codiceConfigurato(): string | null {
  const codice = process.env.CHIRON_ACCESS_CODE?.trim()
  return codice ? codice : null
}

export function accessoValido(): boolean {
  const atteso = codiceConfigurato()
  // Senza codice configurato la pagina non si apre a tutti: si chiude. Un
  // default vuoto che passa sarebbe un'interfaccia di validazione pubblica.
  if (!atteso) return false
  return cookies().get(COOKIE_ACCESSO)?.value === atteso
}

export function apriSessione(codice: string): void {
  cookies().set(COOKIE_ACCESSO, codice, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/chiron',
    maxAge: DURATA_GIORNI * 24 * 60 * 60,
  })
}

export function chiudiSessione(): void {
  cookies().delete({ name: COOKIE_ACCESSO, path: '/chiron' })
}
