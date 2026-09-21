import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { caricaGruppi } from '@/lib/abbonamenti'
import { euro, variazionePercentuale } from '@/lib/pipeline'
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
  searchParams: { gruppo?: string }
}) {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  const oggi = oggiRoma()
  const annoCorrente = Number(oggi.slice(0, 4))
  const meseCorrente = Number(oggi.slice(5, 7))
  const anni = Array.from({ length: ANNI_INDIETRO + 1 }, (_, i) => annoCorrente - ANNI_INDIETRO + i)
  const primoAnno = `${anni[0]}-01-01`

  const gruppi = await caricaGruppi()
  const gruppoRichiesto = gruppi.some((g) => g.id === searchParams.gruppo) ? searchParams.gruppo! : TUTTI

  const supabase = createSupabaseServiceClient()
  const query = supabase
    .from('abbonamenti_mensili')
    .select('mese, gruppo_id, numero_vendite, fatturato')
    .gte('mese', primoAnno)
  const { data: righeGrezze, error: erroreVista } =
    gruppoRichiesto === TUTTI ? await query : await query.eq('gruppo_id', gruppoRichiesto)

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
        <p className="filtri-titolo">Gruppo</p>
        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
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
                    ultimoAnno && annoPrecedente
                      ? variazionePercentuale(ultimoAnno.fatturato, annoPrecedente.fatturato)
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
