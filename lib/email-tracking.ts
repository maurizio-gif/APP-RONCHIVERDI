// Il tracking delle email: tipi e regole di lettura, senza import
// server-only, così li usano sia le pagine sia i componenti.
//
// I dati vengono dalla vista email_inviate_esiti
// (scripts/sql/2026-10-16-tracking-email.sql): una riga per email inviata,
// con gli esiti calcolati dagli eventi del webhook SendGrid.

export type EmailEsito = {
  id: string
  inviata_il: string
  automazione: string
  mittente: string
  mittente_nome: string | null
  destinatario: string
  cc: string[] | null
  oggetto: string
  provider: string
  provider_message_id: string | null
  esito: 'inviata' | 'errore'
  errore: string | null
  tracciata: boolean
  persona_id: string | null
  voucher_id: string | null
  inviata_da: string | null
  consegnata_il: string | null
  aperta_il: string | null
  aperture: number
  aperture_automatiche: number
  cliccata_il: string | null
  clic: number
  rimbalzata: boolean
  spam: boolean
  ritardata: boolean
  motivo: string | null
  link: string[]
}

export const COLONNE_ESITO =
  'id, inviata_il, automazione, mittente, mittente_nome, destinatario, cc, oggetto, provider, provider_message_id, esito, errore, tracciata, persona_id, voucher_id, inviata_da, consegnata_il, aperta_il, aperture, aperture_automatiche, cliccata_il, clic, rimbalzata, spam, ritardata, motivo, link'

export type Stato = 'errore' | 'spam' | 'rimbalzata' | 'cliccata' | 'aperta' | 'consegnata' | 'ritardata' | 'inviata'

// Un'email ha un solo stato da mostrare: il più significativo, dal peggiore
// (non partita, rimbalzata) al migliore (cliccata). Lo stesso ordine vale in
// tutte le pagine, così scheda, voucher e tracking non possono dire due cose
// diverse della stessa email.
export function statoEmail(e: Pick<EmailEsito, 'esito' | 'spam' | 'rimbalzata' | 'clic' | 'aperture' | 'consegnata_il' | 'ritardata'>): Stato {
  if (e.esito === 'errore') return 'errore'
  if (e.spam) return 'spam'
  if (e.rimbalzata) return 'rimbalzata'
  if (e.clic > 0) return 'cliccata'
  if (e.aperture > 0) return 'aperta'
  if (e.consegnata_il) return 'consegnata'
  if (e.ritardata) return 'ritardata'
  return 'inviata'
}

export const ETICHETTE_STATO: Record<Stato, string> = {
  errore: 'Non partita',
  spam: 'Segnalata come spam',
  rimbalzata: 'Non consegnata',
  cliccata: 'Cliccata',
  aperta: 'Aperta',
  consegnata: 'Consegnata',
  ritardata: 'In consegna',
  inviata: 'Inviata',
}

export const CLASSE_STATO: Record<Stato, string> = {
  errore: 'badge badge-ko',
  spam: 'badge badge-ko',
  rimbalzata: 'badge badge-ko',
  cliccata: 'badge badge-ok',
  aperta: 'badge badge-ok',
  consegnata: 'badge badge-info',
  ritardata: 'badge badge-warn',
  inviata: 'badge badge-off',
}

// I nomi degli eventi di SendGrid, come si leggono nella prova di invio.
export const NOMI_EVENTI: Record<string, string> = {
  processed: 'Presa in carico da SendGrid',
  delivered: 'Consegnata al server di posta del destinatario',
  deferred: 'Consegna rimandata (il server del destinatario ha chiesto di riprovare)',
  bounce: 'Rimbalzata: non consegnata',
  dropped: 'Scartata da SendGrid: non consegnata',
  open: 'Aperta',
  click: 'Link cliccato',
  spamreport: 'Segnalata come spam dal destinatario',
  unsubscribe: 'Disiscrizione',
  group_unsubscribe: 'Disiscrizione dal gruppo',
  group_resubscribe: 'Nuova iscrizione al gruppo',
}

// I filtri del tracking: quale insieme di email mostrare.
export const VISTE = ['tutte', 'consegnate', 'aperte', 'cliccate', 'non-arrivate', 'non-partite'] as const
export type Vista = (typeof VISTE)[number]

export const ETICHETTE_VISTA: Record<Vista, string> = {
  tutte: 'Tutte',
  consegnate: 'Consegnate',
  aperte: 'Aperte',
  cliccate: 'Cliccate',
  'non-arrivate': 'Non arrivate',
  'non-partite': 'Non partite',
}

export function inVista(e: EmailEsito, vista: Vista): boolean {
  const stato = statoEmail(e)
  switch (vista) {
    case 'tutte':
      return true
    case 'consegnate':
      return !!e.consegnata_il || e.aperture > 0 || e.clic > 0
    case 'aperte':
      return e.aperture > 0
    case 'cliccate':
      return e.clic > 0
    case 'non-arrivate':
      return stato === 'rimbalzata' || stato === 'spam'
    case 'non-partite':
      return stato === 'errore'
  }
}

// Il codice del voucher non si mostra nel pannello (lo vede solo il socio):
// nella copia dell'email lo si copre, in entrambe le forme in cui compare.
export function copriCodice(testo: string, codice: string | null | undefined): string {
  if (!codice) return testo
  const formattato = codice.replace(/(\d{4})(?=\d)/g, '$1 ')
  return testo.split(formattato).join('•••• ••••').split(codice).join('••••••••')
}

const FORMATO_DATA_ORA = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Rome',
})

const FORMATO_DATA_ORA_SECONDI = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'Europe/Rome',
})

export function dataOraEmail(iso: string): string {
  return FORMATO_DATA_ORA.format(new Date(iso))
}

// Nella prova di invio l'ora si legge al secondo: è un documento.
export function dataOraSecondi(iso: string): string {
  return FORMATO_DATA_ORA_SECONDI.format(new Date(iso))
}

// Il dettaglio sotto il badge: quando è successo quello che il badge dice.
export function riassuntoEsito(e: EmailEsito): string | null {
  const stato = statoEmail(e)
  if (stato === 'errore') return e.errore
  if (stato === 'rimbalzata' || stato === 'spam') return e.motivo
  const parti = [
    e.consegnata_il && `consegnata ${dataOraEmail(e.consegnata_il)}`,
    e.aperture > 0 && `aperta ${e.aperture === 1 ? '1 volta' : `${e.aperture} volte`}`,
    e.clic > 0 && `${e.clic === 1 ? '1 clic' : `${e.clic} clic`}`,
  ].filter(Boolean)
  return parti.length ? parti.join(' · ') : null
}
