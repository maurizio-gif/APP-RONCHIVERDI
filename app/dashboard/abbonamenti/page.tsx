import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { euro } from '@/lib/pipeline'
import { etichettaMese, oggiRoma, primoDelMese } from '@/lib/agenda'

export const dynamic = 'force-dynamic'

export default async function AbbonamentiPage() {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  const oggi = oggiRoma()
  const meseCorrente = primoDelMese(oggi)
  const meseAnnoScorso = `${Number(meseCorrente.slice(0, 4)) - 1}${meseCorrente.slice(4)}`

  const supabase = createSupabaseServiceClient()
  const { data: righeMesi } = await supabase
    .from('abbonamenti_mensili')
    .select('mese, numero_vendite, fatturato')
    .in('mese', [meseCorrente, meseAnnoScorso])

  const sommaMese = (mese: string) =>
    (righeMesi ?? [])
      .filter((r) => r.mese === mese)
      .reduce(
        (acc, r) => ({ vendite: acc.vendite + r.numero_vendite, fatturato: acc.fatturato + Number(r.fatturato ?? 0) }),
        { vendite: 0, fatturato: 0 }
      )

  const mtd = sommaMese(meseCorrente)
  const mtdAnnoScorso = sommaMese(meseAnnoScorso)
  const variazione =
    mtdAnnoScorso.fatturato > 0
      ? Math.round(((mtd.fatturato - mtdAnnoScorso.fatturato) / mtdAnnoScorso.fatturato) * 100)
      : null

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Vendite</p>
        <h1>Abbonamenti</h1>
        <p className="muted">Le vendite di abbonamenti sincronizzate da Info4U, con reportistica giornaliera e mensile.</p>
      </div>

      <div className="card">
        <p className="filtri-titolo">
          {etichettaMese(meseCorrente)} — mese in corso, dati parziali aggiornati a oggi
        </p>
        <div className="tabella-wrap">
          <table className="tabella">
            <thead>
              <tr>
                <th>Vendite</th>
                <th>Fatturato</th>
                <th>Vs stesso mese anno scorso</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{mtd.vendite || '—'}</td>
                <td>{mtd.fatturato ? euro(mtd.fatturato) : '—'}</td>
                <td>{variazione === null ? '—' : `${variazione > 0 ? '+' : ''}${variazione}%`}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <p className="filtri-titolo">Report</p>
        <div className="form-row">
          <Link href="/dashboard/abbonamenti/report" className="btn btn-grande">
            Report giornaliero
          </Link>
          <Link href="/dashboard/abbonamenti/andamento" className="btn btn-grande">
            Andamento mensile
          </Link>
        </div>
      </div>

      <div className="card">
        <p className="filtri-titolo">Configurazione</p>
        <p className="muted">
          I prodotti venduti in Info4U vanno raggruppati a mano (es. Soci Gold, Corsi, Tennis...) per comparire
          correttamente nei report qui sopra.
        </p>
        <Link href="/dashboard/abbonamenti/gruppi" className="btn btn-ghost btn-sm">
          Gestisci gruppi prodotto
        </Link>
      </div>
    </div>
  )
}
