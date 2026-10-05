import type { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'

// Lo storico delle note di gestione di una scadenza (vedi
// scripts/sql/2026-10-05-abbonamenti-scadenze-note-storico.sql): una riga per
// nota inviata, mai modificata. Nessun import server-only: il tipo serve
// anche alla tabella, che è un componente client; il caricamento lo usano le
// due pagine server (Rinnovi Core e Scadenze).

// Le due colonne di note della tabella: la gestione del rinnovo e il motivo,
// a parole, del mancato rinnovo. Stessa forma, stessa tabella.
export const TIPI_NOTA = ['gestione', 'non_rinnovo'] as const
export type TipoNota = (typeof TIPI_NOTA)[number]

export type NotaScadenza = {
  id: string
  tipo: TipoNota
  testo: string
  // Email di staff_users; null per le note scritte prima dello storico.
  autore: string | null
  creato_il: string
}

// Il tag con cui una nota compare nello storico della scheda contatto, fra
// le azioni fatte: dice da quale delle due colonne della tabella rinnovi
// arriva.
export const TAG_NOTA: Record<TipoNota, string> = {
  gestione: 'Nota di gestione rinnovo',
  non_rinnovo: 'Nota motivo non rinnovo',
}

// 150 uuid a richiesta: l'elenco va nell'URL della GET di PostgREST, e un
// mese di punta (oltre 1500 scadenze) in una richiesta sola lo renderebbe
// più lungo di quanto i proxy accettano.
const BLOCCO = 150

/** Le note delle scadenze indicate (di entrambi i tipi), per abbonamento, la più recente in cima. */
export async function caricaNoteScadenze(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  abbonamentoIds: string[]
): Promise<Record<string, NotaScadenza[]>> {
  const perAbbonamento: Record<string, NotaScadenza[]> = {}
  for (let i = 0; i < abbonamentoIds.length; i += BLOCCO) {
    const { data, error } = await supabase
      .from('abbonamenti_scadenze_note')
      .select('id, abbonamento_id, tipo, testo, autore, creato_il')
      .in('abbonamento_id', abbonamentoIds.slice(i, i + BLOCCO))
      .order('creato_il', { ascending: false })
    if (error) {
      // Tabella non ancora creata o errore momentaneo: la tabella resta
      // usabile, solo senza storico — meglio che una pagina rotta.
      console.error('Note di gestione non caricate:', error.message)
      return perAbbonamento
    }
    for (const n of data ?? []) {
      const { abbonamento_id, ...nota } = n as NotaScadenza & { abbonamento_id: string }
      ;(perAbbonamento[abbonamento_id] ??= []).push(nota)
    }
  }
  return perAbbonamento
}
