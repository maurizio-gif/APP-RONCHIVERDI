// I dati Info4U che la scheda contatto mostra oltre ad abbonamenti e agenda:
// frequenza in sede, certificato, quota, rate e ricevute, azioni e memo dei
// consulenti, email di Info4U. Niente server-only qui: tipi e funzioni pure.

export type FinestraAccessi = {
  chiave: '30g' | '3m' | '6m' | '12m'
  giorni: number
  mediana: number
  /** Quanti soci sono venuti almeno una volta nella finestra (la base della mediana). */
  soci: number
}

export type AccessiPersona = {
  /** Gli ultimi ingressi, uno per giorno: il primo passaggio del giorno. */
  ultimi: { giorno: string; ingresso: string }[]
  finestre: FinestraAccessi[]
}

export const ETICHETTE_FINESTRA: Record<FinestraAccessi['chiave'], string> = {
  '30g': 'Ultimi 30 giorni',
  '3m': 'Ultimi 3 mesi',
  '6m': 'Ultimi 6 mesi',
  '12m': 'Ultimi 12 mesi',
}

export type Confronto = 'sopra' | 'in-linea' | 'sotto'

/**
 * Dove sta questa persona rispetto alla mediana dei soci. Entro il 20% dalla
 * mediana è «in linea»: con mediane basse (8 giorni in un mese) un giorno di
 * differenza non dice niente.
 */
export function confrontoConMediana(giorni: number, mediana: number): Confronto {
  if (mediana <= 0) return giorni > 0 ? 'sopra' : 'in-linea'
  const rapporto = giorni / mediana
  if (rapporto >= 1.2) return 'sopra'
  if (rapporto <= 0.8) return 'sotto'
  return 'in-linea'
}

export const ETICHETTE_CONFRONTO: Record<Confronto, string> = {
  sopra: 'sopra la mediana',
  'in-linea': 'in linea con la mediana',
  sotto: 'sotto la mediana',
}

export type RataPersona = {
  data_rata: string
  importo: number | null
  data_pagato: string | null
  metodo_pagamento: string | null
}

export type RicevutaPersona = {
  numero: number | string | null
  tipo: string | null
  data_ricevuta: string
  totale: number | null
  descrizioni: string[]
}

export type CertificatoPersona = {
  descrizione: string | null
  data_emissione: string | null
  data_scadenza: string | null
}

export type QuotaPersona = { data_inizio: string | null; data_fine: string | null }

/** Una voce dello storico dei consulenti su Info4U: azione o memo. */
export type VoceInfo4u = {
  chiave: string
  /** Istante, per ordinare con il resto delle azioni fatte. */
  quando: string
  genere: 'azione' | 'memo'
  /** L'azione è il registro di un'email inviata (non un contatto fatto da una persona). */
  eEmail: boolean
  tipo: string | null
  esito: string | null
  titolo: string | null
  testo: string | null
  autore: string | null
}

export type EmailInfo4u = {
  id: string
  data: string
  oggetto: string | null
  inviata: boolean
  errore: string | null
}

export type DatiInfo4u = {
  accessi: AccessiPersona
  certificati: CertificatoPersona[]
  quote: QuotaPersona[]
  rate: RataPersona[]
  ricevute: RicevutaPersona[]
  storico: VoceInfo4u[]
  email: EmailInfo4u[]
}

export const DATI_INFO4U_VUOTI: DatiInfo4u = {
  accessi: { ultimi: [], finestre: [] },
  certificati: [],
  quote: [],
  rate: [],
  ricevute: [],
  storico: [],
  email: [],
}

/** Le rate non pagate e già scadute (data_rata prima di oggi). */
export function rateScadute(rate: RataPersona[], oggi: string): RataPersona[] {
  return rate.filter((r) => !r.data_pagato && r.data_rata < oggi)
}

export type StatoCertificato =
  | { tipo: 'valido'; fino: string }
  | { tipo: 'scaduto'; il: string }
  | { tipo: 'prenotato'; il: string }
  | { tipo: 'nessuno' }

/**
 * Lo stato del certificato medico. «Visita prenotata (provvisorio)» non è un
 * certificato: Info4U lo registra con la data della visita, e con quella
 * data in avanti sembrerebbe valido.
 */
export function statoCertificato(certificati: CertificatoPersona[], oggi: string): StatoCertificato {
  const veri = certificati.filter((c) => c.data_scadenza && !/provvisorio/i.test(c.descrizione ?? ''))
  const validi = veri.filter((c) => (c.data_scadenza as string) >= oggi)
  if (validi.length) {
    return { tipo: 'valido', fino: validi.map((c) => c.data_scadenza as string).sort().reverse()[0] }
  }
  const prenotata = certificati.find((c) => /provvisorio/i.test(c.descrizione ?? '') && (c.data_scadenza ?? '') >= oggi)
  if (prenotata) return { tipo: 'prenotato', il: prenotata.data_scadenza as string }
  if (veri.length) return { tipo: 'scaduto', il: veri.map((c) => c.data_scadenza as string).sort().reverse()[0] }
  return { tipo: 'nessuno' }
}

export type StatoQuota = { tipo: 'attiva'; fino: string } | { tipo: 'scaduta'; il: string } | { tipo: 'nessuna' }

export function statoQuota(quote: QuotaPersona[], oggi: string): StatoQuota {
  const attive = quote.filter((q) => q.data_fine && q.data_fine >= oggi && (!q.data_inizio || q.data_inizio <= oggi))
  if (attive.length) return { tipo: 'attiva', fino: attive.map((q) => q.data_fine as string).sort().reverse()[0] }
  const fini = quote.map((q) => q.data_fine).filter(Boolean) as string[]
  if (fini.length) return { tipo: 'scaduta', il: fini.sort().reverse()[0] }
  return { tipo: 'nessuna' }
}
