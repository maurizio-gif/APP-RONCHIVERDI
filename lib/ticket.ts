// I ticket di assistenza: tipi e regole senza import server-only, così li
// usano sia le pagine sia i componenti del browser. Schema in
// scripts/sql/2026-10-16-ticket.sql.

export type StatoTicket = 'aperto' | 'risposto' | 'chiuso'
export type TipoEvento =
  | 'apertura'
  | 'nota'
  | 'risposta'
  | 'replica'
  | 'escalation'
  | 'rimando'
  | 'presa_visione'
  | 'chiusura'
  | 'riapertura'

export type Ticket = {
  id: string
  numero: number
  aperto_il: string
  aperto_da: string
  sezione: string | null
  titolo: string
  descrizione: string
  stato: StatoTicket
  livello: 1 | 2
  assegnato_a: string
  aggiornato_il: string
  chiuso_il: string | null
  chiuso_da: string | null
}

export const COLONNE_TICKET =
  'id, numero, aperto_il, aperto_da, sezione, titolo, descrizione, stato, livello, assegnato_a, aggiornato_il, chiuso_il, chiuso_da'

export type EventoTicket = {
  id: string
  creato_il: string
  autore: string
  tipo: TipoEvento
  testo: string | null
  pubblico: boolean
}

export type AllegatoTicket = {
  id: string
  evento_id: string | null
  percorso: string
  nome: string
  tipo: string | null
  byte: number | null
}

// Stato visto da chi lo legge: «tocca a te» è l'informazione che serve.
export const ETICHETTE_STATO: Record<StatoTicket, string> = {
  aperto: 'In gestione',
  risposto: 'Risposto',
  chiuso: 'Chiuso',
}

export const CLASSE_STATO: Record<StatoTicket, string> = {
  aperto: 'badge badge-warn',
  risposto: 'badge badge-info',
  chiuso: 'badge badge-off',
}

export const ETICHETTE_EVENTO: Record<TipoEvento, string> = {
  apertura: 'Ticket aperto',
  nota: 'Nota interna',
  risposta: 'Risposta',
  replica: 'Risposta di chi ha aperto il ticket',
  escalation: 'Passato al secondo livello',
  rimando: 'Rimandato al primo livello',
  presa_visione: 'Preso in visione',
  chiusura: 'Chiuso',
  riapertura: 'Riaperto',
}

// ── allegati ────────────────────────────────────────────────────────────────
//
// Solo immagini (comprese le foto dell'iPhone, HEIC/HEIF) e PDF, fino a 10 MB
// l'uno: niente video. Gli stessi limiti stanno sul bucket ticket-allegati,
// che rifiuta il resto anche se qualcuno saltasse questo controllo.

export const BUCKET_TICKET = 'ticket-allegati'
export const MASSIMO_BYTE_ALLEGATO = 10 * 1024 * 1024
export const MASSIMO_ALLEGATI = 5
export const ACCEPT_ALLEGATI_TICKET = 'image/*,application/pdf,.heic,.heif,.pdf'

// Il browser non sempre dà il tipo di un HEIC (su Windows arriva vuoto): si
// ricava dall'estensione.
export function tipoAllegato(nome: string, tipo: string): string | null {
  const t = tipo.toLowerCase()
  if (t === 'application/pdf' || t.startsWith('image/')) return t
  const est = nome.toLowerCase().split('.').pop()
  if (est === 'pdf') return 'application/pdf'
  if (est === 'heic') return 'image/heic'
  if (est === 'heif') return 'image/heif'
  if (est && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff'].includes(est))
    return `image/${est === 'jpg' ? 'jpeg' : est === 'tif' ? 'tiff' : est}`
  return null
}

export function erroreAllegato(f: { nome: string; tipo: string; byte: number }): string | null {
  if (!tipoAllegato(f.nome, f.tipo)) return `«${f.nome}»: si possono allegare solo immagini o PDF.`
  if (f.byte > MASSIMO_BYTE_ALLEGATO) return `«${f.nome}» supera i 10 MB.`
  if (f.byte <= 0) return `«${f.nome}» è vuoto.`
  return null
}

export function pesoLeggibile(byte: number | null | undefined): string {
  if (!byte || byte <= 0) return ''
  if (byte < 1024 * 1024) return `${Math.max(1, Math.round(byte / 1024))} KB`
  return `${(byte / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

const FORMATO = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Rome',
})

export function quando(iso: string): string {
  return FORMATO.format(new Date(iso))
}
