import type { SezioneChiave } from '@/lib/auth/sezioni'

// Lo stato dei certificati medici di chi ha un abbonamento in corso (pagina
// Certificati medici, funzione certificati_stato: vedi
// scripts/sql/2026-10-29-certificati-medici-stato.sql). Nessun import
// server-only: i tipi servono anche ai componenti.

export const SEZIONE_CERTIFICATI: SezioneChiave = 'certificati'

/** Entro quanti giorni un certificato valido è «in scadenza». */
export const GIORNI_IN_SCADENZA = 30

export type CategoriaCertificato = 'valido' | 'in_scadenza' | 'scaduto' | 'solo_provvisorio' | 'mai_avuto'

export type RigaCertificato = {
  categoria: CategoriaCertificato
  persona_id: string
  cognome: string | null
  nome: string | null
  codice_fiscale: string | null
  email: string | null
  cellulare: string | null
  abbonamento: string | null
  data_inizio: string | null
  data_fine: string | null
  certificato: string | null
  emissione: string | null
  scadenza: string | null
  giorni_alla_scadenza: number | null
  provvisorio: boolean
}

// Gli elenchi della pagina, nell'ordine dei chip: prima chi richiede
// un'azione.
export const VISTE = ['in_scadenza', 'scaduti', 'mai_avuto', 'solo_provvisorio', 'validi'] as const
export type Vista = (typeof VISTE)[number]

export const ETICHETTE_VISTA: Record<Vista, string> = {
  in_scadenza: 'In scadenza',
  scaduti: 'Scaduti',
  mai_avuto: 'Mai avuto',
  solo_provvisorio: 'Solo provvisorio',
  validi: 'Validi',
}

export const CATEGORIA_DI_VISTA: Record<Vista, CategoriaCertificato> = {
  in_scadenza: 'in_scadenza',
  scaduti: 'scaduto',
  mai_avuto: 'mai_avuto',
  solo_provvisorio: 'solo_provvisorio',
  validi: 'valido',
}

export function vistaValida(v: string | undefined | null): Vista | null {
  return (VISTE as readonly string[]).includes(v ?? '') ? (v as Vista) : null
}

const normalizza = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Cerca per parole su cognome, nome, codice fiscale ed email. */
export function corrisponde(r: RigaCertificato, q: string): boolean {
  const parole = normalizza(q).split(/\s+/).filter(Boolean)
  if (parole.length === 0) return true
  const testo = normalizza([r.cognome, r.nome, r.codice_fiscale, r.email].filter(Boolean).join(' '))
  return parole.every((p) => testo.includes(p))
}

/** Le righe di una vista, ordinate come serve a chi le lavora. */
export function elencoDi(righe: RigaCertificato[], vista: Vista, q = ''): RigaCertificato[] {
  const categoria = CATEGORIA_DI_VISTA[vista]
  const elenco = righe.filter((r) => r.categoria === categoria && corrisponde(r, q))
  const nome = (r: RigaCertificato) => `${r.cognome ?? ''} ${r.nome ?? ''}`
  const perNome = (a: RigaCertificato, b: RigaCertificato) => nome(a).localeCompare(nome(b), 'it')
  if (vista === 'in_scadenza') {
    // Prima chi scade prima.
    return elenco.sort((a, b) => (a.scadenza ?? '').localeCompare(b.scadenza ?? '') || perNome(a, b))
  }
  if (vista === 'scaduti') {
    // Prima chi è scaduto da meno: è il più facile da recuperare.
    return elenco.sort((a, b) => (b.scadenza ?? '').localeCompare(a.scadenza ?? '') || perNome(a, b))
  }
  return elenco.sort(perNome)
}
