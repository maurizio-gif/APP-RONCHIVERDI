// Candidature spontanee raccolte dalla pagina /lavora-con-noi del sito.
//
// Solo dati e funzioni pure: lo importano sia la pagina (Server Component) sia
// i comandi della riga (client). Quello che parla con Supabase sta in
// actions.ts.
//
// La tabella la crea il repository del sito, che è chi ci scrive:
// scripts/sql/2026-09-08-candidature.sql in Sito-Ronchiverdi. Il curriculum
// non è nel database — sta nel bucket privato `candidature-cv`, e qui gira
// solo il suo percorso.

export const CV_BUCKET = 'candidature-cv'

export type StatoCandidatura = 'nuova' | 'in_valutazione' | 'archiviata'

export type Candidatura = {
  id: string
  created_at: string
  nome: string
  cognome: string
  email: string
  cellulare: string
  citta: string | null
  area: string | null
  area_label: string | null
  disponibilita: string | null
  presentazione: string
  esperienza: string | null
  cv_path: string | null
  cv_nome: string | null
  cv_tipo: string | null
  cv_dimensione: number | null
  utm_source: string | null
  utm_campaign: string | null
  stato: StatoCandidatura
  note: string | null
  gestita_da: string | null
  gestita_il: string | null
}

/** Colonne lette dall'elenco: tutte tranne quelle che nessuno guarda mai. */
export const COLONNE =
  'id, created_at, nome, cognome, email, cellulare, citta, area, area_label, disponibilita, presentazione, esperienza, cv_path, cv_nome, cv_tipo, cv_dimensione, utm_source, utm_campaign, stato, note, gestita_da, gestita_il'

export const ETICHETTE_STATO: Record<StatoCandidatura, string> = {
  nuova: 'Da leggere',
  in_valutazione: 'In valutazione',
  archiviata: 'Archiviata',
}

export const CLASSE_BADGE: Record<StatoCandidatura, string> = {
  nuova: 'badge badge-ok',
  in_valutazione: 'badge badge-warn',
  archiviata: 'badge',
}

/** Gli stati nell'ordine in cui compaiono nei filtri e nei pulsanti. */
export const STATI: StatoCandidatura[] = ['nuova', 'in_valutazione', 'archiviata']

export function eStatoValido(v: string): v is StatoCandidatura {
  return (STATI as string[]).includes(v)
}

export function nomeCompleto(c: Pick<Candidatura, 'nome' | 'cognome'>): string {
  return `${c.nome} ${c.cognome}`.trim()
}

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

/** Peso del file leggibile: "480 KB", "1,2 MB". */
export function pesoLeggibile(byte: number | null): string | null {
  if (!byte || byte <= 0) return null
  if (byte < 1024) return `${byte} byte`
  if (byte < 1024 * 1024) return `${Math.round(byte / 1024)} KB`
  return `${(byte / 1024 / 1024).toFixed(1)} MB`.replace('.', ',')
}

/** Formato del curriculum in una parola, per la riga dell'elenco. */
export function formatoCv(tipo: string | null, nome: string | null): string {
  if (tipo?.includes('pdf')) return 'PDF'
  if (tipo?.includes('word') || tipo?.includes('msword')) return 'Word'
  if (tipo?.includes('image')) return 'JPG'
  const estensione = nome?.split('.').pop()?.toUpperCase()
  return estensione ?? 'File'
}
