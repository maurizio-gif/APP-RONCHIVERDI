// Il piano editoriale: le richieste di contenuti social alla social media
// manager (pagina /dashboard/piano-editoriale, schema in
// scripts/sql/2026-11-10-piano-editoriale.sql).
//
// Solo dati e funzioni pure, senza import server-only: li usano sia le pagine
// sia i componenti del browser. Le letture e le scritture stanno in
// piano-editoriale-server.ts e in app/dashboard/piano-editoriale/actions.ts.

import type { SezioneChiave } from '@/lib/auth/sezioni'

export const SEZIONE_PIANO_EDITORIALE: SezioneChiave = 'piano-editoriale'

// ── il preavviso ────────────────────────────────────────────────────────────

// Giada lavora 10 ore a settimana: un contenuto chiesto con meno di due
// settimane di anticipo non entra nel suo lavoro. Il modulo non lo rifiuta,
// lo segna «urgente» e chiede il motivo; decide lei (vedi creaVoce).
export const PREAVVISO_GIORNI = 14

// ── i tipi ──────────────────────────────────────────────────────────────────

export type TipoVoce = 'post' | 'storia' | 'reel' | 'video' | 'altro'

// Le ore di lavoro che si stimano per tipo: servono a far vedere quanto del
// suo monte ore settimanale è già occupato. Giada le corregge per ogni voce.
export const TIPI: { chiave: TipoVoce; testo: string; ore: number }[] = [
  { chiave: 'post', testo: 'Post', ore: 1 },
  { chiave: 'storia', testo: 'Storia', ore: 0.5 },
  { chiave: 'reel', testo: 'Reel', ore: 2 },
  { chiave: 'video', testo: 'Video (con riprese)', ore: 3 },
  { chiave: 'altro', testo: 'Altro', ore: 1 },
]

export const ETICHETTE_TIPO: Record<TipoVoce, string> = Object.fromEntries(TIPI.map((t) => [t.chiave, t.testo])) as Record<
  TipoVoce,
  string
>

export const ORE_PER_TIPO: Record<TipoVoce, number> = Object.fromEntries(TIPI.map((t) => [t.chiave, t.ore])) as Record<
  TipoVoce,
  number
>

// ── gli stati ───────────────────────────────────────────────────────────────

export type StatoVoce = 'richiesta' | 'in_carico' | 'in_lavorazione' | 'da_approvare' | 'pubblicato' | 'rifiutata'

export const STATI: { chiave: StatoVoce; testo: string; classe: string }[] = [
  { chiave: 'richiesta', testo: 'Richiesta', classe: 'badge badge-warn' },
  { chiave: 'in_carico', testo: 'Presa in carico', classe: 'badge badge-info' },
  { chiave: 'in_lavorazione', testo: 'In lavorazione', classe: 'badge badge-info' },
  { chiave: 'da_approvare', testo: 'Da approvare', classe: 'badge badge-walkin' },
  { chiave: 'pubblicato', testo: 'Pubblicato', classe: 'badge badge-ok' },
  { chiave: 'rifiutata', testo: 'Non realizzabile', classe: 'badge badge-ko' },
]

export const ETICHETTE_STATO: Record<StatoVoce, string> = Object.fromEntries(STATI.map((s) => [s.chiave, s.testo])) as Record<
  StatoVoce,
  string
>

export const CLASSE_STATO: Record<StatoVoce, string> = Object.fromEntries(STATI.map((s) => [s.chiave, s.classe])) as Record<
  StatoVoce,
  string
>

// ── le voci ─────────────────────────────────────────────────────────────────

export type VocePiano = {
  id: string
  data_pubblicazione: string
  tipo: TipoVoce
  titolo: string
  descrizione: string
  reparto: string | null
  link: string | null
  stato: StatoVoce
  urgente: boolean
  motivo_urgenza: string | null
  ore_stimate: number
  nota_gestione: string | null
  richiesto_da: string
  creato_il: string
}

export const COLONNE_VOCE =
  'id, data_pubblicazione, tipo, titolo, descrizione, reparto, link, stato, urgente, motivo_urgenza, ore_stimate, nota_gestione, richiesto_da, creato_il'

export type AllegatoVoce = {
  id: string
  voce_id: string
  nome: string
  tipo: string | null
  byte: number | null
}

// Una voce rifiutata non occupa tempo di Giada e non va sul calendario come
// impegno: si vede solo nell'elenco, con la sua nota.
export function occupaTempo(stato: StatoVoce): boolean {
  return stato !== 'rifiutata'
}

// ── gli orari di Giada ──────────────────────────────────────────────────────

// Dal 10 novembre 2026, 10 ore a settimana in cinque fasce da due ore.
// giorno: 1 = lunedì ... 5 = venerdì (come Date.getUTCDay).
export const ORARI_GIADA: { giorno: number; nome: string; dalle: string; alle: string }[] = [
  { giorno: 1, nome: 'Lunedì', dalle: '16:00', alle: '18:00' },
  { giorno: 2, nome: 'Martedì', dalle: '14:00', alle: '16:00' },
  { giorno: 3, nome: 'Mercoledì', dalle: '17:00', alle: '19:00' },
  { giorno: 4, nome: 'Giovedì', dalle: '14:00', alle: '16:00' },
  { giorno: 5, nome: 'Venerdì', dalle: '16:00', alle: '18:00' },
]

export const ORE_SETTIMANALI = ORARI_GIADA.length * 2

// ── le date ─────────────────────────────────────────────────────────────────
//
// Le date sono stringhe AAAA-MM-GG, il giorno di Roma: nessun calcolo con
// l'ora, così il fuso del server (UTC su Vercel) non sposta niente.

const FORMATO_GIORNO_ROMA = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' })

export function oggiRoma(): string {
  return FORMATO_GIORNO_ROMA.format(new Date())
}

function daIso(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`)
}

function aIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function aggiungiGiorni(iso: string, giorni: number): string {
  const d = daIso(iso)
  d.setUTCDate(d.getUTCDate() + giorni)
  return aIso(d)
}

/** Il primo giorno in cui una richiesta fatta oggi non è urgente. */
export function primaDataConPreavviso(oggi: string): string {
  return aggiungiGiorni(oggi, PREAVVISO_GIORNI)
}

export function inPreavviso(data: string, oggi: string): boolean {
  return data >= primaDataConPreavviso(oggi)
}

/** Il lunedì della settimana di una data. */
export function lunedi(iso: string): string {
  const giorno = daIso(iso).getUTCDay() // 0 = domenica
  return aggiungiGiorni(iso, -((giorno + 6) % 7))
}

export function dataValida(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && aIso(daIso(iso)) === iso
}

const FORMATO_BREVE = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

export function dataBreve(iso: string): string {
  return FORMATO_BREVE.format(daIso(iso))
}

export function meseValido(m: string | undefined): m is string {
  return !!m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)
}

export function etichettaMese(m: string): string {
  const testo = daIso(`${m}-15`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return testo.charAt(0).toUpperCase() + testo.slice(1)
}

export function meseVicino(m: string, delta: number): string {
  const d = daIso(`${m}-15`)
  d.setUTCMonth(d.getUTCMonth() + delta)
  return aIso(d).slice(0, 7)
}

/**
 * Le settimane (lunedì → domenica) che coprono un mese, come elenchi di sette
 * date: la griglia del calendario.
 */
export function settimaneDelMese(m: string): string[][] {
  const primo = `${m}-01`
  const ultimo = aggiungiGiorni(meseVicino(m, 1) + '-01', -1)
  const settimane: string[][] = []
  for (let inizio = lunedi(primo); inizio <= ultimo; inizio = aggiungiGiorni(inizio, 7)) {
    settimane.push(Array.from({ length: 7 }, (_, i) => aggiungiGiorni(inizio, i)))
  }
  return settimane
}

// ── gli allegati ────────────────────────────────────────────────────────────
//
// Immagini, video, PDF e documenti Office fino a 100 MB l'uno (stessi limiti
// del bucket piano-editoriale-file, che rifiuta il resto anche se questo
// controllo venisse saltato). Per un video più pesante basta un link a Drive o
// WeTransfer nel campo apposito.

export const BUCKET_PIANO = 'piano-editoriale-file'
export const MASSIMO_BYTE_FILE_PIANO = 100 * 1024 * 1024
export const MASSIMO_FILE_PIANO = 6
export const ACCEPT_FILE_PIANO = 'image/*,video/*,application/pdf,.heic,.heif,.pdf,.doc,.docx,.ppt,.pptx,.txt'

const MIME_DA_ESTENSIONE: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  heic: 'image/heic',
  heif: 'image/heif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
}

const MIME_AMMESSI = new Set(Object.values(MIME_DA_ESTENSIONE))

// Il browser non sempre dà il tipo di un file (un HEIC su Windows arriva
// vuoto): si ricava dall'estensione.
export function tipoFilePiano(nome: string, tipo: string): string | null {
  const t = tipo.toLowerCase()
  if (t.startsWith('image/') || t.startsWith('video/') || MIME_AMMESSI.has(t)) return t
  const est = nome.toLowerCase().split('.').pop() ?? ''
  return MIME_DA_ESTENSIONE[est] ?? null
}

export function erroreFilePiano(f: { nome: string; tipo: string; byte: number }): string | null {
  if (!tipoFilePiano(f.nome, f.tipo)) return `«${f.nome}»: formato non ammesso (immagini, video, PDF, Word, PowerPoint, testo).`
  if (f.byte > MASSIMO_BYTE_FILE_PIANO) return `«${f.nome}» supera i 100 MB: per i file più pesanti incolla un link.`
  if (f.byte <= 0) return `«${f.nome}» è vuoto.`
  return null
}

export function pesoLeggibile(byte: number | null | undefined): string {
  if (!byte || byte <= 0) return ''
  if (byte < 1024 * 1024) return `${Math.max(1, Math.round(byte / 1024))} KB`
  return `${(byte / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

export const LUNGHEZZA_MASSIMA_DESCRIZIONE = 4000
