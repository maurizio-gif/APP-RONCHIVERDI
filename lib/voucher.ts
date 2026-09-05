// Dati puri sul voucher: nessun import server-only, così lo importano sia le
// Server Action sia i componenti client dell'elenco.

export type StatoVoucher = 'attivo' | 'utilizzato' | 'annullato'

export type Voucher = {
  id: string
  codice: string
  tipo: string
  nome: string
  cognome: string
  email: string
  telefono: string | null
  note: string | null
  stato: StatoVoucher
  emesso_da: string | null
  created_at: string
  valido_fino: string
  utilizzato_il: string | null
  utilizzato_da: string | null
  annullato_il: string | null
  annullato_da: string | null
  email_inviata_il: string | null
  email_invii: number
  email_errore: string | null
}

// Mesi di validità dal giorno dell'emissione: è la finestra dichiarata al
// socio nell'email, e quella oltre la quale Chiron non deve più accettare il
// codice.
export const MESI_VALIDITA = 12

// Otto cifre: abbastanza corte da dettarle al telefono senza sbagliare,
// abbastanza lunghe da rendere inutile tentare a caso (100 milioni di
// combinazioni contro qualche centinaio di voucher emessi in un anno).
const CIFRE_CODICE = 8

// Lo stesso conto della soglia scritta sul voucher: sta qui perché è una
// regola commerciale, non un dettaglio dell'interfaccia.
export const SOGLIA_VISITA_INCLUSA_EURO = 1000

export function generaCodice(): string {
  // crypto.getRandomValues e non Math.random: un codice che vale una visita
  // non deve essere indovinabile conoscendo quelli emessi prima.
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  const massimo = 10 ** CIFRE_CODICE
  return String(buffer[0] % massimo).padStart(CIFRE_CODICE, '0')
}

// Quello che il partner digita può arrivare con spazi, trattini o il punto
// che ha copiato dall'email: si confronta sempre la sola sequenza di cifre.
export function normalizzaCodice(inserito: string): string {
  return inserito.replace(/\D/g, '')
}

// "1234 5678": si detta e si ricopia meglio a gruppi di quattro.
export function formattaCodice(codice: string): string {
  return codice.replace(/(\d{4})(?=\d)/g, '$1 ')
}

export function dataScadenza(da: Date = new Date()): string {
  const scadenza = new Date(da)
  scadenza.setMonth(scadenza.getMonth() + MESI_VALIDITA)
  return scadenza.toISOString().slice(0, 10)
}

export function eScaduto(voucher: Pick<Voucher, 'valido_fino'>, adesso: Date = new Date()): boolean {
  // Vale tutto il giorno di scadenza: il confronto è fra date, non istanti.
  return voucher.valido_fino < adesso.toISOString().slice(0, 10)
}

// Lo stato "scaduto" non esiste in tabella (vedi la migration): un codice
// attivo che ha passato la data resta attivo per chi lo ha emesso, ma non è
// più spendibile. Questa funzione è l'unico posto dove le due cose si
// uniscono, così interfaccia del pannello e validazione del partner non
// possono dare due risposte diverse.
export type StatoEffettivo = StatoVoucher | 'scaduto'

export function statoEffettivo(voucher: Pick<Voucher, 'stato' | 'valido_fino'>, adesso?: Date): StatoEffettivo {
  if (voucher.stato === 'attivo' && eScaduto(voucher, adesso)) return 'scaduto'
  return voucher.stato
}

export const ETICHETTE_STATO: Record<StatoEffettivo, string> = {
  attivo: 'Attivo',
  utilizzato: 'Utilizzato',
  annullato: 'Annullato',
  scaduto: 'Scaduto',
}

export function nomeCompleto(voucher: Pick<Voucher, 'nome' | 'cognome'>): string {
  return `${voucher.nome} ${voucher.cognome}`.trim()
}

const FORMATO_DATA = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Europe/Rome',
})

const FORMATO_DATA_ORA = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Rome',
})

export function dataRoma(iso: string): string {
  // Una data secca (YYYY-MM-DD) letta come istante UTC e riformattata su Roma
  // tornerebbe indietro di un giorno in inverno: si formatta a mezzogiorno.
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso)
  return FORMATO_DATA.format(d)
}

export function dataOraRoma(iso: string): string {
  return FORMATO_DATA_ORA.format(new Date(iso))
}

// Validazione dei campi del form, condivisa fra il controllo lato server e i
// messaggi mostrati: restituisce l'errore da far leggere, o null.
export function erroreDatiSocio(dati: {
  nome: string
  cognome: string
  email: string
}): string | null {
  if (!dati.nome) return 'Il nome è obbligatorio.'
  if (!dati.cognome) return 'Il cognome è obbligatorio.'
  if (!dati.email) return 'L’email è obbligatoria: è lì che arriva il voucher.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dati.email)) return 'L’email non sembra valida.'
  return null
}
