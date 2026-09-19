// Se una vendita è stata "lavorata" — c'è stato un passaggio nel CRM prima
// dell'acquisto (una richiesta dal sito, una trattativa, un'azione della
// segreteria: task, appuntamento, visita in sede) — o se è arrivata senza,
// un rinnovo al banco o un walk-in mai passato dal sito.
//
// Niente vista SQL apposta: `abbonamenti` supera le 190.000 righe, e una
// vista che incrociasse l'intera anagrafica ad ogni caricamento di pagina
// scalerebbe male. Il chiamante passa solo gli ID delle persone che gli
// servono — i clienti di un giorno, di un mese, i 12 mesi di un grafico —
// mai l'anagrafica intera.
import type { createSupabaseServiceClient } from './supabase/serviceClient'
import { ETICHETTE_TIPO, type TipoVoce } from './agenda'
import { ETICHETTE_STATO, type StatoTrattativa } from './pipeline'

type Supabase = ReturnType<typeof createSupabaseServiceClient>

export type VoceCronistoria = {
  id: string
  /** "YYYY-MM-DD", ora locale di Roma — solo per ordinare e formattare a
   *  mano: non è un istante, non va mai ripassato a `new Date()` (vedi
   *  formattaVoceData più sotto sul perché). */
  data: string
  etichetta: string
  dettaglio: string | null
}

export type AttivitaPersona = {
  lavorata: boolean
  cronistoria: VoceCronistoria[]
}

// Il limite pratico di un filtro .in() di PostgREST prima che l'URL diventi
// troppo lungo: oltre questa soglia si spezza in più chiamate.
const DIMENSIONE_BLOCCO = 200

function aBlocchi<T>(elementi: T[], dimensione: number): T[][] {
  const blocchi: T[][] = []
  for (let i = 0; i < elementi.length; i += dimensione) blocchi.push(elementi.slice(i, i + dimensione))
  return blocchi
}

function aggiungi(mappa: Map<string, AttivitaPersona>, personaId: string | null, voce: VoceCronistoria) {
  if (!personaId) return
  const esistente = mappa.get(personaId) ?? { lavorata: false, cronistoria: [] }
  esistente.lavorata = true
  esistente.cronistoria.push(voce)
  mappa.set(personaId, esistente)
}

/** Un istante (timestamptz, da richieste/trattative) alla sua data di
 *  calendario a Roma — per ordinare insieme a `task.data`, che è già una
 *  data "di parete" senza fuso. */
function dataRoma(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
}

/**
 * Per ogni persona in `personaIds`, la sua storia commerciale, dalla più
 * recente. `lavorata` è vera appena c'è una sola voce, di qualunque tipo:
 * non conta quanto lavoro c'è stato, solo se c'è stato.
 */
export async function caricaAttivitaCommerciale(
  supabase: Supabase,
  personaIds: (string | null)[]
): Promise<Map<string, AttivitaPersona>> {
  const idUnici = Array.from(new Set(personaIds.filter((id): id is string => Boolean(id))))
  const mappa = new Map<string, AttivitaPersona>()
  if (idUnici.length === 0) return mappa

  for (const blocco of aBlocchi(idUnici, DIMENSIONE_BLOCCO)) {
    const [{ data: richieste }, { data: trattative }] = await Promise.all([
      supabase.from('form_contatti').select('id, persona_id, created_at, attivita_label').in('persona_id', blocco),
      supabase.from('opportunita').select('id, persona_id, creato_il, stato').in('persona_id', blocco),
    ])

    for (const r of richieste ?? []) {
      aggiungi(mappa, r.persona_id as string, {
        id: `richiesta-${r.id}`,
        data: dataRoma(r.created_at as string),
        etichetta: 'Richiesta dal sito',
        dettaglio: (r.attivita_label as string) || null,
      })
    }
    for (const t of trattative ?? []) {
      aggiungi(mappa, t.persona_id as string, {
        id: `trattativa-${t.id}`,
        data: dataRoma(t.creato_il as string),
        etichetta: 'Trattativa',
        dettaglio: ETICHETTE_STATO[t.stato as StatoTrattativa] ?? null,
      })
    }

    // I task agganciati direttamente alla persona, e quelli agganciati a una
    // sua richiesta (il collegamento è polimorfico — vedi task.entita/
    // entita_id in scripts/sql/2026-09-08-eventi-collegati.sql — mai una FK,
    // quindi due query invece di un unico filtro).
    const idRichiesteBlocco = (richieste ?? []).map((r) => String(r.id))
    const personaDiRichiesta = new Map((richieste ?? []).map((r) => [String(r.id), r.persona_id as string]))

    const [{ data: taskDiretti }, { data: taskDaRichiesta }] = await Promise.all([
      supabase.from('task').select('id, entita_id, data, tipo, titolo').eq('entita', 'persona').in('entita_id', blocco),
      idRichiesteBlocco.length > 0
        ? supabase
            .from('task')
            .select('id, entita_id, data, tipo, titolo')
            .eq('entita', 'form_contatti')
            .in('entita_id', idRichiesteBlocco)
        : Promise.resolve({ data: [] as { id: string; entita_id: string; data: string; tipo: string; titolo: string | null }[] }),
    ])

    for (const t of taskDiretti ?? []) {
      aggiungi(mappa, t.entita_id as string, {
        id: `task-${t.id}`,
        data: t.data as string,
        etichetta: ETICHETTE_TIPO[t.tipo as TipoVoce] ?? 'Azione',
        dettaglio: (t.titolo as string) || null,
      })
    }
    for (const t of taskDaRichiesta ?? []) {
      const personaId = personaDiRichiesta.get(t.entita_id as string)
      if (!personaId) continue
      aggiungi(mappa, personaId, {
        id: `task-${t.id}`,
        data: t.data as string,
        etichetta: ETICHETTE_TIPO[t.tipo as TipoVoce] ?? 'Azione',
        dettaglio: (t.titolo as string) || null,
      })
    }
  }

  for (const attivita of mappa.values()) {
    attivita.cronistoria.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))
  }

  return mappa
}

const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']

/** "19 set 2026" da una data "YYYY-MM-DD": niente `new Date()` — è già una
 *  data locale, non un istante, e ripassarla per un fuso la sfaserebbe. */
export function formattaVoceData(data: string): string {
  const [anno, mese, giorno] = data.split('-')
  return `${Number(giorno)} ${MESI_BREVI[Number(mese) - 1]} ${anno}`
}
