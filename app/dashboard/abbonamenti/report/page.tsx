import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { caricaGruppi, NON_CATEGORIZZATO } from '@/lib/abbonamenti'
import { euro } from '@/lib/pipeline'
import {
  etichettaMese,
  giorniDelMese,
  mesePiu,
  oggiRoma,
  primoDelMese,
  ultimoDelMese,
} from '@/lib/agenda'

export const dynamic = 'force-dynamic'

// Una cella per gruppo, dentro la riga di un giorno: quanti abbonamenti di
// quel gruppo sono stati venduti quel giorno.
type RigaGiorno = { data: string; perGruppo: Map<string, number>; fatturato: number }

export default async function ReportAbbonamentiPage({
  searchParams,
}: {
  searchParams: { mese?: string }
}) {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  const oggi = oggiRoma()
  const meseRichiesto = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.mese ?? '')
    ? primoDelMese(searchParams.mese!)
    : primoDelMese(oggi)
  const primo = meseRichiesto
  const ultimo = ultimoDelMese(meseRichiesto)
  const giorni = giorniDelMese(meseRichiesto)

  const supabase = createSupabaseServiceClient()
  const [gruppi, { data: righeGrezze, error: erroreVista }] = await Promise.all([
    caricaGruppi(),
    supabase
      .from('abbonamenti_giornalieri')
      .select('giorno, gruppo_id, numero_vendite, fatturato')
      .gte('giorno', primo)
      .lte('giorno', ultimo),
  ])

  const righe = new Map<string, RigaGiorno>(
    giorni.map((g) => [g, { data: g, perGruppo: new Map(), fatturato: 0 }])
  )

  let contaNonCategorizzato = false

  for (const r of righeGrezze ?? []) {
    const riga = righe.get(r.giorno)
    if (!riga) continue
    const chiave = r.gruppo_id ?? NON_CATEGORIZZATO
    if (chiave === NON_CATEGORIZZATO) contaNonCategorizzato = true
    riga.perGruppo.set(chiave, (riga.perGruppo.get(chiave) ?? 0) + r.numero_vendite)
    riga.fatturato += Number(r.fatturato ?? 0)
  }

  const colonneGruppo: { chiave: string; nome: string }[] = gruppi.map((g) => ({ chiave: g.id, nome: g.nome }))
  if (contaNonCategorizzato) colonneGruppo.push({ chiave: NON_CATEGORIZZATO, nome: 'Non categorizzato' })

  const righeOrdinate = giorni.map((g) => righe.get(g)!)

  const totaleMese = righeOrdinate.reduce((s, r) => s + r.fatturato, 0)
  const venditeMese = righeOrdinate.reduce(
    (s, r) => s + Array.from(r.perGruppo.values()).reduce((a, b) => a + b, 0),
    0
  )

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Abbonamenti</p>
        <h1>Report giornaliero</h1>
        <p className="muted">
          Abbonamenti venduti giorno per giorno, divisi per gruppo prodotto. {venditeMese} vendite,{' '}
          {euro(totaleMese)} di fatturato in {etichettaMese(meseRichiesto)}.
        </p>
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

      {erroreVista && /abbonamenti_giornalieri/.test(erroreVista.message) ? (
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
