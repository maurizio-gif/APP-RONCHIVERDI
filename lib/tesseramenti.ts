// Il tesseramento CSI automatico (pagina Tesseramenti, vedi
// scripts/sql/2026-10-29-tesseramento-csi.sql e la edge function
// supabase/functions/tesseramento-csi). Nessun import server-only: i tipi
// servono anche ai componenti.

import type { SezioneChiave } from '@/lib/auth/sezioni'

export const SEZIONE_TESSERAMENTI: SezioneChiave = 'tesseramenti'

export const CHIAVE_AUTOMAZIONE_TESSERAMENTO = 'tesseramento_csi'

export type StatoTesseramento = 'da_inviare' | 'tesserato' | 'non_tesserato' | 'simulato'
export type MotivoTipo = 'dati_mancanti' | 'csi' | 'credito' | 'rete' | 'configurazione'

export type RigaTesseramento = {
  id: string
  persona_id: string
  stagione: number
  stato: StatoTesseramento
  origine: 'automatico' | 'gia_presente' | null
  tessera: string | null
  quota: number | null
  rilascio: string | null
  scadenza: string | null
  tesserato_il: string | null
  motivo: string | null
  motivo_tipo: MotivoTipo | null
  tentativi: number
  ultimo_tentativo_il: string | null
  codice_attivita: string | null
  creato_il: string
  persone: { nome: string | null; cognome: string | null } | null
  abbonamenti: { abbonamento: string | null; variante: string | null } | null
}

// Le tre viste della pagina. «Non tesserati» comprende anche chi è in attesa
// del primo invio: per la segreteria sono tutti «da sistemare o da attendere».
export const VISTE = ['tesserati', 'non_tesserati', 'prove'] as const
export type Vista = (typeof VISTE)[number]

export const ETICHETTE_VISTA: Record<Vista, string> = {
  tesserati: 'Tesserati',
  non_tesserati: 'Non tesserati',
  prove: 'Prove (test)',
}

export const ETICHETTE_MOTIVO: Record<MotivoTipo, string> = {
  dati_mancanti: 'Dati mancanti',
  csi: 'Rifiutato da CSI',
  credito: 'Credito CSI',
  rete: 'CSI non raggiungibile',
  configurazione: 'Configurazione',
}

// Chi deve intervenire a mano: serve a dare un colore al badge.
export const MOTIVI_DA_SISTEMARE: readonly MotivoTipo[] = ['dati_mancanti', 'csi', 'configurazione']

export function vistaDi(stato: StatoTesseramento): Vista {
  if (stato === 'tesserato') return 'tesserati'
  if (stato === 'simulato') return 'prove'
  return 'non_tesserati'
}

// ─────────────────────────────────────────────── le tessere CSI nel CRM
// Le tessere che il server CSI ha in archivio, lette ogni ora dalla edge
// function csi-tessere in `tessere_csi` (scripts/sql/2026-10-29-tessere-csi.sql).

export type TesseraCsi = {
  tessera: string
  stagione: number
  tipotess: string | null
  attivita: string[]
  qualifiche: string[]
  rilascio: string | null
  scadenza: string | null
}

// Le attività della società come le descrive CSI (operazione S).
export const ATTIVITA_CSI: Record<string, string> = {
  ATL: 'Atletica leggera',
  CIC: 'Ciclismo',
  CR: 'Circoli ricreativi',
  NUO: 'Nuoto',
  TRI: 'Triathlon',
  MI: 'Mini istituzionale',
}

export const TIPO_TESSERA: Record<string, string> = { AT: 'Atleta', NA: 'Non atleta' }

/** «Atleta · Circoli ricreativi (CR)»: il tipo di tessera in una riga. */
export function descriviTessera(t: Pick<TesseraCsi, 'tipotess' | 'attivita' | 'qualifiche'>): string {
  const tipo = t.tipotess ? (TIPO_TESSERA[t.tipotess] ?? t.tipotess) : null
  const attivita = t.attivita.map((c) => (ATTIVITA_CSI[c] ? `${ATTIVITA_CSI[c]} (${c})` : c))
  const qualifiche = t.qualifiche.length > 0 ? `qualifica ${t.qualifiche.join(', ')}` : null
  return [tipo, attivita.join(' + ') || null, qualifiche].filter(Boolean).join(' · ') || 'Tessera CSI'
}

/** La data di oggi a Roma, aaaa-mm-gg: quella con cui si confrontano le scadenze. */
export function oggiRoma(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date())
}

/** aaaa-mm-gg → gg/mm/aaaa ('—' se manca). */
export function dataIt(iso: string | null | undefined): string {
  return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—'
}

/** Quanti giorni mancano a `iso` da `oggi` (negativo se è passata). */
export function giorniA(iso: string, oggi: string): number {
  return Math.round((new Date(`${iso}T12:00:00Z`).getTime() - new Date(`${oggi}T12:00:00Z`).getTime()) / 86400000)
}

/** Euro interi con il separatore delle migliaia. */
export function euroIntero(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

// Le tre viste della pagina Tesseramenti (parametro `sezione`).
export const SEZIONI_PAGINA = ['tessere', 'iva', 'automazione'] as const
export type SezionePagina = (typeof SEZIONI_PAGINA)[number]
export const ETICHETTE_SEZIONE: Record<SezionePagina, string> = {
  tessere: 'Tessere',
  iva: 'IVA zero senza tessera',
  automazione: 'Automazione',
}
