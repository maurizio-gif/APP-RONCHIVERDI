import Link from 'next/link'
import { redirect } from 'next/navigation'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { emailDelPeriodo } from '@/lib/email-tracking-server'
import {
  ETICHETTE_VISTA,
  VISTE,
  dataOraEmail,
  inVista,
  riassuntoEsito,
  type EmailEsito,
  type Vista,
} from '@/lib/email-tracking'
import { BadgeEsito } from './BadgeEsito'

export const dynamic = 'force-dynamic'

// Tracking email: tutte le email partite dal CRM in un periodo, con i numeri
// di consegna, aperture e click, il riepilogo per tipo e l'elenco da cui si
// apre la prova di invio di ciascuna. Le stesse email si vedono nella scheda
// del contatto e, per i voucher, nel riepilogo voucher.

const PERIODI = [7, 30, 90, 365] as const
const MOSTRATE = 300

type SearchParams = { giorni?: string; vedi?: string; tipo?: string; q?: string }

function percento(parte: number, tutto: number): string {
  return tutto > 0 ? `${Math.round((parte / tutto) * 100)}%` : '—'
}

function normalizza(testo: string): string {
  return testo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export default async function TrackingEmailPage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await utenteHaSezione('tracking-email'))) redirect('/dashboard')

  const giorni = PERIODI.find((p) => String(p) === searchParams.giorni) ?? 30
  const vista: Vista = (VISTE as readonly string[]).includes(searchParams.vedi ?? '')
    ? (searchParams.vedi as Vista)
    : 'tutte'
  const tipo = searchParams.tipo?.trim() || null
  const ricerca = (searchParams.q ?? '').trim()

  const dal = new Date(Date.now() - giorni * 24 * 60 * 60 * 1000)
  const tutte = await emailDelPeriodo(dal)

  // I riquadri contano tutto il periodo; l'elenco segue anche tipo e ricerca.
  const conta = (v: Vista) => tutte.filter((e) => inVista(e, v)).length
  const partite = tutte.filter((e) => e.esito === 'inviata').length
  const consegnate = conta('consegnate')

  const parole = normalizza(ricerca).split(/\s+/).filter(Boolean)
  const elenco = tutte.filter(
    (e) =>
      inVista(e, vista) &&
      (!tipo || e.automazione === tipo) &&
      parole.every((p) => normalizza(`${e.destinatario} ${e.oggetto} ${e.automazione}`).includes(p))
  )

  // Per tipo: quante, e come sono andate.
  const perTipo = new Map<string, EmailEsito[]>()
  for (const e of tutte) perTipo.set(e.automazione, [...(perTipo.get(e.automazione) ?? []), e])
  const tipi = [...perTipo.entries()].sort((a, b) => b[1].length - a[1].length)

  const link = (cambi: Partial<SearchParams>) => {
    const p = new URLSearchParams()
    const tutti = { giorni: String(giorni), vedi: vista, tipo: tipo ?? '', q: ricerca, ...cambi }
    for (const [k, v] of Object.entries(tutti)) if (v && !(k === 'vedi' && v === 'tutte')) p.set(k, v)
    const s = p.toString()
    return s ? `/dashboard/email?${s}` : '/dashboard/email'
  }

  const riquadri: { vista: Vista; valore: number; nota: string }[] = [
    { vista: 'tutte', valore: tutte.length, nota: `ultimi ${giorni} giorni` },
    { vista: 'consegnate', valore: consegnate, nota: percento(consegnate, partite) + ' delle partite' },
    { vista: 'aperte', valore: conta('aperte'), nota: percento(conta('aperte'), consegnate) + ' delle consegnate' },
    { vista: 'cliccate', valore: conta('cliccate'), nota: percento(conta('cliccate'), consegnate) + ' delle consegnate' },
    { vista: 'non-arrivate', valore: conta('non-arrivate'), nota: 'rimbalzate o spam' },
    { vista: 'non-partite', valore: conta('non-partite'), nota: 'rifiutate prima dell’invio' },
  ]

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Amministrazione</p>
        <h1>Tracking email</h1>
        <p className="muted">
          Ogni email partita dal CRM, con consegna, aperture e click comunicati da SendGrid. Da ogni riga si apre la
          prova di invio: testo inviato, dati ufficiali e storico degli eventi.
        </p>
      </div>

      <div className="agenda-nav" style={{ marginBottom: '1rem' }}>
        {PERIODI.map((p) => (
          <Link key={p} href={link({ giorni: String(p) })} className={`btn btn-sm ${p === giorni ? '' : 'btn-ghost'}`}>
            {p === 365 ? '1 anno' : `${p} giorni`}
          </Link>
        ))}
      </div>

      <div className="griglia-stat">
        {riquadri.map((r) => (
          <Link
            key={r.vista}
            href={link({ vedi: r.vista })}
            className="stat"
            aria-current={r.vista === vista ? 'true' : undefined}
            style={r.vista === vista ? { outline: '2px solid var(--accent)' } : undefined}
          >
            <span className="stat-valore">{r.valore}</span>
            <span className="stat-label">{r.vista === 'tutte' ? 'Email inviate' : ETICHETTE_VISTA[r.vista]}</span>
            <span className="muted" style={{ fontSize: 'var(--text-2xs)' }}>
              {r.nota}
            </span>
          </Link>
        ))}
      </div>

      {tipi.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Per tipo</h2>
          </div>
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Email</th>
                  <th>Consegnate</th>
                  <th>Aperte</th>
                  <th>Cliccate</th>
                  <th>Non arrivate</th>
                  <th>Non partite</th>
                </tr>
              </thead>
              <tbody>
                {tipi.map(([nome, righe]) => {
                  const c = righe.filter((e) => inVista(e, 'consegnate')).length
                  const ap = righe.filter((e) => inVista(e, 'aperte')).length
                  const cl = righe.filter((e) => inVista(e, 'cliccate')).length
                  return (
                    <tr key={nome}>
                      <td>
                        <Link href={link({ tipo: nome })}>{nome}</Link>
                      </td>
                      <td>{righe.length}</td>
                      <td>
                        {c} <span className="muted">· {percento(c, righe.length)}</span>
                      </td>
                      <td>
                        {ap} <span className="muted">· {percento(ap, c)}</span>
                      </td>
                      <td>
                        {cl} <span className="muted">· {percento(cl, c)}</span>
                      </td>
                      <td>{righe.filter((e) => inVista(e, 'non-arrivate')).length}</td>
                      <td>{righe.filter((e) => inVista(e, 'non-partite')).length}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <form method="get" className="card filtri-barra-card" role="search">
        <input type="hidden" name="giorni" value={giorni} />
        {vista !== 'tutte' && <input type="hidden" name="vedi" value={vista} />}
        {tipo && <input type="hidden" name="tipo" value={tipo} />}
        <div className="filtri-barra">
          <div className="field filtri-barra-cerca">
            <label htmlFor="f-q">Cerca</label>
            <input
              id="f-q"
              name="q"
              type="search"
              defaultValue={ricerca}
              placeholder="Indirizzo, oggetto o tipo"
              autoComplete="off"
            />
          </div>
          <div className="filtri-barra-azioni">
            <button type="submit" className="btn">
              Cerca
            </button>
          </div>
        </div>
      </form>

      <div className="card">
        <div className="card-head">
          <h2>
            {vista === 'tutte' ? 'Email' : ETICHETTE_VISTA[vista]}
            {tipo ? ` · ${tipo}` : ''}
            {ricerca ? ` · «${ricerca}»` : ''}
          </h2>
          <span className="muted">
            {elenco.length > MOSTRATE ? `le ${MOSTRATE} più recenti di ${elenco.length}` : `${elenco.length}`}
            {(vista !== 'tutte' || tipo || ricerca) && (
              <>
                {' · '}
                <Link href={`/dashboard/email?giorni=${giorni}`}>togli i filtri</Link>
              </>
            )}
          </span>
        </div>

        {elenco.length === 0 ? (
          <p className="vuoto">
            {tutte.length === 0 ? 'Nessuna email inviata in questo periodo.' : 'Nessuna email con questi filtri.'}
          </p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Inviata</th>
                  <th>Destinatario</th>
                  <th>Email</th>
                  <th>Esito</th>
                  <th>Link cliccati</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {elenco.slice(0, MOSTRATE).map((e) => (
                  <tr key={e.id}>
                    <td className="cella-nowrap">{dataOraEmail(e.inviata_il)}</td>
                    <td>
                      {e.persona_id ? (
                        <Link href={`/dashboard/persone/${e.persona_id}`} className="cella-chi-nome">
                          {e.destinatario}
                        </Link>
                      ) : (
                        <div className="cella-chi-nome">{e.destinatario}</div>
                      )}
                      <div className="cella-chi-dettagli">
                        {e.persona_id ? 'in anagrafica' : 'non collegata a una scheda'}
                      </div>
                    </td>
                    <td>
                      <div>{e.oggetto}</div>
                      <div className="cella-chi-dettagli">{e.automazione}</div>
                    </td>
                    <td className="cella-nowrap">
                      <BadgeEsito email={e} />
                      {riassuntoEsito(e) && <div className="cella-chi-dettagli">{riassuntoEsito(e)}</div>}
                    </td>
                    <td>
                      {e.link.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <ul className="email-link-cliccati">
                          {e.link.map((l) => (
                            <li key={l}>{l.replace(/^https?:\/\//, '').slice(0, 60)}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="cella-nowrap">
                      <Link href={`/dashboard/email/${e.id}`}>Prova di invio →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
