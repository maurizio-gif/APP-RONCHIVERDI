// Le segnalazioni dei soci: tipi e regole senza import server-only, così le
// usano sia le pagine sia i componenti del browser. Schema in
// scripts/sql/2026-11-12-segnalazioni.sql.

export const SEZIONE_SEGNALAZIONI = 'segnalazioni' as const
export const SEZIONE_SEGNALAZIONI_REPORT = 'segnalazioni-report' as const

export type StatoSegnalazione = 'ricevuta' | 'in_carico' | 'da_richiamare' | 'risolta' | 'archiviata'
export type Urgenza = 'sicurezza' | 'disservizio' | 'comfort'
export type Canale = 'reception' | 'telefono' | 'email' | 'altro'
export type TipoEvento =
  | 'ricezione'
  | 'assegnazione'
  | 'nota'
  | 'presa_in_carico'
  | 'risoluzione'
  | 'richiamo'
  | 'riapertura'
  | 'archiviazione'

export type Segnalazione = {
  id: string
  numero: number
  ricevuta_il: string
  raccolta_da: string
  canale: Canale
  settore: string
  motivo: string
  descrizione: string
  socio_nome: string | null
  persona_id: string | null
  richiamo_richiesto: boolean
  urgenza: Urgenza
  stato: StatoSegnalazione
  assegnato_a: string | null
  presa_in_carico_il: string | null
  risolta_il: string | null
  richiamato_il: string | null
  scadenza_presa_il: string
  scadenza_risoluzione_il: string
  aggiornato_il: string
}

export const COLONNE_SEGNALAZIONE =
  'id, numero, ricevuta_il, raccolta_da, canale, settore, motivo, descrizione, socio_nome, persona_id, richiamo_richiesto, urgenza, stato, assegnato_a, presa_in_carico_il, risolta_il, richiamato_il, scadenza_presa_il, scadenza_risoluzione_il, aggiornato_il'

export type EventoSegnalazione = {
  id: string
  creato_il: string
  autore: string
  tipo: TipoEvento
  testo: string | null
}

export type Voce = { chiave: string; nome: string }

// ── urgenza e scadenze ──────────────────────────────────────────────────────
//
// L'Excel aveva una scala 1-5 in cui il 68% (2024-25) e il 95% (2026) dei
// record stava fra 4 e 5: non distingueva niente. Qui tre livelli con un
// criterio scritto, e per ciascuno un tempo massimo per prendere in carico e
// per risolvere.
//
// I TEMPI SONO PROVVISORI, da confermare con Lorella: cambiarli qui vale per
// le segnalazioni nuove (le scadenze si scrivono sulla riga alla ricezione).

export const URGENZE: {
  chiave: Urgenza
  nome: string
  criterio: string
  presaOre: number
  risoluzioneOre: number
}[] = [
  {
    chiave: 'sicurezza',
    nome: 'Sicurezza o igiene',
    criterio: 'Rischio per le persone: pavimento bagnato, scalino, odore di fogna, animali infestanti.',
    presaOre: 2,
    risoluzioneOre: 24,
  },
  {
    chiave: 'disservizio',
    nome: 'Disservizio',
    criterio: 'Qualcosa che dovrebbe funzionare e non funziona: macchina del ghiaccio, Wi-Fi, sauna spenta.',
    presaOre: 24,
    risoluzioneOre: 24 * 5,
  },
  {
    chiave: 'comfort',
    nome: 'Comfort o miglioramento',
    criterio: 'Il servizio c’è ma si può fare meglio: sovraffollamento, posti auto, temperatura.',
    presaOre: 72,
    risoluzioneOre: 24 * 14,
  },
]

export const ETICHETTE_URGENZA: Record<Urgenza, string> = {
  sicurezza: 'Sicurezza o igiene',
  disservizio: 'Disservizio',
  comfort: 'Comfort',
}

export const CLASSE_URGENZA: Record<Urgenza, string> = {
  sicurezza: 'badge badge-ko',
  disservizio: 'badge badge-warn',
  comfort: 'badge badge-off',
}

export function scadenzeDa(urgenza: Urgenza, da: Date): { presa: Date; risoluzione: Date } {
  const u = URGENZE.find((x) => x.chiave === urgenza) ?? URGENZE[1]
  return {
    presa: new Date(da.getTime() + u.presaOre * 3600_000),
    risoluzione: new Date(da.getTime() + u.risoluzioneOre * 3600_000),
  }
}

// ── stati ───────────────────────────────────────────────────────────────────

export const ETICHETTE_STATO: Record<StatoSegnalazione, string> = {
  ricevuta: 'Da prendere in carico',
  in_carico: 'In carico',
  da_richiamare: 'Da richiamare',
  risolta: 'Risolta',
  archiviata: 'Archiviata',
}

export const CLASSE_STATO: Record<StatoSegnalazione, string> = {
  ricevuta: 'badge badge-warn',
  in_carico: 'badge badge-info',
  da_richiamare: 'badge badge-info',
  risolta: 'badge badge-ok',
  archiviata: 'badge badge-off',
}

export const ETICHETTE_EVENTO: Record<TipoEvento, string> = {
  ricezione: 'Segnalazione ricevuta',
  assegnazione: 'Assegnata',
  nota: 'Nota',
  presa_in_carico: 'Presa in carico',
  risoluzione: 'Risolta',
  richiamo: 'Socio richiamato',
  riapertura: 'Riaperta',
  archiviazione: 'Archiviata',
}

export const ETICHETTE_CANALE: Record<Canale, string> = {
  reception: 'Di persona alla reception',
  telefono: 'Telefono',
  email: 'Email',
  altro: 'Altro',
}

export function aperta(s: Pick<Segnalazione, 'stato'>): boolean {
  return s.stato !== 'risolta' && s.stato !== 'archiviata'
}

// In ritardo: non presa in carico entro il suo tempo, oppure presa in carico
// ma non risolta (o non richiamata) entro il suo.
export function inRitardo(s: Segnalazione, adesso: Date = new Date()): boolean {
  if (!aperta(s)) return false
  const limite = s.stato === 'ricevuta' ? s.scadenza_presa_il : s.scadenza_risoluzione_il
  return new Date(limite).getTime() < adesso.getTime()
}

// ── date ────────────────────────────────────────────────────────────────────

const FORMATO = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export function quando(iso: string): string {
  return FORMATO.format(new Date(iso))
}

const FORMATO_ORA = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome',
  hour: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
})

const GIORNI = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Ora (0-23) e giorno della settimana (0 = lunedì) a Roma: servono al report
// per la fascia oraria, dove l'Excel aveva l'ora solo nel 40% dei record.
export function oraEGiornoRoma(iso: string): { ora: number; giorno: number } {
  const parti = FORMATO_ORA.formatToParts(new Date(iso))
  const ora = Number(parti.find((p) => p.type === 'hour')?.value ?? 0)
  const giorno = Math.max(0, GIORNI.indexOf(parti.find((p) => p.type === 'weekday')?.value ?? 'Mon'))
  return { ora, giorno }
}

export const NOMI_GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

export function durataLeggibile(ore: number): string {
  if (ore < 1) return `${Math.max(1, Math.round(ore * 60))} min`
  if (ore < 48) return `${Math.round(ore)} h`
  return `${Math.round(ore / 24)} giorni`
}

// ── foto ────────────────────────────────────────────────────────────────────
//
// Solo immagini (comprese le foto dell'iPhone, HEIC/HEIF), fino a 10 MB
// l'una e cinque per volta. Gli stessi limiti stanno sul bucket
// segnalazioni-foto, che rifiuta il resto anche se qualcuno saltasse questo
// controllo (scripts/sql/2026-11-12-segnalazioni-foto.sql).

export const BUCKET_FOTO = 'segnalazioni-foto'
export const MASSIMO_BYTE_FOTO = 10 * 1024 * 1024
export const MASSIMO_FOTO = 5

export type AllegatoSegnalazione = {
  id: string
  evento_id: string | null
  percorso: string
  nome: string
  tipo: string | null
  byte: number | null
}

// Il browser non sempre dà il tipo di un HEIC (su Windows arriva vuoto): si
// ricava dall'estensione.
export function tipoFoto(nome: string, tipo: string): string | null {
  const t = tipo.toLowerCase()
  if (t.startsWith('image/')) return t
  const est = nome.toLowerCase().split('.').pop()
  if (est === 'heic') return 'image/heic'
  if (est === 'heif') return 'image/heif'
  if (est && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff'].includes(est))
    return `image/${est === 'jpg' ? 'jpeg' : est === 'tif' ? 'tiff' : est}`
  return null
}

export function erroreFoto(f: { nome: string; tipo: string; byte: number }): string | null {
  if (!tipoFoto(f.nome, f.tipo)) return `«${f.nome}»: si possono allegare solo foto.`
  if (f.byte > MASSIMO_BYTE_FOTO) return `«${f.nome}» supera i 10 MB.`
  if (f.byte <= 0) return `«${f.nome}» è vuota.`
  return null
}
