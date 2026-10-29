import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { giornoPiu, mezzanotteRoma } from '@/lib/agenda'
import { caricaGruppi } from '@/lib/abbonamenti'
import { STATISTICHE_VUOTE, type Statistiche } from '@/lib/analytics'
import { canaleGranulare } from '@/lib/canaliTraffico'
import { provenienzaDiOrigine } from '@/lib/provenienza'
import { nomeTipo } from '@/lib/incassato'
import {
  GIORNI_SETTIMANA,
  ETICHETTA_SENZA_GRUPPO,
  type Periodo,
} from '@/lib/accessi'
import {
  accessiPerVarco,
  caricaGruppiAccessi,
  caricaVarchi,
  mappaCalore,
  riepilogoAccessi,
  serieVisite,
} from '@/lib/accessi-server'
import {
  SEZIONI_REPORT,
  type Confronto,
  type ReportAccessi,
  type ReportDati,
  type ReportIncassi,
  type ReportIscritti,
  type ReportLead,
  type ReportScaduti,
  type ReportSoci,
  type SezioneReport,
  type VoceReport,
} from '@/lib/report'

// Le letture del report per periodo. Server-only: usa la service role key.
// Ogni sezione si legge dalla fonte della pagina da cui nasce (vedi
// lib/report.ts) e, dove serve il confronto, due volte: periodo e periodo
// precedente di pari durata. Le sezioni sono indipendenti e partono insieme.

type Db = ReturnType<typeof createSupabaseServiceClient>
type Intervallo = { dal: string; al: string }

const NON_CATEGORIZZATO = 'Non categorizzato'
const cent = (n: number) => Math.round(n * 100) / 100

const conf = (attuale: number, precedente: number | null): Confronto => ({ attuale, precedente })

async function rpc<T>(db: Db, funzione: string, argomenti: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(funzione, argomenti)
  if (error) {
    if (error.code === 'PGRST202' && /report_/.test(funzione)) {
      throw new Error('Manca lo script SQL del report: esegui scripts/sql/2026-10-29-report-periodo.sql nel SQL Editor di Supabase.')
    }
    throw new Error(`Report, ${funzione}: ${error.message}`)
  }
  return data as T
}

/** Le due letture (periodo e periodo precedente) di una sezione; il precedente è null se non c'è. */
async function ilDoppio<T>(periodo: Periodo, leggi: (i: Intervallo) => Promise<T>): Promise<[T, T | null]> {
  const [attuale, precedente] = await Promise.all([
    leggi({ dal: periodo.dal, al: periodo.al }),
    periodo.precedente ? leggi(periodo.precedente) : Promise.resolve(null),
  ])
  return [attuale, precedente]
}

// ─────────────────────────────────────────────────────────────────── lead

async function statisticheLead(db: Db, { dal, al }: Intervallo): Promise<Statistiche> {
  const data = await rpc<Statistiche | null>(db, 'statistiche_richieste', {
    p_da: mezzanotteRoma(dal),
    p_a: mezzanotteRoma(giornoPiu(al, 1)),
  })
  return data ?? STATISTICHE_VUOTE
}

function sommaPerEtichetta(voci: { etichetta: string; valore: number }[]): VoceReport[] {
  const mappa = new Map<string, number>()
  for (const v of voci) mappa.set(v.etichetta, (mappa.get(v.etichetta) ?? 0) + v.valore)
  return [...mappa.entries()].map(([etichetta, valore]) => ({ etichetta, valore })).sort((a, b) => b.valore - a.valore)
}

async function leggiLead(db: Db, periodo: Periodo): Promise<ReportLead> {
  const [[s, prec], primo] = await Promise.all([
    ilDoppio(periodo, (i) => statisticheLead(db, i)),
    db.from('form_contatti').select('created_at').order('created_at', { ascending: true }).limit(1),
  ])
  const primaRichiesta = primo.data?.[0]?.created_at as string | undefined
  return {
    richieste: conf(s.richieste, prec ? prec.richieste : null),
    lavorate: s.lavorate,
    conAppuntamento: s.con_appuntamento,
    personeNuove: s.persone_nuove,
    trattative: { aperte: s.trattative_aperte, vinte: s.trattative_vinte, perse: s.trattative_perse },
    perProvenienza: sommaPerEtichetta(
      s.coppie_utm.map((c) => ({ etichetta: provenienzaDiOrigine(c.origine).etichetta, valore: Number(c.richieste) }))
    ),
    perCanale: sommaPerEtichetta(s.coppie_utm.map((c) => ({ etichetta: canaleGranulare(c), valore: Number(c.richieste) }))),
    perInteresse: s.attivita.slice(0, 10).map((a) => ({ etichetta: a.voce, valore: Number(a.richieste) })),
    datiDal: primaRichiesta
      ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(primaRichiesta))
      : null,
  }
}

// ─────────────────────────────────────────────────────────────── iscritti

type RigaVendita = { gruppo_id: string | null; rinnovo: boolean; numero: number; fatturato: number }
type VenditeMese = { mese: string; rinnovo: boolean; numero: number; fatturato: number }

async function leggiIscritti(db: Db, periodo: Periodo, nomeGruppo: (id: string | null) => string): Promise<ReportIscritti> {
  const [v, prec] = await ilDoppio(periodo, (i) =>
    rpc<{ per_gruppo: RigaVendita[]; per_mese: VenditeMese[] }>(db, 'report_vendite', { p_dal: i.dal, p_al: i.al })
  )
  const totale = (righe: RigaVendita[], rinnovo: boolean, campo: 'numero' | 'fatturato') =>
    cent(righe.filter((r) => r.rinnovo === rinnovo).reduce((s, r) => s + Number(r[campo] ?? 0), 0))

  const perGruppo = new Map<string, { gruppo: string; nuove: number; rinnovi: number; fatturato: number }>()
  for (const r of v.per_gruppo) {
    const nome = nomeGruppo(r.gruppo_id)
    const voce = perGruppo.get(nome) ?? { gruppo: nome, nuove: 0, rinnovi: 0, fatturato: 0 }
    if (r.rinnovo) voce.rinnovi += Number(r.numero)
    else voce.nuove += Number(r.numero)
    voce.fatturato = cent(voce.fatturato + Number(r.fatturato ?? 0))
    perGruppo.set(nome, voce)
  }
  const perMese = new Map<string, { mese: string; nuove: number; rinnovi: number }>()
  for (const r of v.per_mese) {
    const voce = perMese.get(r.mese) ?? { mese: r.mese, nuove: 0, rinnovi: 0 }
    if (r.rinnovo) voce.rinnovi += Number(r.numero)
    else voce.nuove += Number(r.numero)
    perMese.set(r.mese, voce)
  }
  const p = prec?.per_gruppo
  return {
    nuove: conf(totale(v.per_gruppo, false, 'numero'), p ? totale(p, false, 'numero') : null),
    rinnovi: conf(totale(v.per_gruppo, true, 'numero'), p ? totale(p, true, 'numero') : null),
    fatturatoNuove: conf(totale(v.per_gruppo, false, 'fatturato'), p ? totale(p, false, 'fatturato') : null),
    fatturatoRinnovi: conf(totale(v.per_gruppo, true, 'fatturato'), p ? totale(p, true, 'fatturato') : null),
    perGruppo: [...perGruppo.values()].sort((a, b) => b.nuove + b.rinnovi - (a.nuove + a.rinnovi)),
    perMese: [...perMese.values()],
  }
}

// ──────────────────────────────────────────────────────────────────── soci

async function leggiSoci(db: Db, periodo: Periodo, nomeGruppo: (id: string | null) => string): Promise<ReportSoci> {
  // «A inizio periodo» è la sera prima: chi è attivo il giorno `dal` può
  // essere entrato proprio quel giorno, e allora sarebbe già una variazione.
  const prima = giornoPiu(periodo.dal, -1)
  const attivi = (data: string) =>
    rpc<{ gruppo_id: string | null; numero_attivi: number }[]>(db, 'abbonamenti_attivi_al', { p_data: data })
  const [inizio, fine] = await Promise.all([attivi(prima), attivi(periodo.al)])

  const perGruppo = new Map<string, { gruppo: string; inizio: number; fine: number }>()
  const aggiungi = (righe: { gruppo_id: string | null; numero_attivi: number }[], campo: 'inizio' | 'fine') => {
    for (const r of righe) {
      const nome = nomeGruppo(r.gruppo_id)
      const voce = perGruppo.get(nome) ?? { gruppo: nome, inizio: 0, fine: 0 }
      voce[campo] += Number(r.numero_attivi)
      perGruppo.set(nome, voce)
    }
  }
  aggiungi(inizio ?? [], 'inizio')
  aggiungi(fine ?? [], 'fine')
  const righe = [...perGruppo.values()].sort((a, b) => b.fine - a.fine)
  return {
    inizio: { data: prima, totale: righe.reduce((s, r) => s + r.inizio, 0) },
    fine: { data: periodo.al, totale: righe.reduce((s, r) => s + r.fine, 0) },
    perGruppo: righe,
  }
}

// ───────────────────────────────────────────────────────────────── scaduti

type RigaScadenza = { gruppo_id: string | null; rinnovato: boolean; numero: number; valore: number }
type ScadenzeMese = { mese: string; rinnovato: boolean; numero: number; valore: number }

async function leggiScaduti(db: Db, periodo: Periodo, nomeGruppo: (id: string | null) => string): Promise<ReportScaduti> {
  const [s, prec] = await ilDoppio(periodo, (i) =>
    rpc<{ per_gruppo: RigaScadenza[]; per_mese: ScadenzeMese[] }>(db, 'report_scadenze', { p_dal: i.dal, p_al: i.al })
  )
  const conta = (righe: RigaScadenza[], soloRinnovati: boolean | null) =>
    righe.filter((r) => soloRinnovati === null || r.rinnovato === soloRinnovati).reduce((t, r) => t + Number(r.numero), 0)
  const valoreNon = (righe: RigaScadenza[]) => cent(righe.filter((r) => !r.rinnovato).reduce((t, r) => t + Number(r.valore ?? 0), 0))
  const tasso = (righe: RigaScadenza[]) => {
    const tot = conta(righe, null)
    return tot > 0 ? Math.round((conta(righe, true) / tot) * 1000) / 10 : 0
  }

  const perGruppo = new Map<string, { gruppo: string; scaduti: number; rinnovati: number }>()
  for (const r of s.per_gruppo) {
    const nome = nomeGruppo(r.gruppo_id)
    const voce = perGruppo.get(nome) ?? { gruppo: nome, scaduti: 0, rinnovati: 0 }
    voce.scaduti += Number(r.numero)
    if (r.rinnovato) voce.rinnovati += Number(r.numero)
    perGruppo.set(nome, voce)
  }
  const perMese = new Map<string, { mese: string; scaduti: number; rinnovati: number }>()
  for (const r of s.per_mese) {
    const voce = perMese.get(r.mese) ?? { mese: r.mese, scaduti: 0, rinnovati: 0 }
    voce.scaduti += Number(r.numero)
    if (r.rinnovato) voce.rinnovati += Number(r.numero)
    perMese.set(r.mese, voce)
  }
  const p = prec?.per_gruppo
  return {
    scaduti: conf(conta(s.per_gruppo, null), p ? conta(p, null) : null),
    rinnovati: conf(conta(s.per_gruppo, true), p ? conta(p, true) : null),
    tasso: conf(tasso(s.per_gruppo), p ? tasso(p) : null),
    valoreNonRinnovato: conf(valoreNon(s.per_gruppo), p ? valoreNon(p) : null),
    perGruppo: [...perGruppo.values()].sort((a, b) => b.scaduti - a.scaduti),
    perMese: [...perMese.values()],
  }
}

// ──────────────────────────────────────────────────────────────── incassi

type RigaIncasso = { movimenti: number; entrate: number; uscite: number; netto: number }
type IncassiGrezzi = {
  per_tipo: (RigaIncasso & { tipo_servizio: string })[]
  per_metodo: (RigaIncasso & { metodo_pagamento: string })[]
  per_mese: { mese: string; entrate: number; uscite: number; netto: number }[]
}

async function leggiIncassi(db: Db, periodo: Periodo): Promise<ReportIncassi> {
  const [i, prec] = await ilDoppio(periodo, (x) => rpc<IncassiGrezzi>(db, 'report_incassi', { p_dal: x.dal, p_al: x.al }))
  const somma = (g: IncassiGrezzi, campo: 'entrate' | 'uscite' | 'netto') => cent(g.per_tipo.reduce((t, r) => t + Number(r[campo] ?? 0), 0))
  const abbonamenti = (g: IncassiGrezzi) => cent(g.per_tipo.filter((r) => r.tipo_servizio === 'A').reduce((t, r) => t + Number(r.netto ?? 0), 0))
  return {
    netto: conf(somma(i, 'netto'), prec ? somma(prec, 'netto') : null),
    entrate: conf(somma(i, 'entrate'), prec ? somma(prec, 'entrate') : null),
    uscite: conf(somma(i, 'uscite'), prec ? somma(prec, 'uscite') : null),
    abbonamenti: conf(abbonamenti(i), prec ? abbonamenti(prec) : null),
    perTipo: i.per_tipo.map((r) => ({ tipo: nomeTipo(r.tipo_servizio), movimenti: Number(r.movimenti), netto: cent(Number(r.netto ?? 0)) })),
    perMetodo: i.per_metodo.map((r) => ({ metodo: r.metodo_pagamento, movimenti: Number(r.movimenti), netto: cent(Number(r.netto ?? 0)) })),
    perMese: i.per_mese.map((r) => ({ mese: r.mese, netto: cent(Number(r.netto ?? 0)) })),
  }
}

// ──────────────────────────────────────────────────────────────── accessi

async function leggiAccessi(db: Db, periodo: Periodo): Promise<ReportAccessi> {
  const passo = periodo.giorni <= 62 ? 'day' : 'month'
  const [gruppi, varchi, [r, prec], serie, calore] = await Promise.all([
    caricaGruppiAccessi(db),
    caricaVarchi(db),
    ilDoppio(periodo, (i) => riepilogoAccessi(db, i.dal, i.al)),
    serieVisite(db, periodo.dal, periodo.al, passo),
    mappaCalore(db, periodo.dal, periodo.al, null),
  ])
  const perVarco = await accessiPerVarco(db, periodo.dal, periodo.al, varchi)
  const nomeGruppoAccessi = new Map(gruppi.map((g) => [g.id, g.nome]))

  const peso = new Map<string, number>()
  for (const v of perVarco) {
    const nome = v.gruppoId ? nomeGruppoAccessi.get(v.gruppoId) ?? ETICHETTA_SENZA_GRUPPO : ETICHETTA_SENZA_GRUPPO
    peso.set(nome, (peso.get(nome) ?? 0) + v.passaggi)
  }
  const picco = calore.reduce<(typeof calore)[number] | null>(
    (m, c) => (!m || (c.giorni > 0 && c.passaggi / c.giorni > m.passaggi / Math.max(m.giorni, 1)) ? c : m),
    null
  )
  return {
    visite: conf(r.visite, prec ? prec.visite : null),
    persone: conf(r.persone, prec ? prec.persone : null),
    passaggi: conf(r.passaggi, prec ? prec.passaggi : null),
    negati: conf(r.negati, prec ? prec.negati : null),
    perGruppo: [...peso.entries()].map(([gruppo, passaggi]) => ({ gruppo, passaggi })).sort((a, b) => b.passaggi - a.passaggi),
    perVarco: perVarco
      .filter((v) => v.passaggi > 0)
      .slice(0, 12)
      .map((v) => ({
        varco: v.descrizione,
        gruppo: v.gruppoId ? nomeGruppoAccessi.get(v.gruppoId) ?? null : null,
        passaggi: v.passaggi,
      })),
    perPeriodo: serie.map((p) => ({ periodo: p.periodo, visite: p.visite })),
    passo,
    oraDiPunta:
      picco && picco.giorni > 0 && picco.passaggi > 0
        ? { giorno: GIORNI_SETTIMANA[picco.giornoSettimana - 1], ora: picco.ora, media: picco.passaggi / picco.giorni }
        : null,
  }
}

// ──────────────────────────────────────────────────────────────── insieme

/**
 * Tutto il report. `permessi` sono le sezioni del CRM dell'utente: ogni
 * sezione del report richiede quella da cui nasce (lead → direzione, incassi
 * → incassato...), e quelle senza permesso non si leggono — finiscono in
 * `nonConsentite`, così la pagina e il PDF lo dicono invece di tacerlo.
 */
export async function caricaReport(
  db: Db,
  periodo: Periodo,
  richieste: SezioneReport[],
  permessi: readonly string[],
  generatoDa: string | null
): Promise<ReportDati> {
  const consentite = richieste.filter((c) => permessi.includes(SEZIONI_REPORT.find((s) => s.chiave === c)!.richiede))
  const nonConsentite = richieste.filter((c) => !consentite.includes(c))
  const vuole = (c: SezioneReport) => consentite.includes(c)

  // I nomi dei gruppi prodotto servono a quattro sezioni: si leggono solo se ci sono.
  const gruppiProdotto = vuole('iscritti') || vuole('soci') || vuole('scaduti') ? await caricaGruppi() : []
  const nomi = new Map(gruppiProdotto.map((g) => [g.id as string, g.nome as string]))
  const nomeGruppo = (id: string | null) => (id ? nomi.get(id) ?? NON_CATEGORIZZATO : NON_CATEGORIZZATO)

  const [lead, iscritti, soci, scaduti, incassi, accessi] = await Promise.all([
    vuole('lead') ? leggiLead(db, periodo) : undefined,
    vuole('iscritti') ? leggiIscritti(db, periodo, nomeGruppo) : undefined,
    vuole('soci') ? leggiSoci(db, periodo, nomeGruppo) : undefined,
    vuole('scaduti') ? leggiScaduti(db, periodo, nomeGruppo) : undefined,
    vuole('incassi') ? leggiIncassi(db, periodo) : undefined,
    vuole('accessi') ? leggiAccessi(db, periodo) : undefined,
  ])

  return {
    periodo: { dal: periodo.dal, al: periodo.al, giorni: periodo.giorni, precedente: periodo.precedente },
    generato: { il: new Date().toISOString(), da: generatoDa },
    sezioni: richieste,
    nonConsentite,
    lead,
    iscritti,
    soci,
    scaduti,
    incassi,
    accessi,
  }
}
