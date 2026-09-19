// Server-only (usa il client service role): importare solo da Server
// Component, Server Action o Route Handler.
//
// Qui si ricompone il percorso di una persona. Il perché sta in
// lib/percorsoVendita.ts; qui c'è solo il come — tre letture in parallelo su
// indici già esistenti (form_contatti.persona_id, opportunita.persona_id,
// task(entita, entita_id): vedi le migration del 2026-09-02 e del
// 2026-09-08), tutte per una persona sola. Per questo può stare dietro
// un'azione chiamata quando si apre una riga, invece che nel caricamento
// della pagina — vedi app/dashboard/abbonamenti/PercorsoVendita.tsx.
import type { createSupabaseServiceClient } from './supabase/serviceClient'
import { ETICHETTE_TIPO, type TipoVoce } from './agenda'
import { ETICHETTE_STATO, type StatoTrattativa } from './pipeline'
import { FINESTRA_PERCORSO_GIORNI, type Percorso, type Tappa } from './percorsoVendita'

type Supabase = ReturnType<typeof createSupabaseServiceClient>

function inizioFinestra(fine: string): string {
  return new Date(Date.parse(fine) - FINESTRA_PERCORSO_GIORNI * 86400000).toISOString()
}

/** Un istante alla sua data di calendario a Roma, per interrogare `task.data`
 *  (che è già una data "di parete" senza fuso, non un istante). */
function dataRoma(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
}

/**
 * Il percorso di una persona nei 30 giorni prima di una vendita.
 *
 * `dataVendita` è la fine della finestra, non oggi: una vendita di tre
 * settimane fa deve mostrare cosa è successo prima di *lei*, non quello che
 * è successo dopo (un rinnovo, una nuova richiesta l'anno seguente).
 */
export async function percorsoDiPersona(supabase: Supabase, personaId: string, dataVendita: string): Promise<Percorso> {
  const fino = dataVendita
  const dopo = inizioFinestra(fino)

  const [{ data: richieste }, { data: trattative }] = await Promise.all([
    supabase
      .from('form_contatti')
      .select('id, created_at, attivita_label')
      .eq('persona_id', personaId)
      .gte('created_at', dopo)
      .lte('created_at', fino),
    supabase
      .from('opportunita')
      .select('id, creato_il, stato')
      .eq('persona_id', personaId)
      .gte('creato_il', dopo)
      .lte('creato_il', fino),
  ])

  const idRichieste = (richieste ?? []).map((r) => String(r.id))
  const dopoData = dataRoma(dopo)
  const finoData = dataRoma(fino)

  const [{ data: taskDiretti }, { data: taskDaRichiesta }] = await Promise.all([
    supabase
      .from('task')
      .select('id, data, ora, tipo, titolo, stato')
      .eq('entita', 'persona')
      .eq('entita_id', personaId)
      .gte('data', dopoData)
      .lte('data', finoData),
    idRichieste.length > 0
      ? supabase
          .from('task')
          .select('id, data, ora, tipo, titolo, stato')
          .eq('entita', 'form_contatti')
          .in('entita_id', idRichieste)
          .gte('data', dopoData)
          .lte('data', finoData)
      : Promise.resolve({ data: [] as { id: string; data: string; ora: string | null; tipo: string; titolo: string | null; stato: string }[] }),
  ])

  const tappe: Tappa[] = []

  for (const r of richieste ?? []) {
    tappe.push({
      chiave: `richiesta-${r.id}`,
      genere: 'richiesta',
      momento: String(r.created_at),
      titolo: 'Richiesta dal sito',
      dettaglio: (r.attivita_label as string) || null,
    })
  }

  for (const t of trattative ?? []) {
    tappe.push({
      chiave: `trattativa-${t.id}`,
      genere: 'trattativa',
      momento: String(t.creato_il),
      titolo: 'Trattativa aperta',
      dettaglio: ETICHETTE_STATO[t.stato as StatoTrattativa] ?? null,
    })
  }

  // Annullati esclusi: quel contatto non è avvenuto, e contarlo direbbe il
  // falso proprio sulla frase di riepilogo che si va a leggere.
  for (const t of [...(taskDiretti ?? []), ...(taskDaRichiesta ?? [])]) {
    if (String(t.stato) === 'annullato') continue
    tappe.push({
      chiave: `task-${t.id}`,
      genere: 'desk',
      // L'ora quando c'è: due azioni nello stesso giorno vanno in ordine.
      momento: `${t.data}T${t.ora ?? '00:00:00'}`,
      titolo: ETICHETTE_TIPO[t.tipo as TipoVoce] ?? 'Azione',
      dettaglio: (t.titolo as string) || null,
    })
  }

  // Dalla più recente: è l'ordine con cui la si legge, e `riassumi` conta su
  // questo per sapere qual è la prima e quale l'ultima.
  tappe.sort((a, b) => (a.momento < b.momento ? 1 : a.momento > b.momento ? -1 : 0))

  return { tappe, fine: fino }
}

const DIMENSIONE_BLOCCO = 200

function aBlocchi<T>(elementi: T[], dimensione: number): T[][] {
  const blocchi: T[][] = []
  for (let i = 0; i < elementi.length; i += dimensione) blocchi.push(elementi.slice(i, i + dimensione))
  return blocchi
}

/**
 * Le date (YYYY-MM-DD) delle azioni della segreteria — non annullate — di più
 * persone in blocco, senza finestra: usato per classificare tante vendite
 * insieme (report mensile, grafico dei 12 mesi), dove ricostruire il
 * percorso di ciascuna una per volta costerebbe troppe query. Il chiamante
 * applica la finestra dei 30 giorni per ogni vendita con `eLavorata` (vedi
 * lib/percorsoVendita.ts) — la stessa regola di `riassumi().lavorato`.
 */
export async function caricaDateAzioniDesk(
  supabase: Supabase,
  personaIds: (string | null)[]
): Promise<Map<string, string[]>> {
  const idUnici = Array.from(new Set(personaIds.filter((id): id is string => Boolean(id))))
  const mappa = new Map<string, string[]>()
  if (idUnici.length === 0) return mappa

  function aggiungi(personaId: string, data: string) {
    const arr = mappa.get(personaId) ?? []
    arr.push(data)
    mappa.set(personaId, arr)
  }

  for (const blocco of aBlocchi(idUnici, DIMENSIONE_BLOCCO)) {
    const { data: richieste } = await supabase.from('form_contatti').select('id, persona_id').in('persona_id', blocco)
    const idRichieste = (richieste ?? []).map((r) => String(r.id))
    const personaDiRichiesta = new Map((richieste ?? []).map((r) => [String(r.id), r.persona_id as string]))

    const [{ data: taskDiretti }, { data: taskDaRichiesta }] = await Promise.all([
      supabase
        .from('task')
        .select('id, entita_id, data, stato')
        .eq('entita', 'persona')
        .in('entita_id', blocco)
        .neq('stato', 'annullato'),
      idRichieste.length > 0
        ? supabase
            .from('task')
            .select('id, entita_id, data, stato')
            .eq('entita', 'form_contatti')
            .in('entita_id', idRichieste)
            .neq('stato', 'annullato')
        : Promise.resolve({ data: [] as { id: string; entita_id: string; data: string; stato: string }[] }),
    ])

    for (const t of taskDiretti ?? []) aggiungi(t.entita_id as string, t.data as string)
    for (const t of taskDaRichiesta ?? []) {
      const personaId = personaDiRichiesta.get(t.entita_id as string)
      if (personaId) aggiungi(personaId, t.data as string)
    }
  }

  return mappa
}
