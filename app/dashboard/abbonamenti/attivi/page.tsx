import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { leggiPaginato } from '@/lib/supabase/leggiPaginato'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { caricaGruppi } from '@/lib/abbonamenti'
import { ElencoAttivi, type RigaAttivo } from './ElencoAttivi'

export const dynamic = 'force-dynamic'

// Il dettaglio dietro «Utenti attivi per gruppo, a oggi»: gli abbonamenti in
// corso, uno per riga, dalla vista abbonamenti_attivi_oggi_dettaglio (stessa
// definizione di attivo del riquadro, vedi
// scripts/sql/2026-10-01-abbonamenti-attivi-oggi-dettaglio.sql).

type RigaGrezza = Omit<RigaAttivo, 'gruppo'> & { gruppo_id: string | null }

export default async function AbbonamentiAttiviPage() {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  const supabase = createSupabaseServiceClient()
  const [gruppi, { righe, error }] = await Promise.all([
    caricaGruppi(),
    leggiPaginato<RigaGrezza>((da) =>
      supabase
        .from('abbonamenti_attivi_oggi_dettaglio')
        .select('id, persona_id, nome, cognome, email, cellulare, abbonamento, gruppo_id, data_inizio, data_fine, totale')
        .order('id', { ascending: true })
        .range(da, da + 999)
    ),
  ])
  if (error) console.error('abbonamenti_attivi_oggi_dettaglio:', error.message)

  const nomeGruppo = new Map(gruppi.map((g) => [g.id, g.nome]))
  const elenco: RigaAttivo[] = righe.map(({ gruppo_id, ...r }) => ({
    ...r,
    totale: r.totale == null ? null : Number(r.totale),
    gruppo: (gruppo_id && nomeGruppo.get(gruppo_id)) || 'Non categorizzato',
  }))
  const nomiGruppi = [...gruppi.map((g) => g.nome), ...(elenco.some((r) => r.gruppo === 'Non categorizzato') ? ['Non categorizzato'] : [])]

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">
          <Link href="/dashboard/abbonamenti">Abbonamenti</Link>
        </p>
        <h1>Abbonamenti attivi oggi</h1>
        <p className="muted">
          Uno per riga, in corso e non scaduti: è la lista dietro il riquadro degli utenti attivi. Una persona con due
          abbonamenti compare due volte, per questo il conteggio delle persone è a parte.
        </p>
      </div>
      {error ? (
        <p className="error-banner">
          Non è stato possibile leggere l&apos;elenco. Se manca la vista, esegui
          scripts/sql/2026-10-01-abbonamenti-attivi-oggi-dettaglio.sql.
        </p>
      ) : (
        <ElencoAttivi righe={elenco} gruppi={nomiGruppi} />
      )}
    </>
  )
}
