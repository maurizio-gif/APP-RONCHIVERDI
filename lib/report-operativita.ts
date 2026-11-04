import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { caricaGruppi } from '@/lib/abbonamenti'
import { AZIONE_RICHIAMO, giornoDiIstante, giornoPiu, mezzanotteRoma, tipoDaAzione } from '@/lib/agenda'
import { provenienzaTrattativa } from '@/lib/provenienza'

// Server-only (client service role): i dati del report giornaliero del Core
// Manager, l'operatività di ogni operatore commerciale — New e rinnovi — giorno
// per giorno: quante azioni ha fatto, di che tipo, e quanto ha venduto.
//
// ── Azioni (cosa ha fatto l'operatore) ───────────────────────────────────
//
//  - TELEFONATE: le telefonate chiuse in agenda, anche a vuoto («non
//    risponde» è un tentativo fatto), per chi le ha chiuse e il giorno in cui
//    sono state chiuse.
//  - VISITE: le visite in sede svolte (esito «eseguita»): una visita saltata
//    non è una azione di chi doveva farla.
//  - MESSAGGI: email e WhatsApp registrati, e le richieste dal sito senza
//    appuntamento (messaggio, «Richiamami») lavorate, per chi le ha gestite.
//  - ALTRE: i task generici chiusi.
//  - WALK-IN ACCOLTI: chi si è registrato al banco con questo operatore al
//    banco (form_contatti.operatore).
//  - NOTE RINNOVO: le note scritte sulle scadenze Core (gestione e motivo del
//    mancato rinnovo), per chi le ha scritte: sono le «azioni rinnovo».
//  - PRESE IN CARICO: le trattative prese in carico (opportunita.assegnato_il).
//
// ── Vendite (cosa ha venduto) ────────────────────────────────────────────
//
//  - NEW, per canale: le trattative vinte nel giorno (opportunita.chiuso_il)
//    dall'assegnatario, con il valore scritto sulla trattativa. Il canale è
//    quello di provenienzaTrattativa (lib/provenienza.ts): Walk-in (il
//    registro ospiti al banco), Sito (le richieste dal sito), Altro (agenda,
//    phone-in, eventi, recupero dei mancati rinnovi).
//  - Le trattative aperte da una scadenza mensile (hanno un abbonamento) NON
//    sono New: quando si vincono, la vendita è il rinnovo di quella scadenza
//    e sta già nei rinnovi. Contarle due volte gonfierebbe il totale.
//  - RINNOVI: le scadenze Core rinnovate, per il giorno in cui il rinnovo è
//    stato venduto (abbonamenti.data_vendita) e per l'operatore a cui la
//    scadenza è assegnata; il venduto è l'importo del rinnovo. Le scadenze
//    escluse dal report non contano.
//
// Chi scrive una nota e a chi è assegnata la scadenza possono essere persone
// diverse (un collega copre un'assenza): le azioni sono di chi le ha fatte, i
// rinnovi di chi ha in carico la scadenza.

export type CanaleNew = 'walkin' | 'sito' | 'altro'
export type CanaleVendita = CanaleNew | 'rinnovi'
export const CANALI_NEW: CanaleNew[] = ['walkin', 'sito', 'altro']
export const CANALI_VENDITA: CanaleVendita[] = ['walkin', 'sito', 'altro', 'rinnovi']

export const ETICHETTE_CANALE: Record<CanaleVendita, string> = {
  walkin: 'Walk-in',
  sito: 'Sito',
  altro: 'Altro New',
  rinnovi: 'Rinnovi',
}

export type Vendita = { n: number; euro: number }

/** Le misure di un operatore in un giorno. */
export type Misure = {
  tel: number
  visite: number
  msg: number
  altre: number
  walkinAccolti: number
  noteRinnovo: number
  prese: number
  vendite: Record<CanaleVendita, Vendita>
}

export function misureVuote(): Misure {
  return {
    tel: 0,
    visite: 0,
    msg: 0,
    altre: 0,
    walkinAccolti: 0,
    noteRinnovo: 0,
    prese: 0,
    vendite: {
      walkin: { n: 0, euro: 0 },
      sito: { n: 0, euro: 0 },
      altro: { n: 0, euro: 0 },
      rinnovi: { n: 0, euro: 0 },
    },
  }
}

export function sommaMisure(elenco: Misure[]): Misure {
  const s = misureVuote()
  for (const m of elenco) {
    s.tel += m.tel
    s.visite += m.visite
    s.msg += m.msg
    s.altre += m.altre
    s.walkinAccolti += m.walkinAccolti
    s.noteRinnovo += m.noteRinnovo
    s.prese += m.prese
    for (const c of CANALI_VENDITA) {
      s.vendite[c].n += m.vendite[c].n
      s.vendite[c].euro += m.vendite[c].euro
    }
  }
  return s
}

export const azioniTotali = (m: Misure) =>
  m.tel + m.visite + m.msg + m.altre + m.walkinAccolti + m.noteRinnovo + m.prese

export const venditeTotali = (m: Misure): Vendita => ({
  n: CANALI_VENDITA.reduce((s, c) => s + m.vendite[c].n, 0),
  euro: CANALI_VENDITA.reduce((s, c) => s + m.vendite[c].euro, 0),
})

export type Operativita = {
  /** I giorni caricati, dal più vecchio al più recente. */
  giorni: string[]
  /** giorno → operatore (email in minuscolo) → misure. */
  perGiorno: Map<string, Map<string, Misure>>
  /** Le trattative nate in ogni giorno, per canale (i «lead arrivati»). */
  lead: Map<string, Record<CanaleNew, number>>
}

// 150 id a richiesta: l'elenco va nell'URL della GET di PostgREST.
const BLOCCO = 150

type Errore = { message: string } | null
type Supabase = ReturnType<typeof createSupabaseServiceClient>

async function tuttiPaginato<T>(
  esegui: (da: number, a: number) => PromiseLike<{ data: T[] | null; error: Errore }>,
  etichetta: string
): Promise<T[]> {
  const tutte: T[] = []
  for (let da = 0; ; da += 1000) {
    const { data, error } = await esegui(da, da + 999)
    if (error) {
      console.error(`Report operatività, ${etichetta} non letto:`, error.message)
      break
    }
    tutte.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return tutte
}

function aBlocchi<T>(elenco: T[]): T[][] {
  const blocchi: T[][] = []
  for (let i = 0; i < elenco.length; i += BLOCCO) blocchi.push(elenco.slice(i, i + BLOCCO))
  return blocchi
}

const chiaveOperatore = (email: string | null | undefined) => (email ?? '').trim().toLowerCase()

/**
 * Le misure di ogni operatore per ogni giorno da `da` ad `a` (giorni di Roma,
 * estremi inclusi).
 */
export async function caricaOperativita(supabase: Supabase, da: string, a: string): Promise<Operativita> {
  const giorni: string[] = []
  for (let g = da; g <= a; g = giornoPiu(g, 1)) giorni.push(g)

  const inizio = mezzanotteRoma(da)
  const fine = mezzanotteRoma(giornoPiu(a, 1))

  const perGiorno = new Map<string, Map<string, Misure>>(giorni.map((g) => [g, new Map()]))
  const lead = new Map<string, Record<CanaleNew, number>>(giorni.map((g) => [g, { walkin: 0, sito: 0, altro: 0 }]))
  const misure = (giorno: string, operatore: string): Misure | null => {
    const delGiorno = perGiorno.get(giorno)
    if (!delGiorno) return null
    let m = delGiorno.get(operatore)
    if (!m) {
      m = misureVuote()
      delGiorno.set(operatore, m)
    }
    return m
  }

  const gruppoCore = (await caricaGruppi()).find((g) => g.nome === 'CORE')

  const [task, richieste, walkin, prese, vinte, create, note, vendite] = await Promise.all([
    // Le voci d'agenda chiuse: per le telefonate e le visite c'è esito_il,
    // per email e WhatsApp (registrate già chiuse) solo completato_il.
    tuttiPaginato<Record<string, any>>(
      (d, f) =>
        supabase
          .from('task')
          .select('tipo, esito_tipo, esito_da, esito_il, completato_il, assegnato_a')
          .eq('stato', 'completato')
          .or(
            `and(esito_il.gte.${inizio},esito_il.lt.${fine}),and(esito_il.is.null,completato_il.gte.${inizio},completato_il.lt.${fine})`
          )
          .range(d, f),
      'task'
    ),
    // Messaggi e «Richiamami» lavorati: contano per quando e da chi.
    tuttiPaginato<Record<string, any>>(
      (d, f) =>
        supabase
          .from('form_contatti')
          .select('azione, gestito_da, gestito_il')
          .eq('gestito', true)
          .gte('gestito_il', inizio)
          .lt('gestito_il', fine)
          .range(d, f),
      'richieste lavorate'
    ),
    tuttiPaginato<Record<string, any>>(
      (d, f) =>
        supabase
          .from('form_contatti')
          .select('operatore, created_at')
          .eq('origine', 'walk-in')
          .gte('created_at', inizio)
          .lt('created_at', fine)
          .range(d, f),
      'walk-in'
    ),
    tuttiPaginato<Record<string, any>>(
      (d, f) =>
        supabase
          .from('opportunita')
          .select('assegnato_a, assegnato_il')
          .not('assegnato_a', 'is', null)
          .gte('assegnato_il', inizio)
          .lt('assegnato_il', fine)
          .range(d, f),
      'prese in carico'
    ),
    tuttiPaginato<Record<string, any>>(
      (d, f) =>
        supabase
          .from('opportunita')
          .select('id, assegnato_a, chiuso_il, valore_euro, origine, abbonamento_id')
          .eq('stato', 'vinto')
          .is('abbonamento_id', null)
          .gte('chiuso_il', inizio)
          .lt('chiuso_il', fine)
          .range(d, f),
      'vendite New'
    ),
    tuttiPaginato<Record<string, any>>(
      (d, f) =>
        supabase
          .from('opportunita')
          .select('id, creato_il, origine, abbonamento_id')
          .is('abbonamento_id', null)
          .gte('creato_il', inizio)
          .lt('creato_il', fine)
          .range(d, f),
      'lead arrivati'
    ),
    gruppoCore
      ? tuttiPaginato<Record<string, any>>(
          (d, f) =>
            supabase
              .from('abbonamenti_scadenze_note')
              .select('abbonamento_id, autore, creato_il')
              .gte('creato_il', inizio)
              .lt('creato_il', fine)
              .range(d, f),
          'note rinnovo'
        )
      : Promise.resolve([] as Record<string, any>[]),
    gruppoCore
      ? tuttiPaginato<Record<string, any>>(
          (d, f) =>
            supabase
              .from('abbonamenti')
              .select('id, data_vendita')
              .is('cancellato_il', null)
              .gte('data_vendita', inizio)
              .lt('data_vendita', fine)
              .range(d, f),
          'vendite del periodo'
        )
      : Promise.resolve([] as Record<string, any>[]),
  ])

  // ── azioni ──
  for (const t of task) {
    const quando = (t.esito_il ?? t.completato_il) as string | null
    const operatore = chiaveOperatore(t.esito_da ?? t.assegnato_a)
    if (!quando || !operatore) continue
    const m = misure(giornoDiIstante(quando), operatore)
    if (!m) continue
    if (t.tipo === 'appuntamento_telefonico') m.tel += 1
    else if (t.tipo === 'appuntamento_in_sede') {
      if (t.esito_tipo === 'eseguita') m.visite += 1
    } else if (t.tipo === 'email' || t.tipo === 'whatsapp') m.msg += 1
    else m.altre += 1
  }

  for (const r of richieste) {
    const operatore = chiaveOperatore(r.gestito_da)
    if (!operatore || !r.gestito_il) continue
    // Come nel foglio classico: un «Richiamami» conta fra i messaggi.
    if (tipoDaAzione(r.azione as string | null) !== 'messaggio' && r.azione !== AZIONE_RICHIAMO) continue
    const m = misure(giornoDiIstante(r.gestito_il as string), operatore)
    if (m) m.msg += 1
  }

  for (const w of walkin) {
    const operatore = chiaveOperatore(w.operatore)
    if (!operatore) continue
    const m = misure(giornoDiIstante(w.created_at as string), operatore)
    if (m) m.walkinAccolti += 1
  }

  for (const p of prese) {
    const operatore = chiaveOperatore(p.assegnato_a)
    if (!operatore || !p.assegnato_il) continue
    const m = misure(giornoDiIstante(p.assegnato_il as string), operatore)
    if (m) m.prese += 1
  }

  // ── il canale delle trattative: la richiesta più recente, o l'origine ──
  const idOpportunita = [...new Set([...vinte.map((v) => v.id as string), ...create.map((c) => c.id as string)])]
  const origineRichiesta = new Map<string, string | null>()
  const risposteRichieste = await Promise.all(
    aBlocchi(idOpportunita).map((ids) =>
      supabase
        .from('form_contatti')
        .select('opportunita_id, origine, created_at')
        .in('opportunita_id', ids)
        .order('created_at', { ascending: false })
    )
  )
  for (const { data, error } of risposteRichieste) {
    if (error) console.error('Report operatività, richieste delle trattative non lette:', error.message)
    for (const r of data ?? []) {
      const id = r.opportunita_id as string
      if (!origineRichiesta.has(id)) origineRichiesta.set(id, (r.origine as string | null) ?? null)
    }
  }
  const canaleDi = (id: string, origine: string | null): CanaleNew => {
    const chiave = provenienzaTrattativa({
      origineRichiesta: origineRichiesta.get(id),
      origineTrattativa: origine,
      haRichiesta: origineRichiesta.has(id),
    }).chiave
    return chiave === 'guest-register' ? 'walkin' : chiave === 'sito' ? 'sito' : 'altro'
  }

  for (const c of create) {
    const giorno = lead.get(giornoDiIstante(c.creato_il as string))
    if (giorno) giorno[canaleDi(c.id as string, (c.origine as string | null) ?? null)] += 1
  }

  for (const v of vinte) {
    const operatore = chiaveOperatore(v.assegnato_a)
    if (!operatore || !v.chiuso_il) continue
    const m = misure(giornoDiIstante(v.chiuso_il as string), operatore)
    if (!m) continue
    const vendita = m.vendite[canaleDi(v.id as string, (v.origine as string | null) ?? null)]
    vendita.n += 1
    vendita.euro += v.valore_euro != null ? Number(v.valore_euro) : 0
  }

  // ── rinnovi: note e vendite delle sole scadenze Core ──
  if (gruppoCore) {
    const idNote = [...new Set(note.map((n) => n.abbonamento_id as string))]
    const idVendite = vendite.map((v) => v.id as string)
    const [rispostaNote, rispostaRinnovi] = await Promise.all([
      Promise.all(
        aBlocchi(idNote).map((ids) =>
          supabase.from('abbonamenti_scadenze').select('id').in('id', ids).eq('gruppo_id', gruppoCore.id)
        )
      ),
      Promise.all(
        aBlocchi(idVendite).map((ids) =>
          supabase
            .from('abbonamenti_scadenze')
            .select('rinnovo_id, rinnovo_totale, assegnato_a, escluso_da_report')
            .in('rinnovo_id', ids)
            .eq('gruppo_id', gruppoCore.id)
            .eq('rinnovato', true)
        )
      ),
    ])

    const scadenzeCore = new Set<string>()
    for (const { data, error } of rispostaNote) {
      if (error) console.error('Report operatività, scadenze Core delle note non lette:', error.message)
      for (const r of data ?? []) scadenzeCore.add(r.id as string)
    }
    for (const n of note) {
      if (!scadenzeCore.has(n.abbonamento_id as string)) continue
      const m = misure(giornoDiIstante(n.creato_il as string), chiaveOperatore(n.autore))
      if (m) m.noteRinnovo += 1
    }

    const giornoVendita = new Map(vendite.map((v) => [v.id as string, giornoDiIstante(v.data_vendita as string)]))
    // Un rinnovo vale una volta: due scadenze possono puntare allo stesso.
    const contati = new Set<string>()
    for (const { data, error } of rispostaRinnovi) {
      if (error) console.error('Report operatività, rinnovi non letti:', error.message)
      for (const r of data ?? []) {
        const id = r.rinnovo_id as string
        if (r.escluso_da_report || contati.has(id)) continue
        contati.add(id)
        const giorno = giornoVendita.get(id)
        if (!giorno) continue
        const m = misure(giorno, chiaveOperatore(r.assegnato_a))
        if (!m) continue
        m.vendite.rinnovi.n += 1
        m.vendite.rinnovi.euro += r.rinnovo_totale != null ? Number(r.rinnovo_totale) : 0
      }
    }
  }

  return { giorni, perGiorno, lead }
}

/**
 * Il coefficiente di correlazione di Pearson fra due serie, o null quando i
 * punti sono troppo pochi o una delle due non varia (nessuna correlazione
 * calcolabile).
 */
export function correlazione(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length)
  if (n < 8) return null
  const mx = x.reduce((s, v) => s + v, 0) / n
  const my = y.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  if (sxx === 0 || syy === 0) return null
  return sxy / Math.sqrt(sxx * syy)
}

/** Come si legge una correlazione, a parole. */
export function leggiCorrelazione(r: number | null): string {
  if (r === null) return 'Dati insufficienti per calcolarla'
  const forza = Math.abs(r)
  const grado = forza < 0.3 ? 'debole' : forza < 0.6 ? 'moderata' : 'forte'
  return `Correlazione ${grado}${r < 0 ? ' e negativa' : ''}`
}
