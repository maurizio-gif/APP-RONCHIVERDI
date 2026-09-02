import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import {
  ETICHETTE_TIPO_BREVI,
  dataLunga,
  giornoPiu,
  intervalloOrario,
  lunediDi,
  oggiRoma,
  perGiorno,
  voceDaContatto,
  voceDaTask,
  type VoceAgenda,
} from '@/lib/agenda'
import { ATTIVITA_IN_AGENDA } from '@/lib/richieste'
import { NuovaVoce } from './NuovaVoce'
import { AzioniVoce } from './AzioniVoce'

export const dynamic = 'force-dynamic'

// Una settimana per volta: è l'orizzonte con cui la segreteria lavora, e con
// sette giorni in pagina non serve un calendario mensile da navigare.
const GIORNI_MOSTRATI = 7

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: { da?: string; solo?: string }
}) {
  if (!(await utenteHaSezione('agenda'))) {
    redirect('/dashboard')
  }

  const oggi = oggiRoma()
  const daRichiesto = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.da ?? '') ? searchParams.da! : oggi
  // Ci si allinea sempre al lunedì: una settimana che comincia di giovedì
  // rende impossibile confrontare due schermate.
  const inizio = lunediDi(daRichiesto)
  const fine = giornoPiu(inizio, GIORNI_MOSTRATI - 1)

  const soloAppuntamenti = searchParams.solo === 'appuntamenti'
  const soloMie = searchParams.solo === 'mie'
  const email = emailCorrente()

  const supabase = createSupabaseServiceClient()
  const [{ data: task }, { data: contatti }] = await Promise.all([
    supabase
      .from('task')
      .select('id, titolo, tipo, data, ora, durata_minuti, stato, note, assegnato_a')
      .gte('data', inizio)
      .lte('data', fine),
    supabase
      .from('form_contatti')
      .select(
        'id, azione, data_scelta, ora_scelta, nome, cognome, email, cellulare, attivita_label, messaggio, gestito'
      )
      .gte('data_scelta', inizio)
      .lte('data_scelta', fine)
      // Solo Club e Family: sono le richieste che passano dalla segreteria e
      // che hanno un appuntamento da tenere. Le altre vanno diritte al
      // responsabile del corso e vivono nella sua sezione (lib/richieste.ts),
      // non in questo calendario.
      .in('attivita', ATTIVITA_IN_AGENDA),
  ])

  let voci: VoceAgenda[] = [
    ...(task ?? []).map(voceDaTask),
    ...(contatti ?? []).map(voceDaContatto).filter((v): v is VoceAgenda => v !== null),
  ]

  // Le voci annullate restano fuori dalla vista normale: sono lì per storia,
  // non per lavorarle.
  voci = voci.filter((v) => v.stato !== 'annullato')
  if (soloAppuntamenti) voci = voci.filter((v) => v.ora !== null)
  if (soloMie) voci = voci.filter((v) => v.assegnatoA === email || v.origine === 'form_contatti')

  const raggruppate = perGiorno(voci)
  const giorni = Array.from({ length: GIORNI_MOSTRATI }, (_, i) => giornoPiu(inizio, i))

  const daFare = voci.filter((v) => v.daFare).length
  const appuntamenti = voci.filter((v) => v.ora !== null).length

  // Per il datalist del form: chi può essere assegnatario di una voce.
  const { data: staff } = await supabase.from('staff_users').select('email').order('email')
  const operatori = (staff ?? []).map((s) => s.email as string)

  function linkSettimana(offset: number) {
    const params = new URLSearchParams()
    params.set('da', giornoPiu(inizio, offset * GIORNI_MOSTRATI))
    if (searchParams.solo) params.set('solo', searchParams.solo)
    return `/dashboard/agenda?${params.toString()}`
  }

  function linkFiltro(valore: string | null) {
    const params = new URLSearchParams()
    params.set('da', inizio)
    if (valore) params.set('solo', valore)
    return `/dashboard/agenda?${params.toString()}`
  }

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Agenda</p>
        <h1>Settimana del {dataLunga(inizio)}</h1>
        <p className="muted">
          Appuntamenti prenotati dal sito e cose da fare della segreteria, nello stesso calendario.
        </p>
      </div>

      <div className="agenda-barra">
        <div className="agenda-nav">
          <Link className="btn btn-ghost btn-sm" href={linkSettimana(-1)}>
            ← Settimana prima
          </Link>
          <Link className="btn btn-ghost btn-sm" href={linkFiltro(searchParams.solo ?? null).replace(inizio, oggi)}>
            Oggi
          </Link>
          <Link className="btn btn-ghost btn-sm" href={linkSettimana(1)}>
            Settimana dopo →
          </Link>
        </div>
        <div className="agenda-nav">
          <Link className={`btn btn-sm ${searchParams.solo ? 'btn-ghost' : ''}`} href={linkFiltro(null)}>
            Tutto
          </Link>
          <Link
            className={`btn btn-sm ${soloAppuntamenti ? '' : 'btn-ghost'}`}
            href={linkFiltro('appuntamenti')}
          >
            Solo con orario
          </Link>
          <Link className={`btn btn-sm ${soloMie ? '' : 'btn-ghost'}`} href={linkFiltro('mie')}>
            Le mie
          </Link>
        </div>
      </div>

      <div className="griglia-stat">
        <div className="stat">
          <span className="stat-valore">{appuntamenti}</span>
          <span className="stat-label">Con orario, questa settimana</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{daFare}</span>
          <span className="stat-label">Ancora da fare</span>
        </div>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <NuovaVoce giornoPredefinito={daRichiesto >= oggi ? daRichiesto : oggi} operatori={operatori} />
      </div>

      {giorni.map((g) => {
        const delGiorno = raggruppate.get(g) ?? []
        return (
          <div className={`card agenda-giorno${g === oggi ? ' is-oggi' : ''}`} key={g}>
            <div className="card-head">
              <h2 className="agenda-giorno-titolo">
                {dataLunga(g)}
                {g === oggi && <span className="badge" style={{ marginLeft: '0.5rem' }}>oggi</span>}
              </h2>
              <span className="muted">
                {delGiorno.length === 0
                  ? 'niente in programma'
                  : `${delGiorno.length} ${delGiorno.length === 1 ? 'voce' : 'voci'}`}
              </span>
            </div>

            {delGiorno.length > 0 && (
              <ul className="voci">
                {delGiorno.map((v) => (
                  <li className={`voce${v.daFare ? '' : ' is-fatta'}`} key={v.chiave}>
                    <span className="voce-ora">
                      {intervalloOrario(v.ora, v.durataMinuti) ?? 'in giornata'}
                    </span>
                    <span className="voce-corpo">
                      <span className="voce-titolo">
                        {v.titolo}
                        <span className="badge badge-off" style={{ marginLeft: '0.5rem' }}>
                          {ETICHETTE_TIPO_BREVI[v.tipo]}
                        </span>
                        {v.origine === 'form_contatti' && (
                          <span className="badge" style={{ marginLeft: '0.35rem' }}>
                            dal sito
                          </span>
                        )}
                        {!v.daFare && (
                          <span className="badge badge-ok" style={{ marginLeft: '0.35rem' }}>
                            fatto
                          </span>
                        )}
                      </span>
                      {v.note && <span className="voce-note muted">{v.note}</span>}
                      {v.assegnatoA && (
                        <span className="voce-note muted">
                          {v.assegnatoA === email ? 'assegnata a te' : v.assegnatoA}
                        </span>
                      )}
                    </span>
                    <AzioniVoce voce={v} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </>
  )
}
