// I filtri della pagina Contatti › Filtri (/dashboard/persone/filtri): liste
// personalizzate sull'intera anagrafica. Qui i tipi, la lettura dei parametri
// dell'URL, le scelte rapide e le etichette; la funzione che filtra sta nel
// database (scripts/sql/2026-10-29-contatti-filtri.sql, `contatti_filtrati`)
// e la lettura in lib/contatti-filtri-server.ts. Niente import server-only: li
// usa anche l'elenco con le caselle di selezione.
//
// Tutto passa dall'URL: una lista si salva fra i preferiti, si manda a un
// collega, si riapre uguale. I nomi dei parametri sono corti e stabili.

export const AB = ['attivo', 'scade', 'scaduto', 'ex', 'mai'] as const
export const AC = ['inattivo', 'recente', 'mai'] as const
export const LD = ['qualsiasi', 'nessuno', 'non_contattato', 'aperto', 'da_prendere', 'in_gestione', 'ferma', 'vinto', 'perso'] as const
export const CM = ['valido', 'scaduto', 'assente', 'non_valido'] as const
export const ORDINI = ['cognome', 'accesso_vecchio', 'accesso_recente', 'scadenza_vicina', 'scadenza_recente', 'lead_recente'] as const

export type Ab = (typeof AB)[number]
export type Ac = (typeof AC)[number]
export type Ld = (typeof LD)[number]
export type Cm = (typeof CM)[number]
export type Ordine = (typeof ORDINI)[number]

export const PER_PAGINA = 50
/** Quante persone al massimo si esportano o si copiano in una volta. */
export const MAX_ESPORTAZIONE = 20000

/** I giorni fra cui si sceglie nelle tendine. */
export const GIORNI = [7, 14, 30, 60, 90, 180, 365] as const

export type FiltriContatti = {
  q?: string
  ab?: Ab
  /** Giorni per «scade», «scaduto» e «ex». */
  abg?: number
  /** Gruppo prodotti (uuid): gli abbonamenti si guardano solo lì. */
  gr?: string
  ac?: Ac
  acg?: number
  ld?: Ld
  /** Giorni per «ferma». */
  ldg?: number
  /** Solo lead nati negli ultimi N giorni. */
  lda?: number
  /** Email di chi segue una trattativa aperta, o '__nessuno__'. */
  ass?: string
  cm?: Cm
  rs?: boolean
  em?: boolean
  ce?: boolean
  etaDa?: number
  etaA?: number
  sx?: 'M' | 'F'
  /** Compleanno entro N giorni. */
  cp?: number
}

export const NESSUN_ASSEGNATARIO = '__nessuno__'

type Parametri = Record<string, string | string[] | undefined>

const primo = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function scelta<T extends string>(valore: string | undefined, ammessi: readonly T[]): T | undefined {
  return ammessi.find((a) => a === valore)
}

function intero(valore: string | undefined, minimo: number, massimo: number): number | undefined {
  if (valore === undefined || valore === '') return undefined
  const n = Number.parseInt(valore, 10)
  return Number.isFinite(n) ? Math.min(massimo, Math.max(minimo, n)) : undefined
}

/** I filtri, l'ordine, la pagina e le persone spuntate, dai parametri dell'URL. Quello che non si riconosce si ignora. */
export function leggiFiltri(sp: Parametri): { filtri: FiltriContatti; ordine: Ordine; pagina: number; ids: string[] } {
  const filtri: FiltriContatti = {}
  const q = primo(sp.q)?.trim()
  if (q) filtri.q = q.slice(0, 80)
  const ab = scelta(primo(sp.ab), AB)
  if (ab) filtri.ab = ab
  const abg = intero(primo(sp.abg), 1, 3650)
  if (abg) filtri.abg = abg
  const gr = primo(sp.gr)
  if (gr && UUID.test(gr)) filtri.gr = gr
  const ac = scelta(primo(sp.ac), AC)
  if (ac) filtri.ac = ac
  const acg = intero(primo(sp.acg), 1, 3650)
  if (acg) filtri.acg = acg
  const ld = scelta(primo(sp.ld), LD)
  if (ld && ld !== 'qualsiasi') filtri.ld = ld
  const ldg = intero(primo(sp.ldg), 1, 3650)
  if (ldg) filtri.ldg = ldg
  const lda = intero(primo(sp.lda), 1, 3650)
  if (lda) filtri.lda = lda
  const ass = primo(sp.ass)?.trim()
  if (ass && (ass === NESSUN_ASSEGNATARIO || /^[^\s@]+@[^\s@]+$/.test(ass))) filtri.ass = ass.toLowerCase()
  const cm = scelta(primo(sp.cm), CM)
  if (cm) filtri.cm = cm
  if (primo(sp.rs) === '1') filtri.rs = true
  if (primo(sp.em) === '1') filtri.em = true
  if (primo(sp.ce) === '1') filtri.ce = true
  const etaDa = intero(primo(sp.eta_da), 0, 120)
  if (etaDa !== undefined) filtri.etaDa = etaDa
  const etaA = intero(primo(sp.eta_a), 0, 120)
  if (etaA !== undefined) filtri.etaA = etaA
  const sx = primo(sp.sx)
  if (sx === 'M' || sx === 'F') filtri.sx = sx
  const cp = intero(primo(sp.cp), 1, 366)
  if (cp) filtri.cp = cp

  const ordine = scelta(primo(sp.ord), ORDINI) ?? 'cognome'
  const pagina = intero(primo(sp.p), 1, 100000) ?? 1
  const ids = (primo(sp.ids) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => UUID.test(s))
    .slice(0, PER_PAGINA * 4)
  return { filtri, ordine, pagina, ids }
}

/** I filtri come parametri dell'URL (l'inverso di leggiFiltri), più quelli in `extra`. */
export function inParametri(f: FiltriContatti, extra: Record<string, string | undefined> = {}): URLSearchParams {
  const q = new URLSearchParams()
  const metti = (k: string, v: string | number | undefined) => {
    if (v !== undefined && v !== '') q.set(k, String(v))
  }
  metti('q', f.q)
  metti('ab', f.ab)
  metti('abg', f.ab && f.ab !== 'attivo' && f.ab !== 'mai' ? f.abg : undefined)
  metti('gr', f.gr)
  metti('ac', f.ac)
  metti('acg', f.ac && f.ac !== 'mai' ? f.acg : undefined)
  metti('ld', f.ld)
  metti('ldg', f.ld === 'ferma' ? f.ldg : undefined)
  metti('lda', f.lda)
  metti('ass', f.ass)
  metti('cm', f.cm)
  if (f.rs) q.set('rs', '1')
  if (f.em) q.set('em', '1')
  if (f.ce) q.set('ce', '1')
  metti('eta_da', f.etaDa)
  metti('eta_a', f.etaA)
  metti('sx', f.sx)
  metti('cp', f.cp)
  for (const [k, v] of Object.entries(extra)) metti(k, v)
  return q
}

/** I filtri nel formato che si aspetta `contatti_filtrati` (jsonb). */
export function inJson(f: FiltriContatti, ids: string[] = []): Record<string, unknown> {
  const j: Record<string, unknown> = {}
  if (f.q) j.q = f.q
  if (f.ab) j.ab = f.ab
  if (f.abg) j.ab_giorni = f.abg
  if (f.gr) j.gruppo = f.gr
  if (f.ac) j.ac = f.ac
  if (f.acg) j.ac_giorni = f.acg
  if (f.ld) j.ld = f.ld
  if (f.ldg) j.ld_giorni = f.ldg
  if (f.lda) j.lead_da = f.lda
  if (f.ass) j.ass = f.ass
  if (f.cm) j.cm = f.cm
  if (f.rs) j.rs = true
  if (f.em) j.em = true
  if (f.ce) j.ce = true
  if (f.etaDa !== undefined) j.eta_da = f.etaDa
  if (f.etaA !== undefined) j.eta_a = f.etaA
  if (f.sx) j.sesso = f.sx
  if (f.cp) j.compleanno = f.cp
  if (ids.length > 0) j.ids = ids
  return j
}

export function numeroFiltri(f: FiltriContatti): number {
  return Object.keys(inJson(f)).filter((k) => !['ab_giorni', 'ac_giorni', 'ld_giorni'].includes(k)).length
}

// ─────────────────────────────────────────────────────────── etichette

export const ETICHETTE_AB: Record<Ab, string> = {
  attivo: 'Con abbonamento attivo',
  scade: 'Abbonamento in scadenza',
  scaduto: 'Scaduto da poco',
  ex: 'Scaduto da più tempo',
  mai: 'Mai abbonato',
}
export const ETICHETTE_AC: Record<Ac, string> = {
  inattivo: 'Non entra da un po’',
  recente: 'È entrato di recente',
  mai: 'Non è mai entrato',
}
export const ETICHETTE_LD: Record<Ld, string> = {
  qualsiasi: 'Qualsiasi lead',
  nessuno: 'Nessun lead',
  non_contattato: 'Lead non contattati',
  aperto: 'Lead aperti',
  da_prendere: 'Da prendere in carico',
  in_gestione: 'In gestione',
  ferma: 'In gestione, ferma da un po’',
  vinto: 'Lead vinti',
  perso: 'Lead persi',
}
export const ETICHETTE_CM: Record<Cm, string> = {
  valido: 'Certificato valido',
  scaduto: 'Certificato scaduto',
  assente: 'Nessun certificato',
  non_valido: 'Certificato scaduto o mancante',
}
export const ETICHETTE_ORDINE: Record<Ordine, string> = {
  cognome: 'Cognome',
  accesso_vecchio: 'Non entra da più tempo',
  accesso_recente: 'Entrato più di recente',
  scadenza_vicina: 'Scadenza più vicina',
  scadenza_recente: 'Scaduto più di recente',
  lead_recente: 'Lead più recente',
}

export const giorni = (n: number) => `${n} ${n === 1 ? 'giorno' : 'giorni'}`

/** Ogni filtro attivo come una frase corta, con i parametri da togliere per spegnerlo. */
export function descriviFiltri(
  f: FiltriContatti,
  nomi: { gruppi: Record<string, string>; staff: Record<string, string> }
): { etichetta: string; togli: string[] }[] {
  const v: { etichetta: string; togli: string[] }[] = []
  if (f.q) v.push({ etichetta: `Testo «${f.q}»`, togli: ['q'] })
  if (f.ab) {
    const g = f.abg ?? 30
    const base =
      f.ab === 'scade'
        ? `Abbonamento in scadenza entro ${giorni(g)}`
        : f.ab === 'scaduto'
          ? `Scaduto da meno di ${giorni(g)}`
          : f.ab === 'ex'
            ? `Scaduto da più di ${giorni(g)}`
            : ETICHETTE_AB[f.ab]
    v.push({ etichetta: f.gr ? `${base} · ${nomi.gruppi[f.gr] ?? 'gruppo'}` : base, togli: ['ab', 'abg', 'gr'] })
  } else if (f.gr) {
    v.push({ etichetta: `Gruppo ${nomi.gruppi[f.gr] ?? ''}`.trim(), togli: ['gr'] })
  }
  if (f.ac) v.push({ etichetta: f.ac === 'mai' ? ETICHETTE_AC.mai : `${ETICHETTE_AC[f.ac]}: ${giorni(f.acg ?? 30)}`, togli: ['ac', 'acg'] })
  if (f.ld) v.push({ etichetta: f.ld === 'ferma' ? `In gestione, senza novità da ${giorni(f.ldg ?? 14)}` : ETICHETTE_LD[f.ld], togli: ['ld', 'ldg'] })
  if (f.lda) v.push({ etichetta: `Lead degli ultimi ${giorni(f.lda)}`, togli: ['lda'] })
  if (f.ass) v.push({ etichetta: f.ass === NESSUN_ASSEGNATARIO ? 'Lead senza assegnatario' : `Lead di ${nomi.staff[f.ass] ?? f.ass}`, togli: ['ass'] })
  if (f.cm) v.push({ etichetta: ETICHETTE_CM[f.cm], togli: ['cm'] })
  if (f.rs) v.push({ etichetta: 'Con rate scadute', togli: ['rs'] })
  if (f.em) v.push({ etichetta: 'Con email', togli: ['em'] })
  if (f.ce) v.push({ etichetta: 'Con cellulare', togli: ['ce'] })
  if (f.etaDa !== undefined || f.etaA !== undefined) {
    const t = f.etaDa !== undefined && f.etaA !== undefined ? `${f.etaDa}–${f.etaA} anni` : f.etaDa !== undefined ? `da ${f.etaDa} anni` : `fino a ${f.etaA} anni`
    v.push({ etichetta: `Età ${t}`, togli: ['eta_da', 'eta_a'] })
  }
  if (f.sx) v.push({ etichetta: f.sx === 'M' ? 'Uomini' : 'Donne', togli: ['sx'] })
  if (f.cp) v.push({ etichetta: `Compleanno entro ${giorni(f.cp)}`, togli: ['cp'] })
  return v
}

// ─────────────────────────────────────────────────────── scelte rapide

/** Le liste che servono più spesso, a un clic. */
export const SCELTE_RAPIDE: { chiave: string; etichetta: string; nota: string; parametri: Record<string, string> }[] = [
  { chiave: 'attivi', etichetta: 'Abbonamento attivo', nota: 'Chi ha un abbonamento in corso.', parametri: { ab: 'attivo' } },
  { chiave: 'scaduti', etichetta: 'Scaduti da poco', nota: 'Senza abbonamento attivo, scaduto negli ultimi 30 giorni: da richiamare per il rinnovo.', parametri: { ab: 'scaduto', abg: '30', ord: 'scadenza_recente' } },
  { chiave: 'in-scadenza', etichetta: 'In scadenza', nota: 'L’abbonamento finisce entro 30 giorni.', parametri: { ab: 'scade', abg: '30', ord: 'scadenza_vicina' } },
  { chiave: 'non-vengono', etichetta: 'Attivi che non vengono', nota: 'Abbonamento in corso ma nessun ingresso da 30 giorni: i primi a disdire.', parametri: { ab: 'attivo', ac: 'inattivo', acg: '30', ord: 'accesso_vecchio' } },
  { chiave: 'ex-soci', etichetta: 'Ex soci', nota: 'Scaduti da più di un anno, senza un abbonamento attivo.', parametri: { ab: 'ex', abg: '365', ord: 'scadenza_recente' } },
  { chiave: 'lead-non-contattati', etichetta: 'Lead non contattati', nota: 'Trattative ancora da prendere in carico o richieste non lavorate.', parametri: { ld: 'non_contattato', ord: 'lead_recente' } },
  { chiave: 'lead-7', etichetta: 'Lead degli ultimi 7 giorni', nota: 'Lead nati nell’ultima settimana.', parametri: { lda: '7', ord: 'lead_recente' } },
  { chiave: 'lead-fermi', etichetta: 'Lead fermi', nota: 'In gestione ma senza novità da 14 giorni.', parametri: { ld: 'ferma', ldg: '14', ord: 'lead_recente' } },
  { chiave: 'senza-certificato', etichetta: 'Senza certificato valido', nota: 'Abbonamento attivo ma certificato medico scaduto o mancante.', parametri: { ab: 'attivo', cm: 'non_valido' } },
  { chiave: 'rate-scadute', etichetta: 'Rate scadute', nota: 'Con almeno una rata non pagata e già scaduta.', parametri: { rs: '1' } },
  { chiave: 'compleanni', etichetta: 'Compleanni', nota: 'Compiono gli anni nei prossimi 7 giorni.', parametri: { cp: '7' } },
]
