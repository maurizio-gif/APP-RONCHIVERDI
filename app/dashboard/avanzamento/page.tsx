import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getSezioniConsentite, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { dataOra } from '@/lib/agenda'
import { mappaNomiStaff, nomeDiEmail, type RigaStaff } from '@/lib/staff'
import { IconaNuovaScheda } from '@/components/IconaNuovaScheda'
import {
  DELIVERABLE,
  LINK_PROPOSTA,
  PASSI,
  PERSONE,
  PERSONE_TEAM,
  SITUAZIONE_AL,
  calcolaStati,
  dataProposta,
  eDaNominare,
  personaDiEmail,
  trovaPasso,
  type Aggiornamento,
  type ChiavePersona,
  type Passo,
} from '@/lib/avanzamento'
import { PassoAvanzamento, type PassoVista } from './PassoAvanzamento'

export const dynamic = 'force-dynamic'

// Lo stato di avanzamento della proposta di progetto, deliverable per
// deliverable con lo schema del preventivo. I contenuti stanno in
// lib/avanzamento.ts; qui si leggono le spunte e le note dal database.

const CLASSE_TONO = { ok: 'badge-ok', info: 'badge-info', warn: 'badge-warn', error: 'badge-ko', off: 'badge-off' }

export default async function AvanzamentoPage({ searchParams }: { searchParams: { chi?: string } }) {
  if (!(await utenteHaSezione('avanzamento'))) redirect('/dashboard')

  const email = emailCorrente()
  const io = personaDiEmail(email)
  const filtro = PERSONE_TEAM.includes(searchParams.chi as ChiavePersona) ? (searchParams.chi as ChiavePersona) : null

  const supabase = createSupabaseServiceClient()
  const [aggiornamentiRes, staffRes, sezioni] = await Promise.all([
    supabase
      .from('avanzamento_aggiornamenti')
      .select('id, created_at, passo, email, tipo, testo')
      .order('created_at', { ascending: true })
      .limit(1000),
    supabase.from('staff_users').select('email, nome, cognome'),
    getSezioniConsentite(email),
  ])
  // Senza la tabella (migration non ancora eseguita) la pagina si vede lo
  // stesso: solo, non si può ancora spuntare niente.
  const tabellaMancante = !!aggiornamentiRes.error
  if (aggiornamentiRes.error) console.error('avanzamento_aggiornamenti:', aggiornamentiRes.error.message)
  const aggiornamenti = (aggiornamentiRes.data ?? []) as Aggiornamento[]
  const nomi = mappaNomiStaff((staffRes.data ?? []) as RigaStaff[])
  const stati = calcolaStati(aggiornamenti)
  const situazione = dataProposta(SITUAZIONE_AL)

  const tocca = (p: Passo, chi: ChiavePersona) => p.responsabili.includes(chi) || (p.con ?? []).includes(chi)
  const aperti = PASSI.filter((p) => !stati[p.chiave].fatto)
  const daFareOra = aperti.filter((p) => stati[p.chiave].inAttesaDi.length === 0)
  const bloccanti = aperti.filter((p) => p.bloccante)
  const fatti = PASSI.length - aperti.length

  function vista(p: Passo): PassoVista {
    const s = stati[p.chiave]
    return {
      passo: p,
      fatto: s.fatto,
      fattoDa: s.fattoDa ? `${nomeDiEmail(s.fattoDa, nomi)} · ${dataOra(s.fattoIl!)}` : null,
      situazioneAl: situazione,
      inAttesaDi: s.inAttesaDi.map((d) => d.titolo),
      responsabili: p.responsabili.map((r) => ({ nome: PERSONE[r].nome, daNominare: eDaNominare(r, stati) })),
      con: (p.con ?? []).map((c) => PERSONE[c].nome),
      note: s.aggiornamenti.map((a) => ({
        id: a.id,
        chi: nomeDiEmail(a.email, nomi) ?? a.email,
        quando: dataOra(a.created_at),
        tipo: a.tipo,
        testo: a.testo,
      })),
      mio: !!io && p.responsabili.includes(io),
      bloccatoDaTabella: tabellaMancante,
    }
  }

  const ultimi = [...aggiornamenti].reverse().slice(0, 8)

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Direzione</p>
        <h1>Avanzamento progetto</h1>
        <p className="muted">
          I deliverable della{' '}
          <a href={LINK_PROPOSTA} target="_blank" rel="noopener noreferrer" className="link-nuova-scheda">
            proposta di progetto 2026–2027 <IconaNuovaScheda />
          </a>
          , uno per uno: cosa è consegnato, cosa resta da fare e chi lo fa. Quando un passo è fatto, chi ne è
          responsabile lo segna qui con una nota — anche solo «sì, fatto», oppure «non ancora, perché…» — e si
          passa al successivo. Situazione al {situazione}.
        </p>
      </div>

      {tabellaMancante && (
        <p className="error-banner">
          Le spunte non sono ancora attive: manca la migration scripts/sql/2026-10-01-avanzamento-progetto.sql.
        </p>
      )}

      <div className="griglia-stat">
        <div className="stat stat-ok">
          <span className="stat-valore">
            {fatti}/{PASSI.length}
          </span>
          <span className="stat-label">Passi fatti</span>
        </div>
        <div className="stat stat-info">
          <span className="stat-valore">{daFareOra.length}</span>
          <span className="stat-label">Da fare adesso</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{aperti.length - daFareOra.length}</span>
          <span className="stat-label">In attesa di un passo prima</span>
        </div>
        <div className={`stat ${bloccanti.length ? 'stat-error' : ''}`}>
          <span className="stat-valore">{bloccanti.length}</span>
          <span className="stat-label">Bloccanti aperti</span>
        </div>
      </div>

      {bloccanti.length > 0 && (
        <div className="card card-avviso av-blocco">
          <h2 className="card-titolo">Serve una decisione</h2>
          <ul className="av-elenco-semplice">
            {bloccanti.map((p) => (
              <li key={p.chiave}>
                <strong>{p.titolo}</strong> — {p.responsabili.map((r) => PERSONE[r].nome).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="filtri">
        <div className="filtri-testa">
          <span className="filtri-titolo">Chi fa cosa</span>
        </div>
        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
            <legend>Persona</legend>
            <Link className={`btn btn-sm ${filtro ? 'btn-ghost' : ''}`} href="/dashboard/avanzamento">
              Tutti
            </Link>
            {PERSONE_TEAM.map((k) => {
              const n = aperti.filter((p) => tocca(p, k)).length
              return (
                <Link
                  key={k}
                  className={`btn btn-sm ${filtro === k ? '' : 'btn-ghost'}`}
                  aria-current={filtro === k ? 'true' : undefined}
                  href={`/dashboard/avanzamento?chi=${k}`}
                >
                  {PERSONE[k].nome} · {n}
                </Link>
              )
            })}
          </fieldset>
        </div>
      </div>

      <div className="av-deliverable">
        {DELIVERABLE.map((d) => {
          const passi = filtro ? d.passi.filter((p) => tocca(p, filtro)) : d.passi
          if (filtro && passi.length === 0) return null
          const fattiQui = d.passi.filter((p) => stati[p.chiave].fatto).length
          const link = (d.link ?? []).filter((l) => sezioni.includes(l.sezione))
          return (
            <section className={`card av-card av-tono-${d.stato.tono}`} key={d.numero}>
              <div className="av-card-testa">
                <span className="av-numero">{d.numero}</span>
                <div className="av-card-titoli">
                  <h2 className="card-titolo">{d.titolo}</h2>
                  <p className="av-proposta">{d.descrizione}</p>
                  <p className="av-meta">
                    Consegna prevista {dataProposta(d.consegnaPrevista)} · Priorità {d.priorita}
                    {d.passi.length > 0 && ` · ${fattiQui}/${d.passi.length} passi fatti`}
                  </p>
                </div>
                <span className={`badge badge-stato ${CLASSE_TONO[d.stato.tono]}`}>{d.stato.etichetta}</span>
              </div>
              {d.sintesi && <p className="av-sintesi">{d.sintesi}</p>}
              {link.length > 0 && (
                <p className="av-link">
                  {link.map((l) => (
                    <Link key={l.href} href={l.href} className="btn btn-ghost btn-sm">
                      {l.label}
                    </Link>
                  ))}
                </p>
              )}
              {passi.length > 0 ? (
                <ol className="av-passi">
                  {passi.map((p) => (
                    <PassoAvanzamento key={p.chiave} vista={vista(p)} />
                  ))}
                </ol>
              ) : (
                <p className="av-meta">Il suo avanzamento si aggiunge qui quando i lavori partono.</p>
              )}
            </section>
          )
        })}
      </div>

      {ultimi.length > 0 && (
        <div className="card av-ultimi">
          <h2 className="card-titolo">Ultimi aggiornamenti</h2>
          <ul className="av-elenco-semplice">
            {ultimi.map((a) => (
              <li key={a.id}>
                <span className="av-meta">
                  {dataOra(a.created_at)} · {nomeDiEmail(a.email, nomi)}
                </span>{' '}
                {a.tipo === 'fatto' ? 'ha segnato fatto' : a.tipo === 'riaperto' ? 'ha riaperto' : 'ha scritto su'}{' '}
                <strong>{trovaPasso(a.passo)?.titolo ?? a.passo}</strong>
                {a.testo && <> — «{a.testo}»</>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
