import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { dataOra } from '@/lib/persone'

export const dynamic = 'force-dynamic'

// Periodi offerti. Non un intervallo libero: su un pannello di lavoro le tre
// finestre coprono quasi tutte le domande, e un selettore di date sarebbe
// un'altra cosa da compilare per la stessa risposta.
const PERIODI = [
  { chiave: '7', label: '7 giorni', giorni: 7 },
  { chiave: '30', label: '30 giorni', giorni: 30 },
  { chiave: '90', label: '90 giorni', giorni: 90 },
] as const

type Campagna = { sorgente: string; mezzo: string; campagna: string; sessioni: number; lead: number }
type Pagina = { pagina: string; viste: number; sessioni: number }
type Dispositivo = { dispositivo: string; sessioni: number }
type Citta = { citta: string; paese: string; sessioni: number }

type Statistiche = {
  sessioni: number
  convertite: number
  visitatori: number
  con_consenso: number
  pagine_medie: number
  campagne: Campagna[]
  pagine: Pagina[]
  dispositivi: Dispositivo[]
  citta: Citta[]
}

type SessioneRecente = {
  session_id: string
  created_at: string
  utm_source: string | null
  utm_campaign: string | null
  referrer: string | null
  landing_page: string | null
  pagine_viste: number
  dispositivo: string | null
  citta: string | null
  paese: string | null
  convertita: boolean
}

function percentuale(parte: number, totale: number): string {
  if (!totale) return '—'
  return `${Math.round((parte / totale) * 1000) / 10}%`
}

/** La sorgente leggibile di una sessione, con la stessa logica della funzione SQL. */
function sorgenteDi(s: SessioneRecente): string {
  if (s.utm_source) return s.utm_campaign ? `${s.utm_source} · ${s.utm_campaign}` : s.utm_source
  if (s.referrer) {
    try {
      return new URL(s.referrer).host
    } catch {
      return '(referral)'
    }
  }
  return '(diretto)'
}

export default async function VisitePage({ searchParams }: { searchParams: { periodo?: string } }) {
  if (!(await utenteHaSezione('visite-sito'))) {
    redirect('/dashboard')
  }

  const periodo = PERIODI.find((p) => p.chiave === searchParams.periodo) ?? PERIODI[1]
  const da = new Date()
  da.setDate(da.getDate() - periodo.giorni)

  const supabase = createSupabaseServiceClient()
  const [{ data: stat, error }, { data: recenti }] = await Promise.all([
    supabase.rpc('statistiche_visite', {
      p_da: da.toISOString(),
      // Il limite superiore è "adesso", non la fine del giorno: una sessione
      // non può essere nel futuro, e un margine renderebbe i conteggi
      // instabili fra due caricamenti.
      p_a: new Date().toISOString(),
    }),
    supabase
      .from('sessioni')
      .select(
        'session_id, created_at, utm_source, utm_campaign, referrer, landing_page, pagine_viste, dispositivo, citta, paese, convertita'
      )
      .gte('created_at', da.toISOString())
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (error) console.error('Statistiche visite non lette:', error.message)

  const s = (stat ?? {
    sessioni: 0,
    convertite: 0,
    visitatori: 0,
    con_consenso: 0,
    pagine_medie: 0,
    campagne: [],
    pagine: [],
    dispositivi: [],
    citta: [],
  }) as Statistiche

  const sessioni = (recenti ?? []) as SessioneRecente[]

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Amministrazione</p>
        <h1>Visite al sito</h1>
        <p className="muted">
          Da dove arriva chi visita il sito e quali campagne portano richieste. Registrate da
          /api/track sul sito, una riga per sessione.
        </p>
      </div>

      <div className="agenda-barra">
        <div className="agenda-nav">
          {PERIODI.map((p) => (
            <Link
              key={p.chiave}
              className={`btn btn-sm ${p.chiave === periodo.chiave ? '' : 'btn-ghost'}`}
              href={`/dashboard/visite?periodo=${p.chiave}`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="griglia-stat">
        <div className="stat">
          <span className="stat-valore">{s.sessioni}</span>
          <span className="stat-label">Sessioni</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{s.convertite}</span>
          <span className="stat-label">Hanno lasciato una richiesta</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{percentuale(s.convertite, s.sessioni)}</span>
          <span className="stat-label">Tasso di conversione</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{s.pagine_medie}</span>
          <span className="stat-label">Pagine per sessione</span>
        </div>
      </div>

      {s.sessioni === 0 ? (
        <div className="card">
          <p className="vuoto">
            Nessuna sessione in questo periodo. Le visite si registrano da sé appena il sito riceve
            traffico.
          </p>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-head">
              <h2>Campagne e sorgenti</h2>
              <span className="muted">per sessioni</span>
            </div>
            <div className="tabella-wrap">
              <table className="tabella">
                <thead>
                  <tr>
                    <th>Sorgente</th>
                    <th>Mezzo</th>
                    <th>Campagna</th>
                    <th>Sessioni</th>
                    <th>Richieste</th>
                    <th>Conversione</th>
                  </tr>
                </thead>
                <tbody>
                  {s.campagne.map((c, i) => (
                    <tr key={`${c.sorgente}-${c.mezzo}-${c.campagna}-${i}`}>
                      <td>{c.sorgente}</td>
                      <td>{c.mezzo}</td>
                      <td>{c.campagna}</td>
                      <td className="cella-nowrap">{c.sessioni}</td>
                      <td className="cella-nowrap">{c.lead}</td>
                      <td className="cella-nowrap">
                        {c.lead > 0 ? (
                          <span className="badge badge-ok">{percentuale(c.lead, c.sessioni)}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="visite-colonne">
            <div className="card">
              <div className="card-head">
                <h2>Pagine più viste</h2>
              </div>
              <div className="tabella-wrap">
                <table className="tabella">
                  <thead>
                    <tr>
                      <th>Pagina</th>
                      <th>Viste</th>
                      <th>Sessioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.pagine.map((p) => (
                      <tr key={p.pagina}>
                        <td>{p.pagina}</td>
                        <td className="cella-nowrap">{p.viste}</td>
                        <td className="cella-nowrap">{p.sessioni}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Dispositivi e città</h2>
              </div>
              <div className="tabella-wrap">
                <table className="tabella">
                  <tbody>
                    {s.dispositivi.map((d) => (
                      <tr key={d.dispositivo}>
                        <td>{d.dispositivo}</td>
                        <td className="cella-nowrap">{d.sessioni}</td>
                        <td className="cella-nowrap muted">{percentuale(d.sessioni, s.sessioni)}</td>
                      </tr>
                    ))}
                    {s.citta.map((c) => (
                      <tr key={`${c.citta}-${c.paese}`}>
                        <td>
                          {c.citta}
                          <span className="muted"> · {c.paese}</span>
                        </td>
                        <td className="cella-nowrap">{c.sessioni}</td>
                        <td className="cella-nowrap muted">{percentuale(c.sessioni, s.sessioni)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Ultime sessioni</h2>
              <span className="muted">
                {/* Il consenso spiega perché alcune sessioni non hanno un
                    visitatore riconosciuto: senza consenso non generiamo
                    l'identificativo persistente. */}
                {s.con_consenso} su {s.sessioni} con consenso analytics · {s.visitatori}{' '}
                {s.visitatori === 1 ? 'visitatore riconosciuto' : 'visitatori riconosciuti'}
              </span>
            </div>
            <div className="tabella-wrap">
              <table className="tabella">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Sorgente</th>
                    <th>Atterraggio</th>
                    <th>Pagine</th>
                    <th>Dove</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sessioni.map((r) => (
                    <tr key={r.session_id}>
                      <td className="cella-nowrap">{dataOra(r.created_at)}</td>
                      <td>{sorgenteDi(r)}</td>
                      <td>{r.landing_page ?? '—'}</td>
                      <td className="cella-nowrap">{r.pagine_viste}</td>
                      <td className="cella-nowrap">
                        {[r.citta, r.dispositivo].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="cella-nowrap">
                        {r.convertita && <span className="badge badge-ok">richiesta</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  )
}
