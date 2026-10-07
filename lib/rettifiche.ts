import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'

// Il report «Eliminazioni e storni» (/dashboard/incassato/eliminazioni): ogni
// movimento di cassa che corregge un incasso già registrato, letto dalla
// vista `rettifiche_cassa` (scripts/sql/2026-10-07-rettifiche-cassa.sql, che
// spiega anche come Info4U le produce).

type Supabase = ReturnType<typeof createSupabaseServiceClient>

const PAGINA = 1000

export const CATEGORIE = ['eliminazione', 'ripristino', 'storno_rata', 'storno_altro'] as const
export type Categoria = (typeof CATEGORIE)[number]

export const ETICHETTE_CATEGORIA: Record<Categoria, { nome: string; nota: string }> = {
  eliminazione: {
    nome: 'Eliminazioni di vendita',
    nota: 'Un operatore elimina una vendita: Info4U lascia l’incasso e aggiunge un movimento negativo che lo compensa.',
  },
  ripristino: {
    nome: 'Ripristini',
    nota: 'Incasso positivo che ricrea quanto era stato eliminato: la vendita è stata rifatta (di fatto una modifica).',
  },
  storno_rata: {
    nome: 'Storni di rate',
    nota: 'Rata già pagata stornata perché la vendita è stata eliminata.',
  },
  storno_altro: { nome: 'Altri storni', nota: 'Altri movimenti che puntano a un movimento da rettificare.' },
}

export type Rettifica = {
  source_movimento_id: number
  data_operazione: string
  giorno: string
  importo: number
  tipo_servizio: string | null
  causale: string | null
  metodo_pagamento: string | null
  operatore_nome: string | null
  persona_id: string | null
  persona_nome: string | null
  persona_cognome: string | null
  source_iscrizione_id: number | null
  categoria: Categoria
  storno_di: number | null
  originale_id: number | null
  originale_data: string | null
  originale_importo: number | null
  originale_operatore: string | null
  originale_metodo: string | null
  giorni_dall_originale: number | null
  mese_diverso: boolean | null
}

export async function caricaRettifiche(
  supabase: Supabase,
  primo: string,
  ultimo: string
): Promise<{ righe: Rettifica[]; errore: string | null }> {
  const righe: Rettifica[] = []
  for (let da = 0; da < 20 * PAGINA; da += PAGINA) {
    const { data, error } = await supabase
      .from('rettifiche_cassa')
      .select(
        'source_movimento_id, data_operazione, giorno, importo, tipo_servizio, causale, metodo_pagamento, operatore_nome, persona_id, persona_nome, persona_cognome, source_iscrizione_id, categoria, storno_di, originale_id, originale_data, originale_importo, originale_operatore, originale_metodo, giorni_dall_originale, mese_diverso'
      )
      .gte('giorno', primo)
      .lte('giorno', ultimo)
      .order('data_operazione', { ascending: false })
      .order('source_movimento_id', { ascending: false })
      .range(da, da + PAGINA - 1)
    if (error) return { righe: [], errore: error.message }
    for (const r of data ?? []) {
      righe.push({
        ...(r as unknown as Rettifica),
        source_movimento_id: Number(r.source_movimento_id),
        importo: Number(r.importo ?? 0),
        originale_importo: r.originale_importo === null ? null : Number(r.originale_importo),
        giorni_dall_originale: r.giorni_dall_originale === null ? null : Number(r.giorni_dall_originale),
      })
    }
    if (!data || data.length < PAGINA) break
  }
  return { righe, errore: null }
}

export type FiltriRettifiche = {
  categoria: Categoria | null
  operatore: string | null
  soloMeseDiverso: boolean
  soloNonCollegate: boolean
  conZero: boolean
}

export function leggiFiltriRettifiche(sp: {
  categoria?: string
  operatore?: string
  mesediverso?: string
  noncollegate?: string
  zero?: string
}): FiltriRettifiche {
  return {
    categoria: (CATEGORIE as readonly string[]).includes(sp.categoria ?? '') ? (sp.categoria as Categoria) : null,
    operatore: sp.operatore && sp.operatore.length <= 60 ? sp.operatore : null,
    soloMeseDiverso: sp.mesediverso === 'si',
    soloNonCollegate: sp.noncollegate === 'si',
    conZero: sp.zero === 'si',
  }
}

export function parametriRettifiche(f: FiltriRettifiche): Record<string, string> {
  const p: Record<string, string> = {}
  if (f.categoria) p.categoria = f.categoria
  if (f.operatore) p.operatore = f.operatore
  if (f.soloMeseDiverso) p.mesediverso = 'si'
  if (f.soloNonCollegate) p.noncollegate = 'si'
  if (f.conZero) p.zero = 'si'
  return p
}

export function applicaFiltri(righe: Rettifica[], f: FiltriRettifiche): Rettifica[] {
  return righe.filter((r) => {
    if (!f.conZero && r.importo === 0) return false
    if (f.categoria && r.categoria !== f.categoria) return false
    if (f.operatore && (r.operatore_nome ?? '—') !== f.operatore) return false
    if (f.soloMeseDiverso && !r.mese_diverso) return false
    // «Non collegata»: una eliminazione che non punta a un movimento
    // originale — la sua compensazione non si può verificare a colpo
    // d'occhio.
    if (f.soloNonCollegate && !(r.categoria === 'eliminazione' && r.storno_di === null)) return false
    return true
  })
}

/** La causale senza il prefisso fisso, per leggere subito il prodotto. */
export function causalePulita(causale: string | null): string {
  return (causale ?? '—').replace(/^ABBONAMENTI: Eliminato abbonamento\s*/i, '')
}
