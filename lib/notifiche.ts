// I messaggi interni fra operatori del pannello.
//
// Solo dati e funzioni pure: lo importano sia la pagina (Server Component) sia
// il modulo di composizione e l'avviso in evidenza, che sono client. Quello
// che parla con Supabase sta in app/dashboard/notifiche/actions.ts.
//
// La tabella la crea scripts/sql/2026-09-08-notifiche.sql. Una riga per
// destinatario, non per messaggio: la conferma di lettura è di ciascuno.

/** La sezione che serve sia per scrivere sia per ricevere. */
export const SEZIONE_NOTIFICHE = 'notifiche' as const

export type Notifica = {
  id: number
  created_at: string
  da_email: string
  a_email: string
  messaggio: string
  letta_il: string | null
  batch_id: string | null
  allegato_path: string | null
  allegato_nome: string | null
  allegato_tipo: string | null
  allegato_dimensione: number | null
}

export const COLONNE =
  'id, created_at, da_email, a_email, messaggio, letta_il, batch_id, allegato_path, allegato_nome, allegato_tipo, allegato_dimensione'

/** Lunghezza massima del testo: un messaggio di servizio, non una relazione. */
export const LUNGHEZZA_MASSIMA_MESSAGGIO = 2000

// Dove porta la notifica push quando viene toccata. Sta qui e non in
// actions.ts perché in un file 'use server' si possono esportare solo
// funzioni async: la tendina "Apri su" e la validazione lato server devono
// leggere la stessa costante da un file normale.
export const LINK_PREDEFINITO = '/dashboard/notifiche'

export function dataOraRoma(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Nome e cognome di un operatore, con l'email come ripiego. */
export function nomeOperatore(
  riga: { nome?: string | null; cognome?: string | null } | undefined,
  email: string
): string {
  const completo = `${riga?.nome ?? ''} ${riga?.cognome ?? ''}`.trim()
  return completo || email
}

/** Cognome prima del nome, come ogni altro elenco di operatori del pannello. */
export function confrontaOperatori(
  a: { nome?: string | null; cognome?: string | null; email: string },
  b: { nome?: string | null; cognome?: string | null; email: string }
): number {
  const chiave = (o: typeof a) => `${o.cognome ?? ''} ${o.nome ?? ''}`.trim() || o.email
  return chiave(a).localeCompare(chiave(b), 'it')
}
