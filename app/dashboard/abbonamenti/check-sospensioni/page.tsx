import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { leggiPaginato } from '@/lib/supabase/leggiPaginato'
import { mappaNomiStaff } from '@/lib/staff'
import { SEZIONE_CHECK_SOSPENSIONI } from '@/lib/sospensioni'
import { caricaMotivi, operatoreInfo4uDi } from '@/lib/sospensioni-server'
import { ElencoSospensioni, type RigaCheck } from './ElencoSospensioni'

export const dynamic = 'force-dynamic'

// Check sospensioni: ogni operatore di segreteria trova le sospensioni che ha
// inserito in Info4U dal 1 settembre 2026 ancora senza motivo, lo scrive e la
// riga esce dall'elenco. Le sospensioni sono le proroghe del registro delle
// azioni di Info4U, e da lì si sa chi le ha inserite: l'utente del CRM è
// collegato al suo nome Info4U da staff_users.operatore_info4u (vedi
// scripts/sql/2026-10-22-check-sospensioni.sql).
//
// Il motivo non si modifica: una correzione è una nota nuova, la rettifica.
// «Tutte» serve a chi coordina e a chi copre un collega assente.

const CHI = ['mie', 'tutti'] as const
type Chi = (typeof CHI)[number]
const STATI = ['da_motivare', 'motivate'] as const
type Stato = (typeof STATI)[number]

type SearchParams = { chi?: string; stato?: string; operatore?: string; mese?: string }

type RigaVista = Omit<RigaCheck, 'motivi'> & { motivata: boolean }

// Il mese in cui la sospensione è stata inserita (AAAA-MM), all'ora di Roma:
// una sospensione di fine mese a tarda sera non deve finire nel mese dopo.
const formatoMese = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit' })
const meseDi = (iso: string) => formatoMese.format(new Date(iso))

const etichettaMese = (m: string) => {
  const testo = new Date(`${m}-15T12:00:00Z`).toLocaleDateString('it-IT', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Rome',
  })
  return testo.charAt(0).toUpperCase() + testo.slice(1)
}

export default async function CheckSospensioniPage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await utenteHaSezione(SEZIONE_CHECK_SOSPENSIONI))) redirect('/dashboard')

  const email = emailCorrente()
  const supabase = createSupabaseServiceClient()
  const [mioOperatore, { data: staff }] = await Promise.all([
    operatoreInfo4uDi(email),
    supabase.from('staff_users').select('email, nome, cognome'),
  ])
  const nomiStaff = mappaNomiStaff(staff ?? [])

  // Chi non è collegato a un operatore Info4U non ha «le sue»: vede tutte.
  const chi: Chi = !mioOperatore ? 'tutti' : searchParams.chi === 'tutti' ? 'tutti' : 'mie'
  const stato: Stato = searchParams.stato === 'motivate' ? 'motivate' : 'da_motivare'

  const { righe: tutte, error } = await leggiPaginato<RigaVista>((da) =>
    supabase
      .from('check_sospensioni')
      .select(
        'source_log_id, data_operazione, operatore_nome, source_iscrizione_id, persona_id, persona_nome, persona_cognome, abbonamento, variante, fine_precedente, fine_nuova, proroga_giorni, motivata'
      )
      .order('data_operazione', { ascending: false })
      .order('source_log_id', { ascending: false })
      .range(da, da + 999)
  )

  // Gli operatori con quante sospensioni hanno da motivare: il riepilogo in
  // «Tutte» e la scelta dell'operatore.
  const perOperatore = new Map<string, { daMotivare: number; motivate: number }>()
  for (const r of tutte) {
    const nome = r.operatore_nome ?? '—'
    const o = perOperatore.get(nome) ?? { daMotivare: 0, motivate: 0 }
    if (r.motivata) o.motivate += 1
    else o.daMotivare += 1
    perOperatore.set(nome, o)
  }
  const operatori = Array.from(perOperatore.entries()).sort(
    (x, y) => y[1].daMotivare - x[1].daMotivare || x[0].localeCompare(y[0], 'it')
  )
  const operatoreScelto =
    chi === 'tutti' && searchParams.operatore && perOperatore.has(searchParams.operatore) ? searchParams.operatore : null

  const dellaPersona = tutte.filter((r) =>
    chi === 'mie' ? r.operatore_nome === mioOperatore : !operatoreScelto || r.operatore_nome === operatoreScelto
  )

  // I mesi in cui ci sono sospensioni (dell'operatore o degli operatori scelti),
  // con quante da motivare e quante motivate: il filtro per mese.
  const perMese = new Map<string, { daMotivare: number; motivate: number }>()
  for (const r of dellaPersona) {
    const m = meseDi(r.data_operazione)
    const o = perMese.get(m) ?? { daMotivare: 0, motivate: 0 }
    if (r.motivata) o.motivate += 1
    else o.daMotivare += 1
    perMese.set(m, o)
  }
  const mesi = Array.from(perMese.entries()).sort((x, y) => y[0].localeCompare(x[0]))
  const meseScelto = searchParams.mese && perMese.has(searchParams.mese) ? searchParams.mese : null

  const nellaVista = meseScelto ? dellaPersona.filter((r) => meseDi(r.data_operazione) === meseScelto) : dellaPersona
  const daMotivare = nellaVista.filter((r) => !r.motivata).length
  const motivate = nellaVista.length - daMotivare
  // Da motivare: le più vecchie in alto, sono le prime da recuperare.
  // Motivate: le più recenti in alto.
  const elencoGrezzo = nellaVista.filter((r) => (stato === 'motivate' ? r.motivata : !r.motivata))
  if (stato === 'da_motivare') elencoGrezzo.reverse()

  const motivi = await caricaMotivi(
    supabase,
    'source_log_id',
    elencoGrezzo.map((r) => r.source_log_id)
  )
  const elenco: RigaCheck[] = elencoGrezzo.map(({ motivata: _motivata, ...r }) => ({
    ...r,
    motivi: motivi[r.source_log_id] ?? [],
  }))

  const href = (p: { chi?: Chi; stato?: Stato; operatore?: string | null; mese?: string | null }) => {
    const ricerca = new URLSearchParams()
    const c = p.chi ?? chi
    const s = p.stato ?? stato
    const o = p.operatore === undefined ? operatoreScelto : p.operatore
    const m = p.mese === undefined ? meseScelto : p.mese
    if (c !== 'mie' && mioOperatore) ricerca.set('chi', c)
    if (s !== 'da_motivare') ricerca.set('stato', s)
    if (c === 'tutti' && o) ricerca.set('operatore', o)
    if (m) ricerca.set('mese', m)
    const q = ricerca.toString()
    return `/dashboard/abbonamenti/check-sospensioni${q ? `?${q}` : ''}`
  }

  const totaleDaMotivare = tutte.filter((r) => !r.motivata).length

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Segreteria</p>
        <h1>Check sospensioni</h1>
        <p className="muted">
          Le sospensioni inserite in Info4U dal 1° settembre 2026. Per ognuna scrivi il motivo (malattia, trasferimento,
          altro) e quale giustificativo hai ricevuto. Una volta salvato il motivo non si modifica: se c’è da
          correggere, aggiungi una rettifica.
        </p>
      </div>

      {error && (
        <div className="card">
          <p className="vuoto">
            Non riesco a leggere le sospensioni: {error.message}. Se manca la vista, esegui
            scripts/sql/2026-10-22-check-sospensioni.sql nel SQL Editor di Supabase.
          </p>
        </div>
      )}

      {!error && (
        <>
          <div className="griglia-stat">
            <div className={`stat${daMotivare > 0 ? ' stat-warn' : ' stat-ok'}`}>
              <span className="stat-label">
                {chi === 'mie' ? 'Tue da motivare' : operatoreScelto ? `Da motivare · ${operatoreScelto}` : 'Da motivare, tutti'}
              </span>
              <span className="stat-valore">{daMotivare.toLocaleString('it-IT')}</span>
              <span className="stat-nota">
                {daMotivare === 0 ? 'Niente da fare.' : 'Sospensioni senza ancora un motivo scritto.'}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Motivate</span>
              <span className="stat-valore">{motivate.toLocaleString('it-IT')}</span>
              <span className="stat-nota">Con almeno una nota sul motivo.</span>
            </div>
            {chi === 'mie' && (
              <div className="stat">
                <span className="stat-label">Da motivare, tutti</span>
                <span className="stat-valore">{totaleDaMotivare.toLocaleString('it-IT')}</span>
                <span className="stat-nota">
                  <Link href={href({ chi: 'tutti', stato: 'da_motivare', operatore: null })}>Vedi tutte</Link>
                </span>
              </div>
            )}
          </div>

          <div className="card">
            <div className="check-sosp-filtri">
              {mioOperatore && (
                <div className="check-sosp-gruppo" role="group" aria-label="Di chi">
                  {CHI.map((c) => (
                    <Link
                      key={c}
                      href={href({ chi: c, operatore: null })}
                      className={`chip${chi === c ? ' is-attivo' : ''}`}
                      aria-current={chi === c ? 'true' : undefined}
                      scroll={false}
                    >
                      {chi === c && (
                        <span className="chip-spunta" aria-hidden="true">
                          ✓
                        </span>
                      )}
                      {c === 'mie' ? 'Le mie' : 'Tutte'}
                    </Link>
                  ))}
                </div>
              )}
              <div className="check-sosp-gruppo" role="group" aria-label="Stato">
                {STATI.map((s) => (
                  <Link
                    key={s}
                    href={href({ stato: s })}
                    className={`chip${stato === s ? ' is-attivo' : ''}`}
                    aria-current={stato === s ? 'true' : undefined}
                    scroll={false}
                  >
                    {stato === s && (
                      <span className="chip-spunta" aria-hidden="true">
                        ✓
                      </span>
                    )}
                    {s === 'da_motivare' ? 'Da motivare' : 'Motivate'}{' '}
                    <span className="chip-conteggio">{s === 'da_motivare' ? daMotivare : motivate}</span>
                  </Link>
                ))}
              </div>
            </div>

            {mesi.length > 1 && (
              <div className="check-sosp-operatori">
                <span className="muted">Mese:</span>
                <Link
                  href={href({ mese: null })}
                  className={`chip${!meseScelto ? ' is-attivo' : ''}`}
                  scroll={false}
                >
                  Tutti
                </Link>
                {mesi.map(([m, o]) => (
                  <Link
                    key={m}
                    href={href({ mese: m })}
                    className={`chip${meseScelto === m ? ' is-attivo' : ''}`}
                    title={`${o.daMotivare} da motivare, ${o.motivate} motivate`}
                    aria-current={meseScelto === m ? 'true' : undefined}
                    scroll={false}
                  >
                    {etichettaMese(m)}{' '}
                    <span className="chip-conteggio">{stato === 'da_motivare' ? o.daMotivare : o.motivate}</span>
                  </Link>
                ))}
              </div>
            )}

            {chi === 'tutti' && operatori.length > 0 && (
              <div className="check-sosp-operatori">
                <span className="muted">Operatore:</span>
                <Link
                  href={href({ operatore: null })}
                  className={`chip${!operatoreScelto ? ' is-attivo' : ''}`}
                  scroll={false}
                >
                  Tutti
                </Link>
                {operatori.map(([nome, o]) => (
                  <Link
                    key={nome}
                    href={href({ operatore: nome })}
                    className={`chip${operatoreScelto === nome ? ' is-attivo' : ''}`}
                    title={`${o.daMotivare} da motivare, ${o.motivate} motivate`}
                    scroll={false}
                  >
                    {nome} <span className="chip-conteggio">{o.daMotivare}</span>
                  </Link>
                ))}
              </div>
            )}

            {!mioOperatore && (
              <p className="field-hint">
                Il tuo utente non è collegato a un operatore di Info4U: vedi le sospensioni di tutti.
              </p>
            )}

            {elenco.length === 0 ? (
              <div className="vuoto-buono">
                <span className="vuoto-glifo" aria-hidden="true">
                  ✓
                </span>
                <p className="vuoto-titolo">
                  {stato === 'da_motivare' ? 'Nessuna sospensione da motivare' : 'Ancora nessuna sospensione motivata'}
                </p>
              </div>
            ) : (
              <ElencoSospensioni
                righe={elenco}
                nomiStaff={nomiStaff}
                mostraOperatore={chi === 'tutti'}
                daMotivare={stato === 'da_motivare'}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
