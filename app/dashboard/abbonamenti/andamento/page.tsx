import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { caricaGruppi, caricaMacroSettori } from '@/lib/abbonamenti'
import { euro } from '@/lib/pipeline'
import { oggiRoma } from '@/lib/agenda'

export const dynamic = 'force-dynamic'

const TUTTI = 'tutti'
const MESI = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
]
// Quanti anni indietro confrontare, oltre a quello corrente: 2 anni prima
// bastano per vedere un trend senza allungare troppo la tabella (ogni anno
// in più aggiunge due colonne).
const ANNI_INDIETRO = 2

export default async function AndamentoAbbonamentiPage({
  searchParams,
}: {
  searchParams: { gruppo?: string; macroSettore?: string }
}) {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  const oggi = oggiRoma()
  const annoCorrente = Number(oggi.slice(0, 4))
  const meseCorrente = Number(oggi.slice(5, 7))
  const anni = Array.from({ length: ANNI_INDIETRO + 1 }, (_, i) => annoCorrente - ANNI_INDIETRO + i)
  const primoAnno = `${anni[0]}-01-01`

  const [gruppi, macroSettori] = await Promise.all([caricaGruppi(), caricaMacroSettori()])
  const gruppoRichiesto = gruppi.some((g) => g.id === searchParams.gruppo) ? searchParams.gruppo! : TUTTI
  // Il macro settore conta solo se non è già selezionato un gruppo specifico
  // (più preciso): i due filtri sono alternativi, non si combinano.
  const macroSettoreRichiesto =
    gruppoRichiesto === TUTTI && macroSettori.some((m) => m.id === searchParams.macroSettore)
      ? searchParams.macroSettore!
      : null
  const gruppiDelMacroSettore = macroSettoreRichiesto
    ? gruppi.filter((g) => g.macro_settore_id === macroSettoreRichiesto).map((g) => g.id)
    : null

  const supabase = createSupabaseServiceClient()
  let righeGrezze: { mese: string; gruppo_id: string | null; numero_vendite: number; fatturato: number | null }[] | null =
    []
  let erroreVista: { message: string } | null = null

  if (macroSettoreRichiesto && gruppiDelMacroSettore && gruppiDelMacroSettore.length === 0) {
    // Nessun gruppo assegnato a questo macro settore ancora: niente da
    // interrogare, la tabella uscirà vuota senza mandare una query inutile.
  } else {
    let query = supabase
      .from('abbonamenti_mensili')
      .select('mese, gruppo_id, numero_vendite, fatturato')
      .gte('mese', primoAnno)
    if (gruppoRichiesto !== TUTTI) query = query.eq('gruppo_id', gruppoRichiesto)
    else if (gruppiDelMacroSettore) query = query.in('gruppo_id', gruppiDelMacroSettore)
    const risposta = await query
    righeGrezze = risposta.data
    erroreVista = risposta.error
  }

  // Chiave "anno-mese numerico" (es. "2026-9") per non confondere mesi di
  // anni diversi che condividono lo stesso numero.
  const datiPerMese = new Map<string, { vendite: number; fatturato: number }>()
  for (const r of righeGrezze ?? []) {
    const anno = Number(r.mese.slice(0, 4))
    const mese = Number(r.mese.slice(5, 7))
    const chiave = `${anno}-${mese}`
    const voce = datiPerMese.get(chiave) ?? { vendite: 0, fatturato: 0 }
    voce.vendite += r.numero_vendite
    voce.fatturato += Number(r.fatturato ?? 0)
    datiPerMese.set(chiave, voce)
  }

  function link(gruppo: string) {
    const params = new URLSearchParams()
    if (gruppo !== TUTTI) params.set('gruppo', gruppo)
    const query = params.toString()
    return `/dashboard/abbonamenti/andamento${query ? `?${query}` : ''}`
  }

  function linkMacro(macroSettore: string) {
    const params = new URLSearchParams()
    if (macroSettore !== TUTTI) params.set('macroSettore', macroSettore)
    const query = params.toString()
    return `/dashboard/abbonamenti/andamento${query ? `?${query}` : ''}`
  }

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Abbonamenti</p>
        <h1>Andamento mensile</h1>
        <p className="muted">
          Vendite e fatturato mese per mese, per confrontare l&apos;anno in corso con i precedenti — la riga del
          mese in corso è parziale, aggiornata a oggi.
        </p>
        <Link href="/dashboard/abbonamenti" className="muted">
          ← Torna ad Abbonamenti
        </Link>
      </div>

      <div className="filtri">
        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
            <legend>Macro settore</legend>
            <Link href={linkMacro(TUTTI)} className={`chip${!macroSettoreRichiesto ? ' is-attivo' : ''}`}>
              Tutti
            </Link>
            {macroSettori.map((m) => (
              <Link
                key={m.id}
                href={linkMacro(m.id)}
                className={`chip${macroSettoreRichiesto === m.id ? ' is-attivo' : ''}`}
              >
                {m.nome}
              </Link>
            ))}
          </fieldset>
          <fieldset className="filtro-gruppo">
            <legend>Gruppo</legend>
            <Link href={link(TUTTI)} className={`chip${gruppoRichiesto === TUTTI ? ' is-attivo' : ''}`}>
              Tutti
            </Link>
            {gruppi.map((g) => (
              <Link key={g.id} href={link(g.id)} className={`chip${gruppoRichiesto === g.id ? ' is-attivo' : ''}`}>
                {g.nome}
              </Link>
            ))}
          </fieldset>
        </div>
      </div>

      {erroreVista && /abbonamenti_mensili/.test(erroreVista.message) ? (
        <div className="card">
          <p className="vuoto">
            Manca la vista di reportistica: esegui scripts/sql/2026-09-18-abbonamenti-gruppi.sql nel SQL Editor di
            Supabase.
          </p>
        </div>
      ) : (
        <div className="card">
          <div className="tabella-wrap">
            <table className="tabella tabella-report">
              <thead>
                <tr>
                  <th>Mese</th>
                  {anni.map((anno) => (
                    <th key={`${anno}-v`}>{anno} · Vendite</th>
                  ))}
                  {anni.map((anno) => (
                    <th key={`${anno}-f`}>{anno} · Fatturato</th>
                  ))}
                  <th>Var. fatturato vs anno prec.</th>
                </tr>
              </thead>
              <tbody>
                {MESI.map((nomeMese, indice) => {
                  const numeroMese = indice + 1
                  const eMeseInCorso = annoCorrente === anni[anni.length - 1] && numeroMese === meseCorrente
                  const nelFuturo = anni[anni.length - 1] === annoCorrente && numeroMese > meseCorrente
                  const perAnno = anni.map((anno) => datiPerMese.get(`${anno}-${numeroMese}`))
                  const ultimoAnno = perAnno[perAnno.length - 1]
                  const annoPrecedente = perAnno[perAnno.length - 2]
                  const variazione =
                    ultimoAnno && annoPrecedente && annoPrecedente.fatturato > 0
                      ? Math.round(((ultimoAnno.fatturato - annoPrecedente.fatturato) / annoPrecedente.fatturato) * 100)
                      : null

                  return (
                    <tr key={numeroMese} className={eMeseInCorso ? 'is-oggi' : ''}>
                      <td>
                        {nomeMese}
                        {eMeseInCorso && <span className="muted"> (in corso)</span>}
                      </td>
                      {perAnno.map((v, i) => (
                        <td key={`v-${i}`}>{nelFuturo && i === perAnno.length - 1 ? '—' : v?.vendite || '—'}</td>
                      ))}
                      {perAnno.map((v, i) => (
                        <td key={`f-${i}`}>
                          {nelFuturo && i === perAnno.length - 1 ? '—' : v?.fatturato ? euro(v.fatturato) : '—'}
                        </td>
                      ))}
                      <td>{variazione === null ? '—' : `${variazione > 0 ? '+' : ''}${variazione}%`}</td>
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
