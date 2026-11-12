import Link from 'next/link'
import { redirect } from 'next/navigation'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import {
  ETICHETTE_URGENZA,
  NOMI_GIORNI,
  SEZIONE_SEGNALAZIONI,
  SEZIONE_SEGNALAZIONI_REPORT,
  durataLeggibile,
  type Urgenza,
} from '@/lib/segnalazioni'
import { calcolaReport } from '@/lib/segnalazioni-report'
import { leggiSegnalazioni, nomiElenchi, nomiStaff } from '@/lib/segnalazioni-server'

export const dynamic = 'force-dynamic'

// Il report per la direzione: quante segnalazioni, dove, quando, con che
// risposta. Le cifre sono quelle del momento: ricalcolate a ogni apertura
// sull'elenco intero (lib/segnalazioni-report.ts).
//
// Una cautela di lettura: i dati dell'Excel storico non sono confrontabili con
// questi (lì ora e motivo mancavano quasi sempre, e un picco di registrazioni
// può essere più disciplina di compilazione che più problemi).

const PERIODI = [
  { chiave: '30', testo: 'Ultimi 30 giorni', giorni: 30 },
  { chiave: '90', testo: 'Ultimi 90 giorni', giorni: 90 },
  { chiave: '365', testo: 'Ultimo anno', giorni: 365 },
  { chiave: 'tutto', testo: 'Tutto', giorni: 0 },
] as const

function Barre({ voci, max }: { voci: { etichetta: string; n: number; nota?: string }[]; max?: number }) {
  const tetto = max ?? Math.max(1, ...voci.map((v) => v.n))
  return (
    <ul className="sg-barre">
      {voci.map((v) => (
        <li key={v.etichetta}>
          <span className="sg-barre-nome">{v.etichetta}</span>
          <span className="sg-barra" aria-hidden>
            <span style={{ width: `${(v.n / tetto) * 100}%` }} />
          </span>
          <span className="sg-barre-n">
            {v.n}
            {v.nota && <span className="muted"> {v.nota}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default async function ReportSegnalazioniPage({ searchParams }: { searchParams: { p?: string } }) {
  if (!(await utenteHaSezione(SEZIONE_SEGNALAZIONI_REPORT)) || !emailCorrente()) {
    redirect((await utenteHaSezione(SEZIONE_SEGNALAZIONI)) ? '/dashboard/segnalazioni' : '/dashboard')
  }
  const periodo = PERIODI.find((p) => p.chiave === searchParams.p) ?? PERIODI[1]
  const dal = periodo.giorni ? new Date(Date.now() - periodo.giorni * 86400_000).toISOString() : undefined

  const [righe, elenchi, nomi] = await Promise.all([leggiSegnalazioni(dal), nomiElenchi(), nomiStaff()])
  const r = calcolaReport(righe)
  const settore = (k: string) => elenchi.settori.get(k) ?? k
  const motivo = (k: string) => elenchi.motivi.get(k) ?? k
  const percento = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
  const durata = (o: number | null) => (o === null ? '—' : durataLeggibile(o))
  const oreUtili = r.perOra.map((n, ora) => ({ etichetta: `${String(ora).padStart(2, '0')}:00`, n })).slice(6, 24)

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">
          <Link href="/dashboard/segnalazioni">← Segnalazioni soci</Link>
        </p>
        <h1>Report segnalazioni</h1>
        <p className="muted">{periodo.testo.toLowerCase()} · {r.ricevute} segnalazioni registrate nel CRM.</p>
      </div>

      <div className="agenda-nav" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
        {PERIODI.map((p) => (
          <Link
            key={p.chiave}
            href={`/dashboard/segnalazioni/report?p=${p.chiave}`}
            className={`btn btn-sm ${p.chiave === periodo.chiave ? '' : 'btn-ghost'}`}
          >
            {p.testo}
          </Link>
        ))}
      </div>

      {r.ricevute === 0 ? (
        <div className="card">
          <p className="vuoto">Nessuna segnalazione nel periodo.</p>
        </div>
      ) : (
        <>
          <div className="griglia-stat">
            <div className="stat stat-info">
              <span className="stat-testa">
                <span className="stat-label">Ricevute</span>
              </span>
              <span className="stat-valore">{r.ricevute}</span>
              <span className="stat-nota">
                {r.aperte} aperte · {r.chiuse} chiuse
              </span>
            </div>
            <div className={`stat ${r.inRitardo ? 'stat-warn' : 'stat-ok'}`}>
              <span className="stat-testa">
                <span className="stat-label">In ritardo</span>
              </span>
              <span className="stat-valore">{r.inRitardo}</span>
              <span className="stat-nota">oltre il tempo della loro urgenza</span>
            </div>
            <div className="stat">
              <span className="stat-testa">
                <span className="stat-label">Prese in carico in tempo</span>
              </span>
              <span className="stat-valore">{percento(r.presaPuntuali, r.presaDovute)}</span>
              <span className="stat-nota">
                {r.presaPuntuali} su {r.presaDovute} · mediana {durata(r.medianaPresaOre)}
              </span>
            </div>
            <div className="stat">
              <span className="stat-testa">
                <span className="stat-label">Tempo alla risoluzione</span>
              </span>
              <span className="stat-valore">{durata(r.medianaRisoluzioneOre)}</span>
              <span className="stat-nota">mediana, dalla ricezione</span>
            </div>
          </div>

          <div className="sg-colonne">
            <div className="card">
              <div className="card-head">
                <h2>Per settore</h2>
              </div>
              <div className="tabella-wrap">
                <table className="tabella">
                  <thead>
                    <tr>
                      <th>Settore</th>
                      <th>Segnalazioni</th>
                      <th>Aperte</th>
                      <th>In ritardo</th>
                      <th>Risoluzione</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.perSettore.map((s) => (
                      <tr key={s.settore}>
                        <td>{settore(s.settore)}</td>
                        <td>{s.n}</td>
                        <td>{s.aperte}</td>
                        <td>{s.ritardo || '—'}</td>
                        <td>{durata(s.medianaRisoluzioneOre)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Per motivo</h2>
              </div>
              <Barre voci={r.perMotivo.slice(0, 12).map((m) => ({ etichetta: motivo(m.chiave), n: m.n }))} />
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Problemi che si ripetono</h2>
              <span className="muted">stesso motivo nello stesso settore, almeno tre volte</span>
            </div>
            {r.ricorrenze.length === 0 ? (
              <p className="vuoto">Nessun problema ricorrente nel periodo.</p>
            ) : (
              <Barre voci={r.ricorrenze.map((c) => ({ etichetta: `${settore(c.settore)} · ${motivo(c.motivo)}`, n: c.n }))} />
            )}
          </div>

          <div className="sg-colonne">
            <div className="card">
              <div className="card-head">
                <h2>A che ora</h2>
                <span className="muted">quando la segnalazione è stata registrata</span>
              </div>
              <Barre voci={oreUtili} />
            </div>

            <div className="card">
              <div className="card-head">
                <h2>In che giorno</h2>
              </div>
              <Barre voci={r.perGiorno.map((n, i) => ({ etichetta: NOMI_GIORNI[i], n }))} />
              <div className="card-head" style={{ marginTop: '1.25rem' }}>
                <h2>Per urgenza</h2>
              </div>
              <Barre
                voci={(Object.keys(r.perUrgenza) as Urgenza[]).map((u) => ({
                  etichetta: ETICHETTE_URGENZA[u],
                  n: r.perUrgenza[u],
                }))}
              />
            </div>
          </div>

          {r.perMese.length > 1 && (
            <div className="card">
              <div className="card-head">
                <h2>Mese per mese</h2>
              </div>
              <Barre voci={r.perMese.map((m) => ({ etichetta: m.chiave, n: m.n }))} />
            </div>
          )}

          <div className="sg-colonne">
            <div className="card">
              <div className="card-head">
                <h2>Chi le lavora</h2>
              </div>
              {r.carico.length === 0 ? (
                <p className="vuoto">Nessuna segnalazione assegnata.</p>
              ) : (
                <div className="tabella-wrap">
                  <table className="tabella">
                    <thead>
                      <tr>
                        <th>Operatore</th>
                        <th>Assegnate</th>
                        <th>Aperte</th>
                        <th>Risolte</th>
                        <th>Risoluzione</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.carico.map((c) => (
                        <tr key={c.email}>
                          <td>{nomi.get(c.email) ?? c.email}</td>
                          <td>{c.assegnate}</td>
                          <td>{c.aperte}</td>
                          <td>{c.risolte}</td>
                          <td>{durata(c.medianaRisoluzioneOre)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Soci che segnalano spesso</h2>
                <span className="muted">almeno due segnalazioni</span>
              </div>
              {r.sociRicorrenti.length === 0 ? (
                <p className="vuoto">Nessun socio con più segnalazioni.</p>
              ) : (
                <ul className="sg-soci">
                  {r.sociRicorrenti.map((s) => (
                    <li key={s.socio}>
                      <span>{s.socio}</span>
                      <b>{s.n}</b>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
