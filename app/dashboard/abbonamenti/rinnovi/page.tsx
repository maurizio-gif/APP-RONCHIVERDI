import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { caricaGruppi } from '@/lib/abbonamenti'
import { etichettaMese, mesePiu, oggiRoma, primoDelMese } from '@/lib/agenda'
import { TabellaScadenze, type RigaScadenza } from '../scadenze/TabellaScadenze'

export const dynamic = 'force-dynamic'

// La stessa schermata di /dashboard/abbonamenti/scadenze, ma fissa sul
// gruppo Core e con un nome che parla alle persone che ci lavorano ogni
// giorno: prima di questa pagina il lavoro di richiamare i rinnovi in
// scadenza viveva in un foglio Excel a parte ("REPORT RINNOVI"), popolato e
// aggiornato a mano fuori dal CRM. Qui è la stessa tabella, gli stessi dati,
// più due colonne che il foglio aveva e il CRM no — Trattativa e Note (vedi
// TabellaScadenze, CellaTrattativa/CellaNota) — così la lavorazione del
// rinnovo può restare tutta in un posto solo.
//
// Nessun filtro Gruppo in pagina: è sempre e solo Core, quindi mostrarlo
// sarebbe un controllo che non controlla niente.
export default async function RinnoviPage({ searchParams }: { searchParams: { mese?: string } }) {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  const meseRichiesto = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.mese ?? '')
    ? primoDelMese(searchParams.mese!)
    : primoDelMese(oggiRoma())

  const gruppi = await caricaGruppi()
  const gruppoCore = gruppi.find((g) => g.nome === 'CORE')

  const supabase = createSupabaseServiceClient()

  const righeGrezze: RigaScadenza[] = []
  let erroreScadenze: { message: string } | null = null
  if (gruppoCore) {
    // Stessa paginazione manuale di /scadenze: PostgREST tronca comunque a
    // 1000 righe, e settembre da solo ne supera 350 per il solo gruppo Core.
    for (let da = 0; da < 10000; da += 1000) {
      const { data, error } = await supabase
        .from('abbonamenti_scadenze')
        .select(
          'id, persona_id, abbonamento, gruppo_id, data_inizio, data_fine, totale, nome, cognome, email, cellulare, rinnovato, rinnovo_id, rinnovo_abbonamento, rinnovo_data_inizio, rinnovo_data_fine, rinnovo_totale, operatore_nome, in_trattativa, nota',
        )
        .eq('gruppo_id', gruppoCore.id)
        .gte('data_fine', meseRichiesto)
        .lt('data_fine', mesePiu(meseRichiesto, 1))
        .order('rinnovato', { ascending: true })
        .order('data_fine', { ascending: true })
        .order('id', { ascending: true })
        .range(da, da + 999)
      if (error) {
        erroreScadenze = error
        break
      }
      righeGrezze.push(...((data ?? []) as RigaScadenza[]))
      if (!data || data.length < 1000) break
    }
  }
  const righe = righeGrezze

  const totale = righe.length
  const daRichiamare = righe.filter((r) => !r.rinnovato).length

  function hrefMese(m: string) {
    return `/dashboard/abbonamenti/rinnovi?mese=${m}`
  }

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Abbonamenti</p>
        <h1>Rinnovi Core</h1>
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

      {!gruppoCore ? (
        <div className="card">
          <p className="vuoto">
            Manca il gruppo prodotto "CORE": crealo da{' '}
            <Link href="/dashboard/abbonamenti/gruppi" className="link">
              Gestisci gruppi prodotto
            </Link>
            .
          </p>
        </div>
      ) : erroreScadenze && /abbonamenti_scadenze/.test(erroreScadenze.message) ? (
        <div className="card">
          <p className="vuoto">
            Manca la vista delle scadenze: esegui scripts/sql/2026-09-21-abbonamenti-scadenze.sql nel SQL Editor di
            Supabase.
          </p>
        </div>
      ) : righe.length === 0 ? (
        <div className="card">
          <p className="vuoto">Nessun rinnovo Core in scadenza in questo mese.</p>
        </div>
      ) : (
        <TabellaScadenze righe={righe} gruppi={gruppi} nascondiGruppo />
      )}
    </div>
  )
}
