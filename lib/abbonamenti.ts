// Helper condivisi fra le pagine di reportistica abbonamenti
// (app/dashboard/abbonamenti/**, app/dashboard/direzione/): i gruppi
// prodotto sono una categorizzazione commerciale definita a mano da
// Ronchiverdi (vedi scripts/sql/2026-09-18-abbonamenti-gruppi.sql), non un
// dato di Info4U.

import type { PostgrestError } from '@supabase/supabase-js'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { euro } from '@/lib/pipeline'

export type Gruppo = { id: string; nome: string; ordine: number }

// Chiave sintetica per i prodotti senza un gruppo assegnato: non è l'id di
// nessuna riga in abbonamenti_gruppi, serve solo per tenerli insieme nelle
// mappe di aggregazione dei report.
export const NON_CATEGORIZZATO = 'non-categorizzato'

export async function caricaGruppi(): Promise<Gruppo[]> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('abbonamenti_gruppi')
    .select('id, nome, ordine')
    .order('ordine', { ascending: true })
    .order('nome', { ascending: true })
  return data ?? []
}

// ──────────────────────────────────────── andamento per gruppo (grafici)
//
// Fatturato mensile e abbonati attivi a fine mese, entrambi spezzati per
// gruppo — la stessa forma di dati (VoceMeseStack) per il componente
// GraficoPerGruppo (app/dashboard/abbonamenti/GraficoPerGruppo.tsx), usato
// sia in /dashboard/abbonamenti sia in /dashboard/direzione. Estratto qui
// invece che duplicato in due page.tsx: stessi colori, stessa definizione di
// "attivo", un solo posto da aggiornare se cambia una delle due.

// Otto colori categorici, in quest'ordine fisso — non è una tavolozza scelta
// a occhio: è la palette di riferimento della skill dataviz interna,
// validata (node scripts/validate_palette.js, contrasto e distinguibilità
// per daltonismo) contro la superficie delle card di questo pannello
// (--surface, #fdfaf3). Un gruppo prende sempre lo stesso colore ovunque
// compaia, nell'ordine di abbonamenti_gruppi.ordine — l'identità segue il
// gruppo, non la sua posizione in classifica. Oltre 8 gruppi il colore si
// ripete (l'ottavo e il nono coinciderebbero): non è un caso previsto oggi,
// Ronchiverdi ne ha uno solo.
const PALETTE_GRUPPI = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
// Grigio neutro e non un nono colore categorico: "non categorizzato" non è
// un'identità di gruppo, è l'assenza di una — la stessa distinzione delle
// viste di vendita (gruppo_id null).
const COLORE_NON_CATEGORIZZATO = 'var(--fill-strong)'

export type VoceGruppoStack = {
  gruppoId: string | null
  nome: string
  colore: string
  valore: number
  valoreTesto: string
}

export type VoceMeseStack = {
  mese: string
  etichetta: string
  gruppi: VoceGruppoStack[]
  totale: number
  totaleTesto: string
}

export type VoceLegendaStack = { chiave: string; nome: string; colore: string }

function etichettaMeseBreve(mese: string): string {
  return new Date(`${mese}T12:00:00Z`).toLocaleDateString('it-IT', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

export type AndamentoPerGruppo = {
  attiviOggiPerGruppo: Map<string | null, number>
  erroreAttiviOggi: PostgrestError | null
  serieFatturatoMensile: VoceMeseStack[]
  legendaFatturato: VoceLegendaStack[]
  erroreFatturatoMensile: PostgrestError | null
  serieAttiviMensile: VoceMeseStack[]
  legendaAttivi: VoceLegendaStack[]
  erroreStoricoAttivi: PostgrestError | null
}

/**
 * Carica fatturato mensile e abbonati attivi, entrambi per gruppo, sugli
 * ultimi 12 mesi passati in `ultimi12Mesi` (il più recente deve essere
 * `meseCorrenteData`). `gruppiSelezionati`/`filtroAttivo` sono lo stesso
 * filtro multi-selezione già in pagina (i chip "Gruppo"): quando attivo, i
 * grafici mostrano solo i gruppi scelti e "Non categorizzato" sparisce (non
 * ha senso mostrarlo mentre si guarda un gruppo alla volta).
 */
export async function caricaAndamentoPerGruppo(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  gruppi: Gruppo[],
  gruppiSelezionati: string[],
  filtroAttivo: boolean,
  meseCorrenteData: string,
  ultimi12Mesi: string[]
): Promise<AndamentoPerGruppo> {
  // Abbonati attivi OGGI: non una vendita, una fotografia dello stato
  // attuale (vedi abbonamenti_attivi_al in
  // scripts/sql/2026-09-21-abbonamenti-attivi.sql) — persone distinte con
  // almeno un abbonamento non scaduto in quel gruppo. Serve sia come ultima
  // colonna del grafico attivi (il mese in corso non è ancora congelato
  // nello storico) sia — nel chiamante — per un'eventuale card "a oggi".
  const { data: attiviGrezzi, error: erroreAttiviOggi } = await supabase
    .from('abbonamenti_attivi_oggi')
    .select('gruppo_id, numero_attivi')
  const attiviOggiPerGruppo = new Map<string | null, number>()
  for (const r of attiviGrezzi ?? []) attiviOggiPerGruppo.set(r.gruppo_id, r.numero_attivi)

  let queryFatturatoMensile = supabase
    .from('abbonamenti_mensili')
    .select('mese, gruppo_id, fatturato')
    .in('mese', ultimi12Mesi)
  if (filtroAttivo) queryFatturatoMensile = queryFatturatoMensile.in('gruppo_id', gruppiSelezionati)
  const { data: fatturatoGrezzo, error: erroreFatturatoMensile } = await queryFatturatoMensile

  const fatturatoPerMeseGruppo = new Map<string, Map<string | null, number>>()
  for (const r of fatturatoGrezzo ?? []) {
    const mappaGruppi = fatturatoPerMeseGruppo.get(r.mese) ?? new Map<string | null, number>()
    mappaGruppi.set(r.gruppo_id, (mappaGruppi.get(r.gruppo_id) ?? 0) + Number(r.fatturato ?? 0))
    fatturatoPerMeseGruppo.set(r.mese, mappaGruppi)
  }

  // Gli 11 mesi chiusi vengono dallo storico congelato
  // (abbonamenti_attivi_storico, scritto una volta a mese chiuso da
  // pg_cron); il mese in corso non è ancora congelato, quindi è
  // attiviOggiPerGruppo qui sopra, riusato come sua ultima colonna.
  const mesiChiusi = ultimi12Mesi.slice(0, -1)
  const { data: storicoAttiviGrezzi, error: erroreStoricoAttivi } = await supabase
    .from('abbonamenti_attivi_storico')
    .select('mese, gruppo_id, numero_attivi')
    .in('mese', mesiChiusi)

  const attiviPerMeseGruppo = new Map<string, Map<string | null, number>>()
  for (const r of storicoAttiviGrezzi ?? []) {
    const mappaGruppi = attiviPerMeseGruppo.get(r.mese) ?? new Map<string | null, number>()
    mappaGruppi.set(r.gruppo_id, r.numero_attivi)
    attiviPerMeseGruppo.set(r.mese, mappaGruppi)
  }
  attiviPerMeseGruppo.set(meseCorrenteData, attiviOggiPerGruppo)

  // Stesso colore ovunque per lo stesso gruppo: assegnato una volta sola
  // qui, non ricalcolato mese per mese.
  const coloreDiGruppo = new Map<string | null, string>()
  gruppi.forEach((g, i) => coloreDiGruppo.set(g.id, PALETTE_GRUPPI[i % PALETTE_GRUPPI.length]))
  coloreDiGruppo.set(null, COLORE_NON_CATEGORIZZATO)

  const gruppiPerGrafici = filtroAttivo ? gruppi.filter((g) => gruppiSelezionati.includes(g.id)) : gruppi

  // `formatta` gira qui, lato server: GraficoPerGruppo è un Client
  // Component, e attraverso il confine RSC può ricevere solo dati, mai una
  // funzione — il testo va quindi già scritto quando arriva lì.
  function costruisciVoci(
    mappaGruppi: Map<string | null, number> | undefined,
    formatta: (n: number) => string
  ): VoceGruppoStack[] {
    const voci: VoceGruppoStack[] = gruppiPerGrafici.map((g) => {
      const valore = mappaGruppi?.get(g.id) ?? 0
      return { gruppoId: g.id, nome: g.nome, colore: coloreDiGruppo.get(g.id)!, valore, valoreTesto: formatta(valore) }
    })
    const nonCategorizzato = mappaGruppi?.get(null) ?? 0
    if (!filtroAttivo && nonCategorizzato > 0) {
      voci.push({
        gruppoId: null,
        nome: 'Non categorizzato',
        colore: COLORE_NON_CATEGORIZZATO,
        valore: nonCategorizzato,
        valoreTesto: formatta(nonCategorizzato),
      })
    }
    return voci
  }

  function costruisciSerie(
    perMese: Map<string, Map<string | null, number>>,
    formatta: (n: number) => string
  ): VoceMeseStack[] {
    return ultimi12Mesi.map((m) => {
      const voci = costruisciVoci(perMese.get(m), formatta)
      const totale = voci.reduce((tot, v) => tot + v.valore, 0)
      return { mese: m, etichetta: etichettaMeseBreve(m), gruppi: voci, totale, totaleTesto: formatta(totale) }
    })
  }

  function costruisciLegenda(serie: VoceMeseStack[]): VoceLegendaStack[] {
    const voci: VoceLegendaStack[] = gruppiPerGrafici.map((g) => ({
      chiave: g.id,
      nome: g.nome,
      colore: coloreDiGruppo.get(g.id)!,
    }))
    if (!filtroAttivo && serie.some((m) => m.gruppi.some((g) => g.gruppoId === null))) {
      voci.push({ chiave: 'non-categorizzato', nome: 'Non categorizzato', colore: COLORE_NON_CATEGORIZZATO })
    }
    return voci
  }

  const serieFatturatoMensile = costruisciSerie(fatturatoPerMeseGruppo, (n) => euro(n) ?? '—')
  const legendaFatturato = costruisciLegenda(serieFatturatoMensile)

  const serieAttiviMensile = costruisciSerie(attiviPerMeseGruppo, (n) => String(n))
  const legendaAttivi = costruisciLegenda(serieAttiviMensile)

  return {
    attiviOggiPerGruppo,
    erroreAttiviOggi,
    serieFatturatoMensile,
    legendaFatturato,
    erroreFatturatoMensile,
    serieAttiviMensile,
    legendaAttivi,
    erroreStoricoAttivi,
  }
}
