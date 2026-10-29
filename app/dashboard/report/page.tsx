import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getNomeUtente, getSezioniConsentite, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { oggiRoma } from '@/lib/agenda'
import { etichettaIntervallo } from '@/lib/accessi'
import { PRESET_REPORT, SEZIONI_REPORT, periodoPredefinito, sezioniDaParametro } from '@/lib/report'
import { costruisciBlocchi } from '@/lib/report-blocchi'
import { caricaReport } from '@/lib/report-server'
import { AnteprimaReport } from './AnteprimaReport'

export const dynamic = 'force-dynamic'

type Parametri = { periodo?: string; dal?: string; al?: string; sezioni?: string | string[]; inviato?: string }

// Il report per periodo (da data A a data B): si sceglie il periodo e le
// sezioni, si guarda l'anteprima e si scarica in PDF. Ogni sezione si legge
// solo se chi apre la pagina ha anche il permesso della pagina da cui nasce
// (vedi SEZIONI_REPORT): il permesso «report» apre questa pagina, non allarga
// quello che si può vedere. Anteprima e PDF disegnano la stessa lista di
// blocchi (lib/report-blocchi.ts).
export default async function ReportPage({ searchParams }: { searchParams: Parametri }) {
  if (!(await utenteHaSezione('report'))) redirect('/dashboard')

  const email = emailCorrente()
  const permessi = await getSezioniConsentite(email)
  const periodo = periodoPredefinito(searchParams, oggiRoma())
  const sezioni = sezioniDaParametro(searchParams.sezioni, !!searchParams.inviato)
  const consentite = SEZIONI_REPORT.filter((s) => permessi.includes(s.richiede)).map((s) => s.chiave)

  // Gli stessi parametri per i link: periodo scelto e sezioni.
  const parametri = (extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ inviato: '1', sezioni: sezioni.join(','), ...extra })
    return q.toString()
  }

  let blocchi
  let errore: string | null = null
  if (sezioni.length > 0) {
    try {
      const dati = await caricaReport(createSupabaseServiceClient(), periodo, sezioni, permessi, await getNomeUtente(email))
      blocchi = costruisciBlocchi(dati)
    } catch (e) {
      errore = e instanceof Error ? e.message : 'Errore nella lettura dei dati.'
    }
  }

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Report</p>
        <h1>Report PDF</h1>
        <p className="muted">Scegli il periodo e le sezioni, controlla l&apos;anteprima e scarica il PDF.</p>
      </div>

      <div className="card">
        <div className="agenda-nav">
          {PRESET_REPORT.map((p) => (
            <Link
              key={p.chiave}
              href={`/dashboard/report?${parametri({ periodo: p.chiave })}`}
              className={`btn btn-sm ${periodo.preset === p.chiave ? '' : 'btn-ghost'}`}
            >
              {p.etichetta}
            </Link>
          ))}
        </div>
        <form method="get" action="/dashboard/report" className="report-form">
          <input type="hidden" name="inviato" value="1" />
          <div className="report-form-date">
            <label>
              <span className="muted">Dal</span>
              <input type="date" name="dal" defaultValue={periodo.dal} min="2023-01-01" />
            </label>
            <label>
              <span className="muted">Al</span>
              <input type="date" name="al" defaultValue={periodo.al} />
            </label>
          </div>
          <fieldset className="report-sezioni">
            <legend className="muted">Sezioni</legend>
            {SEZIONI_REPORT.map((s) => {
              const permessa = consentite.includes(s.chiave)
              return (
                <label key={s.chiave} className={`report-sezione-scelta ${permessa ? '' : 'is-negata'}`} title={permessa ? s.nota : 'Non hai il permesso per questa sezione'}>
                  <input type="checkbox" name="sezioni" value={s.chiave} defaultChecked={permessa && sezioni.includes(s.chiave)} disabled={!permessa} />
                  <span>
                    <strong>{s.etichetta}</strong>
                    <span className="muted"> {s.nota}</span>
                  </span>
                </label>
              )
            })}
          </fieldset>
          <div className="report-azioni">
            <button type="submit" className="btn btn-ghost">
              Aggiorna anteprima
            </button>
            <button type="submit" className="btn" formAction="/dashboard/report/pdf">
              Scarica PDF
            </button>
            <span className="muted">{etichettaIntervallo(periodo.dal, periodo.al)}</span>
          </div>
        </form>
      </div>

      {sezioni.length === 0 && (
        <div className="card">
          <p className="vuoto">Spunta almeno una sezione.</p>
        </div>
      )}
      {errore && (
        <div className="card card-avviso">
          <p className="card-nota">{errore}</p>
        </div>
      )}
      {blocchi && (
        <div className="card">
          <AnteprimaReport blocchi={blocchi} />
        </div>
      )}
    </>
  )
}
