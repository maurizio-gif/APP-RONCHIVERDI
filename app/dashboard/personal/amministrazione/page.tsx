import Link from 'next/link'
import { redirect } from 'next/navigation'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { dataBreve, etichettaMese, mesePiu, normalizzaOra, oggiRoma, primoDelMese } from '@/lib/agenda'
import { ETICHETTE_TIPO_QUOTA, euroCentesimi, nomeCliente, type QuotaTrainer as Quota } from '@/lib/personal'
import { rendicontoMese } from '@/lib/personal-server'
import { QuotaTrainer } from './QuotaTrainer'

export const dynamic = 'force-dynamic'

// L'amministrazione dei personal trainer: quanto ciascuno deve versare a
// Ronchiverdi nel mese. La quota è oraria (un importo per ogni sessione
// confermata dal responsabile) o flat (un canone fisso al mese). Le sessioni
// ancora in attesa si vedono ma non si contano: prima vanno confermate.

function href(mese: string) {
  return `/dashboard/personal/amministrazione?mese=${mese}`
}

function meseBreve(giorno: string): string {
  return new Date(`${giorno}T12:00:00Z`).toLocaleDateString('it-IT', {
    timeZone: 'UTC',
    month: 'short',
    year: 'numeric',
  })
}

function descriviQuota(q: Quota): string {
  return q.tipo === 'flat' ? `${euroCentesimi(q.importo)} al mese` : `${euroCentesimi(q.importo)} a sessione`
}

export default async function AmministrazionePersonalPage({ searchParams }: { searchParams: { mese?: string } }) {
  if (!(await utenteHaSezione('personal-amministrazione'))) {
    redirect('/dashboard')
  }

  const oggi = oggiRoma()
  const mese = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.mese ?? '') ? primoDelMese(searchParams.mese!) : primoDelMese(oggi)
  const { righe, errore } = await rendicontoMese(mese)

  const sessioniConfermate = righe.reduce((n, r) => n + r.confermate.length, 0)
  const inAttesa = righe.reduce((n, r) => n + r.inAttesa, 0)
  const senzaQuota = righe.filter((r) => !r.quota && r.confermate.length > 0).length
  const totale = Math.round(righe.reduce((n, r) => n + r.dovuto, 0) * 100) / 100

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Personal training</p>
        <h1>Amministrazione personal</h1>
        <p className="muted">
          Quanto ogni trainer deve versare a Ronchiverdi nel mese: una quota oraria per ogni sessione
          confermata dal responsabile, oppure un canone flat mensile.
        </p>
      </div>

      {errore && (
        <p className="error-banner">
          Dati non leggibili: esegui scripts/sql/2026-10-15-personal-training.sql nel SQL Editor di Supabase.
        </p>
      )}

      <div className="report-mese-nav">
        <Link href={href(mesePiu(mese, -1))} className="btn btn-ghost btn-sm">
          ←
        </Link>
        <span className="report-mese-titolo">{etichettaMese(mese)}</span>
        <Link href={href(mesePiu(mese, 1))} className="btn btn-ghost btn-sm">
          →
        </Link>
        <a href={`/dashboard/personal/amministrazione/export?mese=${mese}`} className="chip">
          Scarica CSV
        </a>
      </div>

      <div className="griglia-stat">
        <div className="stat">
          <span className="stat-valore">{sessioniConfermate}</span>
          <span className="stat-label">Sessioni confermate</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{euroCentesimi(totale)}</span>
          <span className="stat-label">Da incassare dai trainer</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{inAttesa}</span>
          <span className="stat-label">In attesa di conferma</span>
          {inAttesa > 0 && <span className="stat-nota">Non entrano nel conto finché non sono confermate.</span>}
        </div>
        {senzaQuota > 0 && (
          <div className="stat">
            <span className="stat-valore">{senzaQuota}</span>
            <span className="stat-label">Trainer senza quota</span>
            <span className="stat-nota">Hanno sessioni confermate ma nessuna quota: il loro dovuto è € 0.</span>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Trainer</h2>
          <span className="muted">{righe.length === 1 ? '1 trainer' : `${righe.length} trainer`}</span>
        </div>

        {righe.length === 0 ? (
          <p className="vuoto">
            Nessun trainer: si invitano da Gestione utenti con l’accesso «Personal trainer».
          </p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella pt-tabella">
              <thead>
                <tr>
                  <th>Trainer</th>
                  <th>Confermate</th>
                  <th>In attesa</th>
                  <th>Quota</th>
                  <th>Dovuto nel mese</th>
                </tr>
              </thead>
              <tbody>
                {righe.map((r) => (
                  <tr key={r.trainerEmail}>
                    <td>
                      <div className="cella-chi-nome">{r.trainerNome}</div>
                      {r.confermate.length > 0 && (
                        <details className="pt-dettaglio">
                          <summary>Sessioni del mese</summary>
                          <ol className="pt-dettaglio-elenco">
                            {r.confermate.map((s) => (
                              <li key={s.id}>
                                <span className="muted">
                                  {dataBreve(s.data)} · {normalizzaOra(s.ora)}
                                </span>{' '}
                                {nomeCliente(s)}
                                {s.corporate && s.azienda ? ` (${s.azienda})` : ''}
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                      {r.storicoQuote.length > 1 && (
                        <details className="pt-dettaglio">
                          <summary>Storico quote</summary>
                          <ol className="pt-dettaglio-elenco">
                            {r.storicoQuote.map((q) => (
                              <li key={q.valido_dal}>
                                da {meseBreve(q.valido_dal)}: {ETICHETTE_TIPO_QUOTA[q.tipo]}, {descriviQuota(q)}
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                    </td>
                    <td className="cella-importo">{r.confermate.length}</td>
                    <td className="cella-importo">
                      {r.inAttesa > 0 ? <span className="badge badge-warn">{r.inAttesa}</span> : '0'}
                    </td>
                    <td>
                      <div className="pt-compenso">
                        <span>
                          {r.quota ? (
                            <>
                              {descriviQuota(r.quota)}
                              <div className="cella-chi-dettagli">{r.quota.tipo === 'flat' ? 'Flat' : 'Oraria'}</div>
                            </>
                          ) : (
                            <span className="muted">non impostata</span>
                          )}
                        </span>
                        <QuotaTrainer trainerEmail={r.trainerEmail} mesePredefinito={mese} attuale={r.quota} />
                      </div>
                    </td>
                    <td className="cella-importo">
                      <strong>{euroCentesimi(r.dovuto)}</strong>
                      {r.quota?.tipo === 'oraria' && r.confermate.length > 0 && (
                        <div className="cella-chi-dettagli">
                          {r.confermate.length} × {euroCentesimi(r.quota.importo)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>
                    <strong>Totale</strong>
                  </td>
                  <td className="cella-importo">
                    <strong>{sessioniConfermate}</strong>
                  </td>
                  <td className="cella-importo">{inAttesa}</td>
                  <td />
                  <td className="cella-importo">
                    <strong>{euroCentesimi(totale)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
