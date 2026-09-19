import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { caricaGruppi, NON_CATEGORIZZATO } from '@/lib/abbonamenti'
import { caricaDateAzioniDesk } from '@/lib/percorsoVendita-server'
import { eLavorata } from '@/lib/percorsoVendita'
import { euro } from '@/lib/pipeline'
import {
  etichettaMese,
  giornoPiu,
  giorniDelMese,
  mesePiu,
  mezzanotteRoma,
  oggiRoma,
  primoDelMese,
  ultimoDelMese,
} from '@/lib/agenda'

export const dynamic = 'force-dynamic'

// Una cella per gruppo, dentro la riga di un giorno: quanti abbonamenti di
// quel gruppo sono stati venduti quel giorno.
type RigaGiorno = { data: string; perGruppo: Map<string, number>; fatturato: number }

type RigaGrezza = { data_vendita: string; abbonamento: string | null; totale: number | null; persona_id: string | null }

const FILTRI_LAVORATE = ['tutte', 'si', 'no'] as const
type FiltroLavorate = (typeof FILTRI_LAVORATE)[number]

const ETICHETTE_FILTRO: Record<FiltroLavorate, string> = {
  tutte: 'Tutte',
  si: 'Lavorate',
  no: 'Non lavorate',
}

// La vendita alla sua data di calendario a Roma: `data_vendita` è un
// istante (timestamptz), e affettarne la stringa ISO com'è darebbe la data
// UTC — sfasata di un giorno vicino alla mezzanotte rispetto a `giorni`,
// che sono date locali (vedi lib/agenda.ts, giorniDelMese).
function giornoRoma(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
}

export default async function ReportAbbonamentiPage({
  searchParams,
}: {
  searchParams: { mese?: string; lavorate?: string }
}) {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  const oggi = oggiRoma()
  const meseRichiesto = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.mese ?? '')
    ? primoDelMese(searchParams.mese!)
    : primoDelMese(oggi)
  const primo = meseRichiesto
  const ultimo = ultimoDelMese(meseRichiesto)
  const giorni = giorniDelMese(meseRichiesto)
  const filtro: FiltroLavorate = (FILTRI_LAVORATE as readonly string[]).includes(searchParams.lavorate ?? '')
    ? (searchParams.lavorate as FiltroLavorate)
    : 'tutte'

  const supabase = createSupabaseServiceClient()
  const [gruppi, { data: mappatura, error: erroreMappatura }, { data: righeMese }] = await Promise.all([
    caricaGruppi(),
    supabase.from('abbonamenti_mappatura').select('prodotto, gruppo_id'),
    // Righe grezze e non la vista aggregata `abbonamenti_giornalieri`: qui
    // serve il persona_id riga per riga per classificare "lavorata o no", e
    // un mese resta poche centinaia/migliaia di righe — non l'intero
    // storico che ha reso necessarie le viste (vedi
    // lib/percorsoVendita-server.ts). Il limite è una difesa: il client
    // Supabase troncherebbe comunque a 1000 righe senza dirlo, e un mese di
    // punta non deve sparire in silenzio.
    supabase
      .from('abbonamenti')
      .select('data_vendita, abbonamento, totale, persona_id')
      .gte('data_vendita', mezzanotteRoma(primo))
      .lt('data_vendita', mezzanotteRoma(giornoPiu(ultimo, 1)))
      .limit(5000),
  ])

  const righeGrezze = (righeMese ?? []) as RigaGrezza[]
  const gruppoDiProdotto = new Map((mappatura ?? []).map((m) => [m.prodotto as string, m.gruppo_id as string | null]))

  const dateAzioniMese = await caricaDateAzioniDesk(
    supabase,
    righeGrezze.map((r) => r.persona_id)
  )
  const eVenditaLavorata = (r: RigaGrezza) =>
    Boolean(r.persona_id) && eLavorata(r.data_vendita, dateAzioniMese.get(r.persona_id!) ?? [])

  const venditeLavorate = righeGrezze.filter(eVenditaLavorata).length
  const totaleVenditeDelMese = righeGrezze.length

  const righeFiltrate = filtro === 'tutte' ? righeGrezze : righeGrezze.filter((r) => (filtro === 'si') === eVenditaLavorata(r))

  const righe = new Map<string, RigaGiorno>(
    giorni.map((g) => [g, { data: g, perGruppo: new Map(), fatturato: 0 }])
  )

  let contaNonCategorizzato = false

  for (const r of righeFiltrate) {
    const riga = righe.get(giornoRoma(r.data_vendita))
    if (!riga) continue
    const chiave = gruppoDiProdotto.get(r.abbonamento ?? '') ?? NON_CATEGORIZZATO
    if (chiave === NON_CATEGORIZZATO) contaNonCategorizzato = true
    riga.perGruppo.set(chiave, (riga.perGruppo.get(chiave) ?? 0) + 1)
    riga.fatturato += Number(r.totale ?? 0)
  }

  const colonneGruppo: { chiave: string; nome: string }[] = gruppi.map((g) => ({ chiave: g.id, nome: g.nome }))
  if (contaNonCategorizzato) colonneGruppo.push({ chiave: NON_CATEGORIZZATO, nome: 'Non categorizzato' })

  const righeOrdinate = giorni.map((g) => righe.get(g)!)

  const totaleMese = righeOrdinate.reduce((s, r) => s + r.fatturato, 0)
  const venditeMese = righeOrdinate.reduce(
    (s, r) => s + Array.from(r.perGruppo.values()).reduce((a, b) => a + b, 0),
    0
  )

  function hrefFiltro(f: FiltroLavorate) {
    const params = new URLSearchParams({ mese: meseRichiesto })
    if (f !== 'tutte') params.set('lavorate', f)
    return `/dashboard/abbonamenti/report?${params.toString()}`
  }

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Abbonamenti</p>
        <h1>Report giornaliero</h1>
        <p className="muted">
          Abbonamenti venduti giorno per giorno, divisi per gruppo prodotto. {venditeMese} vendite,{' '}
          {euro(totaleMese)} di fatturato in {etichettaMese(meseRichiesto)}.
        </p>
        {totaleVenditeDelMese > 0 && (
          <p className="muted">
            <span className="badge badge-info">Lavorate</span> {venditeLavorate} di {totaleVenditeDelMese} vendite
            avevano almeno un contatto della segreteria nei 30 giorni prima dell&apos;acquisto — {Math.round((venditeLavorate / totaleVenditeDelMese) * 100)}%.
          </p>
        )}
        <Link href="/dashboard/abbonamenti" className="muted">
          ← Torna ad Abbonamenti
        </Link>
      </div>

      <div className="report-mese-nav">
        <Link href={`/dashboard/abbonamenti/report?mese=${mesePiu(meseRichiesto, -1)}`} className="btn btn-ghost btn-sm">
          ← Mese prec.
        </Link>
        <span className="report-mese-titolo">{etichettaMese(meseRichiesto)}</span>
        <Link href={`/dashboard/abbonamenti/report?mese=${mesePiu(meseRichiesto, 1)}`} className="btn btn-ghost btn-sm">
          Mese succ. →
        </Link>
      </div>

      <div className="filtri">
        <p className="filtri-titolo">Storia commerciale</p>
        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
            {FILTRI_LAVORATE.map((f) => (
              <Link key={f} href={hrefFiltro(f)} className={`chip${filtro === f ? ' is-attivo' : ''}`}>
                {ETICHETTE_FILTRO[f]}
              </Link>
            ))}
          </fieldset>
        </div>
      </div>

      {erroreMappatura && /abbonamenti_mappatura/.test(erroreMappatura.message) ? (
        <div className="card">
          <p className="vuoto">
            Manca la vista di reportistica: esegui scripts/sql/2026-09-18-abbonamenti-gruppi.sql nel SQL Editor di
            Supabase.
          </p>
        </div>
      ) : colonneGruppo.length === 0 ? (
        <div className="card">
          <p className="vuoto">
            Nessun gruppo prodotto creato ancora.{' '}
            <Link href="/dashboard/abbonamenti/gruppi">Crea i gruppi</Link> per vedere il report diviso per
            categoria.
          </p>
        </div>
      ) : (
        <div className="card">
          <div className="tabella-wrap">
            <table className="tabella tabella-report">
              <thead>
                <tr>
                  <th>Giorno</th>
                  {colonneGruppo.map((c) => (
                    <th key={c.chiave}>{c.nome}</th>
                  ))}
                  <th>Totale vendite</th>
                  <th>Fatturato</th>
                </tr>
              </thead>
              <tbody>
                {righeOrdinate.map((r) => {
                  const eOggi = r.data === oggi
                  const totaleGiorno = Array.from(r.perGruppo.values()).reduce((a, b) => a + b, 0)
                  return (
                    <tr key={r.data} className={eOggi ? 'is-oggi' : ''}>
                      <td>{r.data.slice(8, 10)}/{r.data.slice(5, 7)}</td>
                      {colonneGruppo.map((c) => (
                        <td key={c.chiave}>{r.perGruppo.get(c.chiave) || '—'}</td>
                      ))}
                      <td>{totaleGiorno || '—'}</td>
                      <td>{r.fatturato ? euro(r.fatturato) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
