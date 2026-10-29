import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { giornoPiu, oggiRoma, primoDelMese } from '@/lib/agenda'
import { COLORE_SENZA_GRUPPO, ETICHETTA_SENZA_GRUPPO, etichettaIntervallo, numero } from '@/lib/accessi'
import { PERSONE_A_SCHERMO, nomeGiornoSettimana, queryReport, type ParametriReport } from '@/lib/accessi-report'
import { ScriptReportMancante, caricaReportAccessi } from '@/lib/accessi-report-server'
import { ScriptAccessiMancante } from '@/lib/accessi-server'
import { nomePersona } from '@/lib/persone'
import { NavAccessi } from '../NavAccessi'
import { SelettoreVarchi } from './SelettoreVarchi'

export const dynamic = 'force-dynamic'

const RIGHE_DETTAGLIO = 300

function dataIt(giorno: string): string {
  const [a, m, g] = giorno.split('-')
  return `${g}/${m}/${a}`
}

// Il report degli ingressi: si spuntano uno o più ingressi (parcheggio,
// piscina, palestra...), si sceglie il periodo e, volendo, uno o più
// nominativi; escono i passaggi e le teste (persone diverse) per giorno, per
// ingresso e per nominativo, scaricabili in Excel, CSV e PDF. Tutto passa
// dall'URL (un form GET): un report si condivide e si riapre, e i file
// usano gli stessi parametri (vedi caricaReportAccessi).
export default async function ReportAccessiPage({ searchParams }: { searchParams: ParametriReport }) {
  if (!(await utenteHaSezione('accessi'))) redirect('/dashboard')

  const oggi = oggiRoma()
  let dati
  try {
    dati = await caricaReportAccessi(createSupabaseServiceClient(), searchParams, oggi, PERSONE_A_SCHERMO)
  } catch (e) {
    if (e instanceof ScriptReportMancante || e instanceof ScriptAccessiMancante) {
      return (
        <>
          <div className="page-head">
            <h1>Accessi</h1>
            <NavAccessi attiva="report" />
          </div>
          <div className="card card-avviso">
            <p className="card-nota">{e.message}</p>
          </div>
        </>
      )
    }
    throw e
  }
  const { report, gruppi, varchi, candidate, nessunaPersona, personeScelte } = dati
  const varchiScelti = report.varchiScelti ?? []

  const href = (extra: { dal?: string; al?: string; persone?: string[]; q?: string } = {}) =>
    queryReport({
      dal: extra.dal ?? report.dal,
      al: extra.al ?? report.al,
      varchi: varchiScelti,
      persone: extra.persone ?? personeScelte,
      extra: { q: extra.q },
    })
  const periodoVeloce = [
    { etichetta: 'Oggi', dal: oggi, al: oggi },
    { etichetta: 'Ieri', dal: giornoPiu(oggi, -1), al: giornoPiu(oggi, -1) },
    { etichetta: '7 giorni', dal: giornoPiu(oggi, -6), al: oggi },
    { etichetta: '30 giorni', dal: giornoPiu(oggi, -29), al: oggi },
    { etichetta: 'Questo mese', dal: primoDelMese(oggi), al: oggi },
  ]
  const scarico = (formato: string) => `/dashboard/accessi/report/export?${href()}&formato=${formato}`
  const nomeScelta = (id: string) => report.persone?.find((p) => p.id === id)?.nome ?? ''

  const unGiorno = report.dal === report.al
  const giorniOrdinati = [...report.giorni].sort((a, b) => b.giorno.localeCompare(a.giorno))

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Report</p>
        <h1>Accessi</h1>
        <p className="muted">
          I passaggi e le teste (persone diverse) per ingresso e per nominativo: spunta gli ingressi, scegli il periodo e scarica il report.
        </p>
        <NavAccessi attiva="report" />
      </div>

      <div className="card">
        <form method="get" className="accessi-report-form">
          <div className="accessi-ricerca">
            <label>
              <span className="muted">Dal</span>
              <input type="date" name="dal" defaultValue={report.dal} min="2023-01-01" max={oggi} />
            </label>
            <label>
              <span className="muted">Al</span>
              <input type="date" name="al" defaultValue={report.al} max={oggi} />
            </label>
            <label className="accessi-ricerca-persona">
              <span className="muted">Aggiungi un nominativo (nome, cognome, email, cellulare o n. utente)</span>
              <input type="search" name="q" placeholder="Lascia vuoto per tutti i nominativi" />
            </label>
          </div>
          {personeScelte.map((id) => (
            <input key={id} type="hidden" name="persona" value={id} />
          ))}

          <SelettoreVarchi
            gruppi={gruppi.map((g) => ({ id: g.id, nome: g.nome, colore: g.colore }))}
            varchi={varchi.map((v) => ({ chiave: v.chiave, descrizione: v.descrizione, gruppoId: v.gruppoId, attivo: v.attivo }))}
            selezionati={varchiScelti}
            senzaGruppoNome={ETICHETTA_SENZA_GRUPPO}
            senzaGruppoColore={COLORE_SENZA_GRUPPO}
          />

          <button type="submit" className="btn">
            Genera report
          </button>
        </form>

        <div className="agenda-nav accessi-ricerca-preset">
          <span className="muted">Periodo veloce:</span>
          {periodoVeloce.map((p) => (
            <Link
              key={p.etichetta}
              href={`/dashboard/accessi/report?${href({ dal: p.dal, al: p.al })}`}
              className={`btn btn-sm ${report.dal === p.dal && report.al === p.al ? '' : 'btn-ghost'}`}
            >
              {p.etichetta}
            </Link>
          ))}
        </div>

        {report.persone && (
          <div className="accessi-report-persone">
            <span className="muted">Nominativi scelti:</span>
            {report.persone.map((p) => (
              <span key={p.id} className="accessi-chip accessi-chip-persona">
                {p.nome}
                <Link
                  href={`/dashboard/accessi/report?${href({ persone: personeScelte.filter((x) => x !== p.id) })}`}
                  aria-label={`Togli ${nomeScelta(p.id)}`}
                  title="Togli"
                >
                  ×
                </Link>
              </span>
            ))}
          </div>
        )}
      </div>

      {nessunaPersona && (
        <div className="card">
          <p className="vuoto">Nessuna persona corrisponde al testo cercato.</p>
        </div>
      )}

      {candidate.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Quale persona?</h2>
            <span className="muted">{candidate.length >= 20 ? 'prime 20 corrispondenze' : `${candidate.length} corrispondenze`}</span>
          </div>
          <ul className="storia">
            {candidate.map((c) => (
              <li key={c.id}>
                <Link href={`/dashboard/accessi/report?${href({ persone: [...personeScelte, c.id] })}`} className="link">
                  Aggiungi {nomePersona(c)}
                </Link>{' '}
                <span className="muted">{[c.email, c.cellulare, c.utente != null && `n. ${c.utente}`].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>{unGiorno ? 'Il giorno' : 'Il periodo'}</h2>
          <span className="muted">
            {etichettaIntervallo(report.dal, report.al)} · {report.varchiScelti === null ? 'tutti gli ingressi' : `${report.varchiScelti.length} ${report.varchiScelti.length === 1 ? 'ingresso' : 'ingressi'}`}
            {report.persone ? ` · ${report.persone.length} ${report.persone.length === 1 ? 'nominativo' : 'nominativi'}` : ''}
          </span>
        </div>
        <div className="accessi-report-numeri">
          <div>
            <strong>{numero(report.totali.passaggi)}</strong>
            <span className="muted">Passaggi (ingressi fatti)</span>
          </div>
          <div>
            <strong>{numero(report.totali.teste)}</strong>
            <span className="muted">Teste (persone diverse)</span>
          </div>
          <div>
            <strong>{numero(report.totali.visite)}</strong>
            <span className="muted">Visite (persona × giorno)</span>
          </div>
          <div>
            <strong>{numero(report.totali.giorniAperti)}</strong>
            <span className="muted">Giorni con passaggi</span>
          </div>
        </div>
        <p className="card-nota">
          Scarica il report:{' '}
          <a className="link" href={scarico('xlsx')}>
            Excel
          </a>
          {' · '}
          <a className="link" href={scarico('csv')}>
            CSV
          </a>
          {' · '}
          <a className="link" href={scarico('pdf')}>
            PDF
          </a>{' '}
          <span className="muted">(con gli stessi filtri)</span>
        </p>
        <p className="card-nota muted">
          Il sistema non distingue entrate e uscite: un passaggio è un passaggio al varco. Le teste contano una persona una volta sola, anche se passa più volte o da più ingressi.
        </p>
      </div>

      {report.totali.passaggi === 0 ? (
        <div className="card">
          <p className="vuoto">Nessun passaggio con questi filtri.</p>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-head">
              <h2>Per ingresso</h2>
              <span className="muted">{report.perVarco.length} {report.perVarco.length === 1 ? 'ingresso' : 'ingressi'} con passaggi</span>
            </div>
            <div className="tabella-wrap">
              <table className="tabella">
                <thead>
                  <tr>
                    <th>Ingresso</th>
                    <th>Gruppo</th>
                    <th className="accessi-num">Passaggi</th>
                    <th className="accessi-num">Teste</th>
                  </tr>
                </thead>
                <tbody>
                  {report.perVarco.map((v) => (
                    <tr key={v.chiave}>
                      <td>{v.descrizione}</td>
                      <td className="muted">{v.gruppo ?? '—'}</td>
                      <td className="accessi-numeri">{numero(v.passaggi)}</td>
                      <td className="accessi-numeri">{numero(v.teste)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <strong>Totale</strong>
                    </td>
                    <td />
                    <td className="accessi-numeri">
                      <strong>{numero(report.totali.passaggi)}</strong>
                    </td>
                    <td className="accessi-numeri">
                      <strong>{numero(report.totali.teste)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {!unGiorno && (
            <div className="card">
              <div className="card-head">
                <h2>Per giorno</h2>
                <span className="muted">dal più recente</span>
              </div>
              <div className="tabella-wrap">
                <table className="tabella">
                  <thead>
                    <tr>
                      <th>Giorno</th>
                      <th className="accessi-num">Passaggi</th>
                      <th className="accessi-num">Teste</th>
                    </tr>
                  </thead>
                  <tbody>
                    {giorniOrdinati.map((g) => (
                      <tr key={g.giorno}>
                        <td className="cella-nowrap">
                          {nomeGiornoSettimana(g.giorno).slice(0, 3)} {dataIt(g.giorno)}
                        </td>
                        <td className="accessi-numeri">{numero(g.passaggi)}</td>
                        <td className="accessi-numeri">{numero(g.teste)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <h2>Per nominativo</h2>
              <span className="muted">
                {report.personeTroncate ? `prime ${numero(report.perPersona.length)} per passaggi: l'elenco completo è nei file` : `${numero(report.perPersona.length)} ${report.perPersona.length === 1 ? 'persona' : 'persone'}`}
              </span>
            </div>
            {report.perPersona.length === 0 ? (
              <p className="vuoto">Nessun nominativo con passaggi.</p>
            ) : (
              <div className="tabella-wrap">
                <table className="tabella">
                  <thead>
                    <tr>
                      <th>Nominativo</th>
                      <th className="accessi-num">Passaggi</th>
                      <th className="accessi-num">Giorni di presenza</th>
                      <th className="accessi-num">Ingressi diversi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.perPersona.map((p) => (
                      <tr key={p.utente}>
                        <td>
                          {p.personaId ? (
                            <Link href={`/dashboard/persone/${p.personaId}`} className="link">
                              {p.nome}
                            </Link>
                          ) : (
                            <span className="muted">{p.nome}</span>
                          )}
                        </td>
                        <td className="accessi-numeri">{numero(p.passaggi)}</td>
                        <td className="accessi-numeri">{numero(p.giorni)}</td>
                        <td className="accessi-numeri">{numero(p.varchi)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!report.persone && (
              <p className="card-nota muted">Per vedere un nominativo giorno per giorno e ingresso per ingresso, aggiungilo dal campo in alto.</p>
            )}
          </div>

          {report.dettaglio && report.dettaglio.length > 0 && (
            <div className="card">
              <div className="card-head">
                <h2>Dettaglio dei nominativi scelti</h2>
                <span className="muted">giorno per giorno e ingresso per ingresso</span>
              </div>
              <div className="tabella-wrap">
                <table className="tabella">
                  <thead>
                    <tr>
                      <th>Nominativo</th>
                      <th>Giorno</th>
                      <th>Ingresso</th>
                      <th className="accessi-num">Passaggi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.dettaglio.slice(0, RIGHE_DETTAGLIO).map((d, i) => (
                      <tr key={i}>
                        <td>{d.nome}</td>
                        <td className="cella-nowrap">
                          {nomeGiornoSettimana(d.giorno).slice(0, 3)} {dataIt(d.giorno)}
                        </td>
                        <td>{d.ingresso}</td>
                        <td className="accessi-numeri">{numero(d.passaggi)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.dettaglio.length > RIGHE_DETTAGLIO && (
                <p className="card-nota muted">
                  Mostrate le prime {numero(RIGHE_DETTAGLIO)} righe su {numero(report.dettaglio.length)}: il dettaglio completo è nei file.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}
