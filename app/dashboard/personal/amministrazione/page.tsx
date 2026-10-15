import Link from 'next/link'
import { redirect } from 'next/navigation'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { dataBreve, etichettaMese, mesePiu, normalizzaOra, oggiRoma, primoDelMese } from '@/lib/agenda'
import { dataNumerica, euroCentesimi, nomeCliente } from '@/lib/personal'
import { rendicontoMese } from '@/lib/personal-server'
import { CompensoTrainer } from './CompensoTrainer'

export const dynamic = 'force-dynamic'

// L'amministrazione dei personal trainer: per ognuno il compenso a sessione
// e il conto del mese sulle sessioni confermate dal responsabile. Le sessioni
// ancora in attesa si vedono ma non si pagano: prima vanno confermate.

function href(mese: string) {
  return `/dashboard/personal/amministrazione?mese=${mese}`
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
  const senzaCompenso = righe.reduce((n, r) => n + r.senzaCompenso, 0)
  const totale = Math.round(righe.reduce((n, r) => n + r.totale, 0) * 100) / 100

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Personal training</p>
        <h1>Amministrazione personal</h1>
        <p className="muted">
          Il compenso a sessione di ogni trainer e il conto del mese. Contano solo le sessioni
          confermate dal responsabile, ciascuna al compenso in vigore nel giorno in cui si è svolta.
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
          <span className="stat-label">Compensi del mese</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{inAttesa}</span>
          <span className="stat-label">In attesa di conferma</span>
          {inAttesa > 0 && <span className="stat-nota">Non entrano nel conto finché non sono confermate.</span>}
        </div>
        {senzaCompenso > 0 && (
          <div className="stat">
            <span className="stat-valore">{senzaCompenso}</span>
            <span className="stat-label">Senza compenso impostato</span>
            <span className="stat-nota">Confermate ma a € 0: imposta il compenso del trainer.</span>
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
                  <th>Compenso a sessione</th>
                  <th>Totale mese</th>
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
                                {s.corporate && s.azienda ? ` (${s.azienda})` : ''} ·{' '}
                                {s.compenso == null ? <span className="badge badge-warn">senza compenso</span> : euroCentesimi(s.compenso)}
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                      {r.storicoCompensi.length > 1 && (
                        <details className="pt-dettaglio">
                          <summary>Storico compensi</summary>
                          <ol className="pt-dettaglio-elenco">
                            {r.storicoCompensi.map((c) => (
                              <li key={c.valido_dal}>
                                dal {dataNumerica(c.valido_dal)}: {euroCentesimi(c.compenso_sessione)}
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
                          {euroCentesimi(r.compensoFineMese)}
                          {r.compensoVariato && <div className="cella-chi-dettagli">cambiato nel mese</div>}
                        </span>
                        <CompensoTrainer
                          trainerEmail={r.trainerEmail}
                          validoDalPredefinito={mese}
                          attuale={r.compensoFineMese}
                        />
                      </div>
                    </td>
                    <td className="cella-importo">
                      <strong>{euroCentesimi(r.totale)}</strong>
                      {r.senzaCompenso > 0 && (
                        <div className="cella-chi-dettagli">{r.senzaCompenso} senza compenso</div>
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
