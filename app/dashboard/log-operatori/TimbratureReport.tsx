import Link from 'next/link'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente } from '@/lib/auth/sezioni-server'
import { puoAmministrare, puoCancellare } from '@/lib/auth/permessi'
import {
  accoppiaTurni,
  dataLungaRoma,
  formattaDurata,
  giornoRoma,
  minutiTotali,
  oraRoma,
  type Timbratura,
} from '@/lib/timbratura'
import { CorreggiTimbratura } from './CorreggiTimbratura'

const PERIODI = [
  { chiave: '7', etichetta: '7 giorni', giorni: 7 },
  { chiave: '30', etichetta: '30 giorni', giorni: 30 },
  { chiave: '90', etichetta: '90 giorni', giorni: 90 },
] as const

/** Oltre questa durata un turno è quasi certamente un timbro sbagliato. */
const TURNO_SOSPETTO_MINUTI = 12 * 60

/** Valore per <input type="datetime-local"> nel fuso di Roma. */
function valoreLocale(iso: string): string {
  const d = new Date(iso)
  const data = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
  const ora = d.toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Rome',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${data}T${ora}`
}

export async function TimbratureReport({
  searchParams,
}: {
  searchParams: { periodo?: string; operatore?: string }
}) {
  const periodo = PERIODI.find((p) => p.chiave === searchParams.periodo) ?? PERIODI[1]
  const da = new Date()
  da.setDate(da.getDate() - periodo.giorni)

  const supabase = createSupabaseServiceClient()
  const [{ data: righe }, { data: staff }, amministra, cancella] = await Promise.all([
    supabase
      .from('timbrature')
      .select('id, created_at, email, tipo, distanza_metri')
      .gte('created_at', da.toISOString())
      .order('created_at', { ascending: true }),
    supabase.from('staff_users').select('email, nome, cognome').order('email'),
    puoAmministrare(emailCorrente()),
    puoCancellare(emailCorrente()),
  ])

  const tutte = (righe ?? []) as Timbratura[]
  const filtrate = searchParams.operatore
    ? tutte.filter((t) => t.email === searchParams.operatore)
    : tutte
  const nomi = new Map(
    (staff ?? []).map((s) => [
      s.email as string,
      [s.nome, s.cognome].filter(Boolean).join(' ') || (s.email as string),
    ])
  )

  // Per persona, poi per giorno: le ore si leggono per giornata, e
  // l'accoppiamento entrata/uscita ha senso solo dentro una persona.
  const perPersona = new Map<string, Timbratura[]>()
  for (const t of filtrate) {
    if (!perPersona.has(t.email)) perPersona.set(t.email, [])
    perPersona.get(t.email)!.push(t)
  }

  const oggi = giornoRoma(new Date().toISOString())
  const chiHaTimbrato = [...new Set(tutte.map((t) => t.email))]

  function link(p: { periodo?: string; operatore?: string | null }) {
    const params = new URLSearchParams({ vista: 'timbrature' })
    const operatore = p.operatore === null ? '' : (p.operatore ?? searchParams.operatore ?? '')
    if (operatore) params.set('operatore', operatore)
    params.set('periodo', p.periodo ?? periodo.chiave)
    return `/dashboard/log-operatori?${params.toString()}`
  }

  return (
    <>
      <div className="agenda-barra">
        <div className="agenda-nav">
          {PERIODI.map((p) => (
            <Link
              key={p.chiave}
              className={`btn btn-sm ${p.chiave === periodo.chiave ? '' : 'btn-ghost'}`}
              href={link({ periodo: p.chiave })}
            >
              {p.etichetta}
            </Link>
          ))}
        </div>
        <div className="agenda-nav">
          <Link
            className={`btn btn-sm ${searchParams.operatore ? 'btn-ghost' : ''}`}
            href={link({ operatore: null })}
          >
            Tutti
          </Link>
          {chiHaTimbrato.map((e) => (
            <Link
              key={e}
              className={`btn btn-sm ${searchParams.operatore === e ? '' : 'btn-ghost'}`}
              href={link({ operatore: e })}
            >
              {nomi.get(e) ?? e}
            </Link>
          ))}
        </div>
      </div>

      {perPersona.size === 0 ? (
        <div className="card">
          <p className="vuoto">Nessuna timbratura in questo periodo.</p>
        </div>
      ) : (
        [...perPersona.entries()].map(([email, sue]) => {
          const perGiorno = new Map<string, Timbratura[]>()
          for (const t of sue) {
            const g = giornoRoma(t.created_at)
            if (!perGiorno.has(g)) perGiorno.set(g, [])
            perGiorno.get(g)!.push(t)
          }
          const giorni = [...perGiorno.keys()].sort().reverse()
          const minutiPeriodo = giorni.reduce(
            (s, g) => s + minutiTotali(accoppiaTurni(perGiorno.get(g)!)),
            0
          )

          return (
            <div className="card" key={email}>
              <div className="card-head">
                <div>
                  <h2 style={{ marginBottom: '0.2rem' }}>{nomi.get(email) ?? email}</h2>
                  <p className="muted" style={{ margin: 0, fontSize: 'var(--text-xs)' }}>
                    {email}
                  </p>
                </div>
                <span className="badge">{formattaDurata(minutiPeriodo)} nel periodo</span>
              </div>

              {giorni.map((g) => {
                const turni = accoppiaTurni(perGiorno.get(g)!)
                const minuti = minutiTotali(turni)
                return (
                  <div className="giorno-blocco" key={g}>
                    <div className="giorno-testa">
                      <h3>
                        {dataLungaRoma(g)}
                        {g === oggi && (
                          <span className="badge" style={{ marginLeft: '0.5rem' }}>
                            oggi
                          </span>
                        )}
                      </h3>
                      <span className="muted">{minuti > 0 ? formattaDurata(minuti) : '—'}</span>
                    </div>
                    <div className="tabella-wrap">
                      <table className="tabella">
                        <thead>
                          <tr>
                            <th>Entrata</th>
                            <th>Uscita</th>
                            <th>Durata</th>
                            <th>Nota</th>
                            {amministra && <th />}
                          </tr>
                        </thead>
                        <tbody>
                          {turni.map((t, i) => {
                            const sospetto = t.minuti !== null && t.minuti > TURNO_SOSPETTO_MINUTI
                            return (
                              <tr key={t.entrata?.id ?? t.uscita?.id ?? i}>
                                <td className="cella-nowrap">
                                  {t.entrata ? oraRoma(t.entrata.created_at) : '—'}
                                </td>
                                <td className="cella-nowrap">
                                  {t.uscita ? oraRoma(t.uscita.created_at) : '—'}
                                </td>
                                <td className="cella-nowrap">
                                  {t.minuti !== null ? formattaDurata(t.minuti) : '—'}
                                </td>
                                <td>
                                  {sospetto && (
                                    <span className="badge badge-warn">turno molto lungo</span>
                                  )}
                                  {t.minuti === null &&
                                    (t.entrata && !t.uscita ? (
                                      g === oggi ? (
                                        <span className="badge badge-ok">in servizio</span>
                                      ) : (
                                        <span className="badge badge-warn">uscita mancante</span>
                                      )
                                    ) : (
                                      <span className="badge badge-warn">entrata mancante</span>
                                    ))}
                                </td>
                                {amministra && (
                                  <td className="cella-nowrap">
                                    {/* Si corregge il singolo timbro, non "il
                                        turno": è una riga con le sue
                                        coordinate GPS, e riscriverne due in
                                        blocco nasconderebbe quale era
                                        sbagliata. */}
                                    {t.entrata && (
                                      <CorreggiTimbratura
                                        id={t.entrata.id}
                                        valoreLocale={valoreLocale(t.entrata.created_at)}
                                        puoEliminare={cancella}
                                      />
                                    )}
                                    {t.uscita && (
                                      <CorreggiTimbratura
                                        id={t.uscita.id}
                                        valoreLocale={valoreLocale(t.uscita.created_at)}
                                        puoEliminare={cancella}
                                      />
                                    )}
                                  </td>
                                )}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })
      )}
    </>
  )
}
