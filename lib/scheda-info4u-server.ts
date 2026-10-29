import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import {
  DATI_INFO4U_VUOTI,
  type AccessiPersona,
  type DatiInfo4u,
  type EmailInfo4u,
  type RataPersona,
  type RicevutaPersona,
  type VoceInfo4u,
} from '@/lib/schedaInfo4u'

// Le letture dei dati Info4U per la scheda contatto. Server-only: usa la
// service role key. Ogni blocco si legge per conto suo e, se fallisce, la
// scheda lo mostra vuoto invece di non aprirsi: sono dati di contorno.

const MAX_AZIONI = 150
const MAX_RATE = 200
const MAX_EMAIL = 50
const MAX_RICEVUTE = 5

type Db = ReturnType<typeof createSupabaseServiceClient>

async function leggi<T>(nome: string, vuoto: T, query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query
  if (error) {
    console.error(`Scheda Info4U, ${nome} non letto:`, error.message)
    return vuoto
  }
  return (data ?? vuoto) as T
}

async function accessiDi(supabase: Db, personaId: string): Promise<AccessiPersona> {
  const { data, error } = await supabase.rpc('scheda_accessi', { p_persona_id: personaId })
  if (error || !data) {
    if (error) console.error('Scheda Info4U, accessi non letti:', error.message)
    return DATI_INFO4U_VUOTI.accessi
  }
  const d = data as { ultimi?: AccessiPersona['ultimi']; finestre?: AccessiPersona['finestre'] }
  return { ultimi: d.ultimi ?? [], finestre: d.finestre ?? [] }
}

async function rateERicevute(
  supabase: Db,
  personaId: string,
  idIscrizioni: number[]
): Promise<{ rate: RataPersona[]; ricevute: RicevutaPersona[] }> {
  const [rate, ricevuteTesta] = await Promise.all([
    idIscrizioni.length
      ? leggi<RataPersona[]>(
          'rate',
          [],
          supabase
            .from('abbonamenti_rate')
            .select('data_rata, importo, data_pagato, metodo_pagamento')
            .in('source_iscrizione_id', idIscrizioni)
            .is('cancellato_il', null)
            .order('data_rata', { ascending: false })
            .limit(MAX_RATE)
        )
      : Promise.resolve([] as RataPersona[]),
    leggi<{ source_ricevuta_id: number; numero: number | null; tipo: string | null; data_ricevuta: string }[]>(
      'ricevute',
      [],
      supabase
        .from('ricevute')
        .select('source_ricevuta_id, numero, tipo, data_ricevuta')
        .eq('persona_id', personaId)
        .eq('annullata', false)
        .order('data_ricevuta', { ascending: false })
        .limit(MAX_RICEVUTE)
    ),
  ])

  const righe = ricevuteTesta.length
    ? await leggi<{ source_ricevuta_id: number; qta: number | null; descrizione: string | null; prezzo_unitario: number | null }[]>(
        'righe delle ricevute',
        [],
        supabase
          .from('ricevute_righe')
          .select('source_ricevuta_id, qta, descrizione, prezzo_unitario')
          .in('source_ricevuta_id', ricevuteTesta.map((r) => r.source_ricevuta_id))
      )
    : []

  const ricevute = ricevuteTesta.map((r): RicevutaPersona => {
    const sue = righe.filter((g) => g.source_ricevuta_id === r.source_ricevuta_id)
    const totale = sue.reduce((s, g) => s + Number(g.qta ?? 1) * Number(g.prezzo_unitario ?? 0), 0)
    const descrizioni = [...new Set(sue.map((g) => (g.descrizione ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))]
    return {
      numero: r.numero,
      tipo: r.tipo,
      data_ricevuta: r.data_ricevuta,
      totale: sue.length ? totale : null,
      descrizioni,
    }
  })
  return { rate, ricevute }
}

/** Le azioni e i memo scritti dai consulenti su Info4U, i più recenti per primi. */
async function storicoDi(supabase: Db, personaId: string): Promise<VoceInfo4u[]> {
  const [pratiche, memo, tipi, esiti] = await Promise.all([
    leggi<{ source_pratica_id: number }[]>(
      'pratiche',
      [],
      supabase.from('crm_pratiche').select('source_pratica_id').eq('persona_id', personaId)
    ),
    leggi<
      { id: string; oggetto: string | null; descrizione: string | null; operatore_id: number | null; data_operazione: string | null; ultima_modifica: string | null }[]
    >(
      'memo',
      [],
      supabase
        .from('crm_memo')
        .select('id, oggetto, descrizione, operatore_id, data_operazione, ultima_modifica')
        .eq('persona_id', personaId)
    ),
    leggi<{ source_tipo_id: number; descrizione: string | null }[]>(
      'tipi di azione',
      [],
      supabase.from('crm_tipi_azione').select('source_tipo_id, descrizione')
    ),
    leggi<{ source_esito_id: number; descrizione: string | null }[]>(
      'esiti di azione',
      [],
      supabase.from('crm_esiti_azione').select('source_esito_id, descrizione')
    ),
  ])

  const azioni = pratiche.length
    ? await leggi<
        {
          id: string
          descrizione: string | null
          data_appuntamento: string | null
          data_evasione: string | null
          source_tipo_id: number | null
          source_esito_id: number | null
          operatore_autore_id: number | null
        }[]
      >(
        'azioni',
        [],
        supabase
          .from('crm_azioni')
          .select('id, descrizione, data_appuntamento, data_evasione, source_tipo_id, source_esito_id, operatore_autore_id')
          .in('source_pratica_id', pratiche.map((p) => p.source_pratica_id))
          .order('data_appuntamento', { ascending: false, nullsFirst: false })
          .limit(MAX_AZIONI)
      )
    : []

  const idOperatori = [
    ...new Set([...azioni.map((a) => a.operatore_autore_id), ...memo.map((m) => m.operatore_id)].filter((x): x is number => x != null)),
  ]
  const operatori = idOperatori.length
    ? await leggi<{ source_operatore_id: number; nome: string | null }[]>(
        'operatori',
        [],
        supabase.from('operatori_info4u').select('source_operatore_id, nome').in('source_operatore_id', idOperatori)
      )
    : []

  const nomeTipo = new Map(tipi.map((t) => [t.source_tipo_id, t.descrizione]))
  const nomeEsito = new Map(esiti.map((e) => [e.source_esito_id, e.descrizione]))
  const nomeOperatore = new Map(operatori.map((o) => [o.source_operatore_id, o.nome]))

  const voci: VoceInfo4u[] = [
    ...azioni
      .filter((a) => a.data_appuntamento ?? a.data_evasione)
      .map(
        (a): VoceInfo4u => ({
          chiave: `info4u-azione-${a.id}`,
          quando: (a.data_appuntamento ?? a.data_evasione) as string,
          genere: 'azione',
          tipo: a.source_tipo_id != null ? nomeTipo.get(a.source_tipo_id) ?? null : null,
          esito: a.source_esito_id != null ? nomeEsito.get(a.source_esito_id) ?? null : null,
          titolo: null,
          testo: a.descrizione,
          autore: a.operatore_autore_id != null ? nomeOperatore.get(a.operatore_autore_id) ?? null : null,
        })
      ),
    ...memo
      .filter((m) => m.data_operazione ?? m.ultima_modifica)
      .map(
        (m): VoceInfo4u => ({
          chiave: `info4u-memo-${m.id}`,
          quando: (m.data_operazione ?? m.ultima_modifica) as string,
          genere: 'memo',
          tipo: null,
          esito: null,
          titolo: m.oggetto,
          testo: m.descrizione,
          autore: m.operatore_id != null ? nomeOperatore.get(m.operatore_id) ?? null : null,
        })
      ),
  ]
  return voci.sort((a, b) => b.quando.localeCompare(a.quando))
}

/** Tutto quello che la scheda mostra dai dati Info4U, in un colpo. */
export async function datiInfo4uDellaPersona(personaId: string, idIscrizioni: number[]): Promise<DatiInfo4u> {
  const supabase = createSupabaseServiceClient()
  const [accessi, certificati, quote, pagamenti, storico, emailRighe] = await Promise.all([
    accessiDi(supabase, personaId),
    leggi<DatiInfo4u['certificati']>(
      'certificati',
      [],
      supabase
        .from('certificati')
        .select('descrizione, data_emissione, data_scadenza')
        .eq('persona_id', personaId)
        .order('data_scadenza', { ascending: false })
        .limit(10)
    ),
    leggi<DatiInfo4u['quote']>(
      'quote associative',
      [],
      supabase
        .from('quote_associative')
        .select('data_inizio, data_fine')
        .eq('persona_id', personaId)
        .order('data_fine', { ascending: false })
        .limit(10)
    ),
    rateERicevute(supabase, personaId, idIscrizioni),
    storicoDi(supabase, personaId),
    leggi<
      { id: string; data_creazione: string | null; data_invio: string | null; oggetto: string | null; errore: string | null }[]
    >(
      'email Info4U',
      [],
      supabase
        .from('email_info4u')
        .select('id, data_creazione, data_invio, oggetto, errore')
        .eq('persona_id', personaId)
        .order('data_creazione', { ascending: false })
        .limit(MAX_EMAIL)
    ),
  ])
  const email: EmailInfo4u[] = emailRighe.map((e) => ({
    id: e.id,
    data: (e.data_invio ?? e.data_creazione ?? '') as string,
    oggetto: e.oggetto,
    inviata: !!e.data_invio && !e.errore,
    errore: e.errore,
  }))
  return { accessi, certificati, quote, rate: pagamenti.rate, ricevute: pagamenti.ricevute, storico, email }
}
