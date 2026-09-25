import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { caricaGruppi } from '@/lib/abbonamenti'
import { etichettaMese, mesePiu, oggiRoma, primoDelMese } from '@/lib/agenda'
import { TabellaScadenze, type RigaScadenza } from './TabellaScadenze'

export const dynamic = 'force-dynamic'

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
      .select(
        'id, persona_id, abbonamento, gruppo_id, data_inizio, data_fine, totale, nome, cognome, email, cellulare, rinnovato, rinnovo_id, rinnovo_abbonamento, rinnovo_data_inizio, rinnovo_data_fine, rinnovo_totale, operatore_nome, in_trattativa, nota',
      )
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
          {totale > 0 && ` — ${daRichiamare} non ancora rinnovati, ${totale - daRichiamare} già rinnovati`}.
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
        <TabellaScadenze righe={righe} gruppi={gruppi} />
      )}
    </div>
  )
}
