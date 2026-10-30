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
  persone: {
    nome: string | null
    cognome: string | null
    codice_fiscale: string | null
    data_nascita: string | null
    email: string | null
    cellulare: string | null
  } | null
  abbonamenti: { abbonamento: string | null; variante: string | null } | null
}

// Gli elenchi della vista Elenchi (funzione tesseramenti_elenco, calcolata ogni
// volta su abbonamenti, tessere e dati in anagrafica):
// - tesserati: ha una tessera CSI in corso di validità;
// - da_tesserare: ha un abbonamento reale in corso di un prodotto con tessera,
//   i dati ci sono e la tessera non c'è;
// - non_tesserabili: stesso caso, ma in anagrafica manca un dato che CSI vuole;
// - in_errore: l'ultimo invio a CSI è fallito (rifiutato, credito, rete,
//   configurazione). Si popola quando il tesseramento va in reale.
export const VISTE = ['tesserati', 'da_tesserare', 'non_tesserabili', 'in_errore'] as const
export type Vista = (typeof VISTE)[number]

export const ETICHETTE_VISTA: Record<Vista, string> = {
  tesserati: 'Tesserati',
  da_tesserare: 'Da tesserare',
  non_tesserabili: 'Non tesserabili',
  in_errore: 'In errore',
}

/** La categoria come la restituisce tesseramenti_elenco → la vista. */
export const VISTA_DI_CATEGORIA: Record<string, Vista> = {
  tesserato: 'tesserati',
  da_tesserare: 'da_tesserare',
  non_tesserabile: 'non_tesserabili',
  in_errore: 'in_errore',
}

export type RigaElenco = {
  categoria: string
  persona_id: string
  cognome: string | null
  nome: string | null
  codice_fiscale: string | null
  data_nascita: string | null
  email: string | null
  cellulare: string | null
  abbonamento: string | null
  data_inizio: string | null
  data_fine: string | null
  tessera: string | null
  tessera_tipo: string | null
  tessera_rilascio: string | null
  tessera_scadenza: string | null
  motivo_tipo: MotivoTipo | null
  motivo: string | null
  riga_id: string | null
  tentativi: number
  ultimo_tentativo_il: string | null
  /** Il luogo come lo manda il tesseramento: il comune, o lo stato per chi è nato all'estero. */
  luogo_nascita: string | null
  sesso: string | null
  /** I dati che CSI vuole e in anagrafica mancano (vuoto se è tutto a posto). */
  mancanti: string[] | null
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

// Le viste della pagina Tesseramenti (parametro `sezione`).
export const SEZIONI_PAGINA = ['elenchi', 'tessere'] as const
export type SezionePagina = (typeof SEZIONI_PAGINA)[number]
export const ETICHETTE_SEZIONE: Record<SezionePagina, string> = {
  tessere: 'Tessere',
  elenchi: 'Elenchi',
}
