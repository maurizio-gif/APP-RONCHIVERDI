import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import {
  accoppiaTurni,
  dataLungaRoma,
  formattaDurata,
  giornoRoma,
  minutiTotali,
  oraRoma,
  prossimoTipo,
  type Timbratura,
} from '@/lib/timbratura'
import { Timbratore } from './Timbratore'

export const dynamic = 'force-dynamic'

// Giorni di storico mostrati: due settimane bastano a ricontrollare un turno
// contestato o a recuperare un'uscita dimenticata, senza far diventare la
// pagina un archivio da scorrere.
const GIORNI_STORICO = 14

export default async function TimbraturaPage() {
  if (!(await utenteHaSezione('timbratura'))) {
    redirect('/dashboard')
  }

  const email = emailCorrente()!
  const supabase = createSupabaseServiceClient()

  const da = new Date()
  da.setDate(da.getDate() - GIORNI_STORICO)

  const { data } = await supabase
    .from('timbrature')
    .select('id, created_at, email, tipo, distanza_metri')
    .eq('email', email)
    .gte('created_at', da.toISOString())
    .order('created_at', { ascending: true })

  const timbrature = (data ?? []) as Timbratura[]

  // L'ultima in assoluto decide se il prossimo tocco è entrata o uscita: un
  // turno a cavallo della mezzanotte non deve proporre una seconda entrata.
  const ultima = timbrature.length ? timbrature[timbrature.length - 1] : null
  const prossimo = prossimoTipo(ultima)

  // Raggruppa per giorno di Roma, dal più recente.
  const perGiorno = new Map<string, Timbratura[]>()
  for (const t of timbrature) {
    const g = giornoRoma(t.created_at)
    if (!perGiorno.has(g)) perGiorno.set(g, [])
    perGiorno.get(g)!.push(t)
  }
  const giorni = [...perGiorno.keys()].sort().reverse()

  const oggi = giornoRoma(new Date().toISOString())
  const minutiOggi = minutiTotali(accoppiaTurni(perGiorno.get(oggi) ?? []))
  const minutiPeriodo = giorni.reduce(
    (somma, g) => somma + minutiTotali(accoppiaTurni(perGiorno.get(g)!)),
    0
  )

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Amministrazione</p>
        <h1>Il tuo cartellino</h1>
        <p className="muted">
          Si timbra dal club: la posizione viene controllata al momento del timbro.
        </p>
      </div>

      <Timbratore prossimo={prossimo} />

      <div className="griglia-stat" style={{ marginTop: '1.5rem' }}>
        <div className="stat">
          <span className="stat-valore">{minutiOggi > 0 ? formattaDurata(minutiOggi) : '—'}</span>
          <span className="stat-label">Ore di oggi</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{minutiPeriodo > 0 ? formattaDurata(minutiPeriodo) : '—'}</span>
          <span className="stat-label">Ultimi {GIORNI_STORICO} giorni</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Turni</h2>
          <span className="muted">ultimi {GIORNI_STORICO} giorni</span>
        </div>

        {giorni.length === 0 ? (
          <p className="vuoto">Nessuna timbratura negli ultimi {GIORNI_STORICO} giorni.</p>
        ) : (
          giorni.map((g) => {
            const turni = accoppiaTurni(perGiorno.get(g)!)
            const minuti = minutiTotali(turni)
            return (
              <div className="giorno-blocco" key={g}>
                <div className="giorno-testa">
                  <h3>
                    {dataLungaRoma(g)}
                    {g === oggi && <span className="badge" style={{ marginLeft: '0.5rem' }}>oggi</span>}
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
                      </tr>
                    </thead>
                    <tbody>
                      {turni.map((t, i) => (
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
                            {/* Un mezzo turno non si nasconde e non si somma:
                                deve saltare all'occhio, perché è quasi sempre
                                una dimenticanza da sistemare. */}
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
