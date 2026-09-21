import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { caricaGruppi } from '@/lib/abbonamenti'
import { dataBreve as dataBreveAnno } from '@/lib/persone'
import { etichettaMese, mesePiu, oggiRoma, primoDelMese } from '@/lib/agenda'

export const dynamic = 'force-dynamic'

type RigaScadenza = {
  id: string
  persona_id: string | null
  abbonamento: string | null
  gruppo_id: string | null
  data_fine: string
  nome: string | null
  cognome: string | null
  email: string | null
  cellulare: string | null
  rinnovato: boolean
}

export default async function ScadenzeAbbonamentiPage({
  searchParams,
}: {
  searchParams: { mese?: string; gruppi?: string }
}) {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  const meseRichiesto = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.mese ?? '')
    ? primoDelMese(searchParams.mese!)
    : primoDelMese(oggiRoma())

  const gruppi = await caricaGruppi()
  const gruppiValidi = new Set(gruppi.map((g) => g.id))
  const gruppiSelezionati = (searchParams.gruppi ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((id) => gruppiValidi.has(id))
  const filtroAttivo = gruppiSelezionati.length > 0

  const supabase = createSupabaseServiceClient()

  // PostgREST tronca comunque una select a 1000 righe, `.limit()` chiesto
  // dal client o no — e un mese di punta (settembre, oltre 1500 scadenze)
  // lo supera per davvero, non è un'ipotesi. Si pagina a mano con
  // `.range()` finché una pagina torna piena, con un tetto largo (10.000)
  // come difesa contro un mese fuori scala, non come limite atteso.
  const righeGrezze: RigaScadenza[] = []
  let erroreScadenze: { message: string } | null = null
  for (let da = 0; da < 10000; da += 1000) {
    // Prima chi non ha ancora rinnovato (l'elenco d'azione per la
    // segreteria), poi per scadenza più vicina, poi per id — un ordine
    // stabile è necessario perché `.range()` dia pagine coerenti fra loro,
    // non solo un ordine leggibile.
    let query = supabase
      .from('abbonamenti_scadenze')
      .select('id, persona_id, abbonamento, gruppo_id, data_fine, nome, cognome, email, cellulare, rinnovato')
      .gte('data_fine', meseRichiesto)
      .lt('data_fine', mesePiu(meseRichiesto, 1))
      .order('rinnovato', { ascending: true })
      .order('data_fine', { ascending: true })
      .order('id', { ascending: true })
      .range(da, da + 999)
    if (filtroAttivo) query = query.in('gruppo_id', gruppiSelezionati)
    const { data, error } = await query
    if (error) {
      erroreScadenze = error
      break
    }
    righeGrezze.push(...((data ?? []) as RigaScadenza[]))
    if (!data || data.length < 1000) break
  }
  const righe = righeGrezze

  const nomeGruppo = new Map(gruppi.map((g) => [g.id, g.nome]))
  const totale = righe.length
  const daRichiamare = righe.filter((r) => !r.rinnovato).length

  function hrefMese(m: string) {
    const params = new URLSearchParams({ mese: m })
    if (filtroAttivo) params.set('gruppi', gruppiSelezionati.join(','))
    return `/dashboard/abbonamenti/scadenze?${params.toString()}`
  }

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Abbonamenti</p>
        <h1>Abbonamenti in scadenza</h1>
        <p className="muted">
          {totale} in scadenza in {etichettaMese(meseRichiesto)}
          {totale > 0 && ` — ${daRichiamare} da richiamare, ${totale - daRichiamare} già rinnovati`}.
        </p>
        <Link href="/dashboard/abbonamenti" className="muted">
          ← Torna ad Abbonamenti
        </Link>
      </div>

      <div className="report-mese-nav">
        <Link href={hrefMese(mesePiu(meseRichiesto, -1))} className="btn btn-ghost btn-sm">
          ← Mese prec.
        </Link>
        <span className="report-mese-titolo">{etichettaMese(meseRichiesto)}</span>
        <Link href={hrefMese(mesePiu(meseRichiesto, 1))} className="btn btn-ghost btn-sm">
          Mese succ. →
        </Link>
      </div>

      {erroreScadenze && /abbonamenti_scadenze/.test(erroreScadenze.message) ? (
        <div className="card">
          <p className="vuoto">
            Manca la vista delle scadenze: esegui scripts/sql/2026-09-21-abbonamenti-scadenze.sql nel SQL Editor di
            Supabase.
          </p>
        </div>
      ) : righe.length === 0 ? (
        <div className="card">
          <p className="vuoto">
            Nessun abbonamento in scadenza in questo mese{filtroAttivo ? ' per i gruppi selezionati' : ''}.
          </p>
        </div>
      ) : (
        <div className="card">
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Prodotto</th>
                  <th>Gruppo</th>
                  <th>Scadenza</th>
                  <th>Rinnovo</th>
                </tr>
              </thead>
              <tbody>
                {righe.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.persona_id ? (
                        <Link href={`/dashboard/persone/${r.persona_id}`}>
                          {r.cognome} {r.nome}
                        </Link>
                      ) : (
                        '—'
                      )}
                      {(r.cellulare || r.email) && (
                        <div className="muted" style={{ fontSize: 'var(--text-2xs)' }}>
                          {r.cellulare || r.email}
                        </div>
                      )}
                    </td>
                    <td>{r.abbonamento ?? '—'}</td>
                    <td>{r.gruppo_id ? (nomeGruppo.get(r.gruppo_id) ?? '—') : 'Non categorizzato'}</td>
                    <td>{dataBreveAnno(r.data_fine)}</td>
                    <td>
                      {r.rinnovato ? (
                        <span className="badge badge-ok">Rinnovato</span>
                      ) : (
                        <span className="badge badge-warn">Da richiamare</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
