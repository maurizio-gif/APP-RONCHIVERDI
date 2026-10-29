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
