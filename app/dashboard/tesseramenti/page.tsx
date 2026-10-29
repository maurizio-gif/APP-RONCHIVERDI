import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { leggiPaginato } from '@/lib/supabase/leggiPaginato'
import { dataOra } from '@/lib/persone'
import { RiprovaOra } from './RiprovaOra'
import {
  CHIAVE_AUTOMAZIONE_TESSERAMENTO,
  ETICHETTE_MOTIVO,
  ETICHETTE_VISTA,
  MOTIVI_DA_SISTEMARE,
  SEZIONE_TESSERAMENTI,
  VISTE,
  vistaDi,
  type MotivoTipo,
  type RigaTesseramento,
  type Vista,
} from '@/lib/tesseramenti'

export const dynamic = 'force-dynamic'

// Tesseramenti CSI: l'esito del tesseramento automatico. Chi è tesserato con
// numero di tessera e scadenza; chi non lo è con il motivo che dà il CSI (o il
// dato che manca) e quante volte è stato riprovato. Non parte nessuna email:
// la segreteria legge qui e, dove serve, corregge il dato in Info4U o sul
// portale CSI. Il giro di ritentativo ogni due ore (pg_cron) lo riprende da
// solo; chi risulta già tesserato dal portale si riconosce da solo.

type SearchParams = { vista?: string; motivo?: string }

const data = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')
const euro = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 })

export default async function TesseramentiPage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await utenteHaSezione(SEZIONE_TESSERAMENTI))) redirect('/dashboard')

  const supabase = createSupabaseServiceClient()

  const [{ righe, error }, { data: automazione }] = await Promise.all([
    leggiPaginato<RigaTesseramento>((da) =>
      supabase
        .from('tesseramenti_csi')
        .select(
          'id, persona_id, stagione, stato, origine, tessera, quota, rilascio, scadenza, tesserato_il, motivo, motivo_tipo, tentativi, ultimo_tentativo_il, codice_attivita, creato_il, persone(nome, cognome), abbonamenti(abbonamento, variante)'
        )
        .order('aggiornato_il', { ascending: false })
        .order('id', { ascending: false })
        .range(da, da + 999) as unknown as PromiseLike<{
        data: RigaTesseramento[] | null
        error: { message: string } | null
      }>
    ),
    supabase
      .from('automazioni')
      .select('attiva, attiva_dal')
      .eq('chiave', CHIAVE_AUTOMAZIONE_TESSERAMENTO)
      .maybeSingle(),
  ])

  const conteggi: Record<Vista, number> = { tesserati: 0, non_tesserati: 0, prove: 0 }
  for (const r of righe) conteggi[vistaDi(r.stato)] += 1

  const vista: Vista = (VISTE as readonly string[]).includes(searchParams.vista ?? '')
    ? (searchParams.vista as Vista)
    : 'non_tesserati'
  const nellaVista = righe.filter((r) => vistaDi(r.stato) === vista)

  // Il filtro per motivo vale solo fra i non tesserati.
  const perMotivo = new Map<MotivoTipo | 'attesa', number>()
  if (vista === 'non_tesserati') {
    for (const r of nellaVista) perMotivo.set(r.motivo_tipo ?? 'attesa', (perMotivo.get(r.motivo_tipo ?? 'attesa') ?? 0) + 1)
  }
  const motivo = vista === 'non_tesserati' && searchParams.motivo && perMotivo.has(searchParams.motivo as MotivoTipo | 'attesa')
    ? (searchParams.motivo as MotivoTipo | 'attesa')
    : null
  const elenco = motivo ? nellaVista.filter((r) => (r.motivo_tipo ?? 'attesa') === motivo) : nellaVista

  const daSistemare = righe.filter(
    (r) => r.stato === 'non_tesserato' && r.motivo_tipo && MOTIVI_DA_SISTEMARE.includes(r.motivo_tipo)
  ).length

  const href = (v: Vista, m: string | null = null) => {
    const q = new URLSearchParams()
    if (v !== 'non_tesserati') q.set('vista', v)
    if (m) q.set('motivo', m)
    const s = q.toString()
    return `/dashboard/tesseramenti${s ? `?${s}` : ''}`
  }

  const viste = VISTE.filter((v) => v !== 'prove' || conteggi.prove > 0 || vista === 'prove')

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Segreteria</p>
        <h1>Tesseramenti CSI</h1>
        <p className="muted">
          Ogni nuovo abbonamento dei prodotti con tessera viene inviato da solo al server nazionale del CSI. Qui vedi chi
          è tesserato, con numero di tessera e scadenza, e chi non lo è con il motivo risposto dal CSI. I non tesserati
          vengono riprovati ogni due ore; non parte nessuna email.
        </p>
      </div>

      {error && (
        <div className="card">
          <p className="vuoto">
            Non riesco a leggere i tesseramenti: {error.message}. Se manca la tabella, esegui
            scripts/sql/2026-10-29-tesseramento-csi.sql nel SQL Editor di Supabase.
          </p>
        </div>
      )}

      {!error && (
        <>
          <div className="griglia-stat">
            <div className="stat stat-ok">
              <span className="stat-label">Tesserati</span>
              <span className="stat-valore">{conteggi.tesserati.toLocaleString('it-IT')}</span>
              <span className="stat-nota">Con tessera CSI della stagione.</span>
            </div>
            <div className={`stat${daSistemare > 0 ? ' stat-warn' : ''}`}>
              <span className="stat-label">Da sistemare</span>
              <span className="stat-valore">{daSistemare.toLocaleString('it-IT')}</span>
              <span className="stat-nota">Dati mancanti o rifiutati dal CSI.</span>
            </div>
            <div className="stat">
              <span className="stat-label">Automazione</span>
              <span className="stat-valore">{automazione?.attiva ? 'Accesa' : 'Spenta'}</span>
              <span className="stat-nota">
                {automazione?.attiva && automazione.attiva_dal
                  ? `Dalle vendite del ${data(automazione.attiva_dal.slice(0, 10))}.`
                  : 'Non parte nessun tesseramento.'}
              </span>
            </div>
          </div>

          <div className="card">
            <div className="check-sosp-filtri">
              <div className="check-sosp-gruppo" role="group" aria-label="Vista">
                {viste.map((v) => (
                  <Link
                    key={v}
                    href={href(v)}
                    className={`chip${vista === v ? ' is-attivo' : ''}`}
                    aria-current={vista === v ? 'true' : undefined}
                    scroll={false}
                  >
                    {vista === v && (
                      <span className="chip-spunta" aria-hidden="true">
                        ✓
                      </span>
                    )}
                    {ETICHETTE_VISTA[v]} <span className="chip-conteggio">{conteggi[v]}</span>
                  </Link>
                ))}
              </div>
            </div>

            {vista === 'non_tesserati' && perMotivo.size > 0 && (
              <div className="check-sosp-operatori">
                <span className="muted">Motivo:</span>
                <Link href={href(vista)} className={`chip${!motivo ? ' is-attivo' : ''}`} scroll={false}>
                  Tutti
                </Link>
                {Array.from(perMotivo.entries()).map(([m, n]) => (
                  <Link
                    key={m}
                    href={href(vista, m)}
                    className={`chip${motivo === m ? ' is-attivo' : ''}`}
                    scroll={false}
                  >
                    {m === 'attesa' ? 'In attesa del primo invio' : ETICHETTE_MOTIVO[m]}{' '}
                    <span className="chip-conteggio">{n}</span>
                  </Link>
                ))}
              </div>
            )}

            {vista === 'prove' && (
              <p className="field-hint">
                Esiti della simulazione (test = 1): il CSI ha calcolato la quota ma non ha emesso nessuna tessera né
                scalato il credito. Passano a «Tesserati» solo quando l’invio è reale.
              </p>
            )}

            {elenco.length === 0 ? (
              <div className="vuoto-buono">
                <span className="vuoto-glifo" aria-hidden="true">
                  ✓
                </span>
                <p className="vuoto-titolo">
                  {vista === 'tesserati'
                    ? 'Ancora nessun tesserato'
                    : vista === 'prove'
                      ? 'Nessuna prova registrata'
                      : 'Nessuno da tesserare'}
                </p>
              </div>
            ) : vista === 'tesserati' ? (
              <TabellaTesserati righe={elenco} />
            ) : (
              <TabellaNonTesserati righe={elenco} prove={vista === 'prove'} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Socio({ r }: { r: RigaTesseramento }) {
  const nome = [r.persone?.cognome, r.persone?.nome].filter(Boolean).join(' ') || 'Senza nome'
  return <Link href={`/dashboard/persone/${r.persona_id}`}>{nome}</Link>
}

function Prodotto({ r }: { r: RigaTesseramento }) {
  return (
    <>
      {r.abbonamenti?.abbonamento ?? '—'}
      {r.codice_attivita && <span className="nota-in-riga">attività {r.codice_attivita}</span>}
    </>
  )
}

function TabellaTesserati({ righe }: { righe: RigaTesseramento[] }) {
  return (
    <div className="tabella-wrap">
      <table className="tabella tabella-compatta">
        <thead>
          <tr>
            <th>Socio</th>
            <th>Tessera</th>
            <th>Prodotto</th>
            <th>Rilascio</th>
            <th>Scadenza</th>
            <th className="cella-importo">Quota</th>
            <th>Tesserato il</th>
          </tr>
        </thead>
        <tbody>
          {righe.map((r) => (
            <tr key={r.id}>
              <td className="cella-persona">
                <Socio r={r} />
              </td>
              <td className="cella-nowrap">
                <strong>{r.tessera || '—'}</strong>
                <span className="nota-in-riga">stagione {r.stagione}</span>
              </td>
              <td className="cella-troncata">
                <Prodotto r={r} />
              </td>
              <td className="cella-nowrap">{data(r.rilascio)}</td>
              <td className="cella-nowrap">{data(r.scadenza)}</td>
              <td className="cella-importo cella-nowrap">{euro(r.quota)}</td>
              <td className="cella-nowrap">
                {r.tesserato_il ? dataOra(r.tesserato_il) : '—'}
                {r.origine === 'gia_presente' && (
                  <span className="nota-in-riga" title="La tessera esisteva già sul server CSI: emessa dal portale o da un giro precedente.">
                    già presente su CSI
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TabellaNonTesserati({ righe, prove }: { righe: RigaTesseramento[]; prove: boolean }) {
  return (
    <div className="tabella-wrap">
      <table className="tabella tabella-compatta">
        <thead>
          <tr>
            <th>Socio</th>
            <th>Prodotto</th>
            <th>{prove ? 'Esito' : 'Motivo'}</th>
            {prove && <th className="cella-importo">Quota</th>}
            <th className="cella-importo">Tentativi</th>
            <th>Ultimo tentativo</th>
            <th aria-label="Azioni" />
          </tr>
        </thead>
        <tbody>
          {righe.map((r) => (
            <tr key={r.id}>
              <td className="cella-persona">
                <Socio r={r} />
              </td>
              <td className="cella-troncata">
                <Prodotto r={r} />
              </td>
              <td>
                {prove ? (
                  <span className="badge badge-ok">Sarebbe stato tesserato</span>
                ) : r.motivo_tipo ? (
                  <>
                    <span
                      className={`badge ${
                        MOTIVI_DA_SISTEMARE.includes(r.motivo_tipo) ? 'badge-ko' : 'badge-warn'
                      }`}
                    >
                      {ETICHETTE_MOTIVO[r.motivo_tipo]}
                    </span>
                    <span className="nota-in-riga">{r.motivo}</span>
                  </>
                ) : (
                  <span className="badge badge-off">In attesa del primo invio</span>
                )}
              </td>
              {prove && <td className="cella-importo cella-nowrap">{euro(r.quota)}</td>}
              <td className="cella-importo">{r.tentativi}</td>
              <td className="cella-nowrap">{r.ultimo_tentativo_il ? dataOra(r.ultimo_tentativo_il) : '—'}</td>
              <td className="cella-nowrap">
                <RiprovaOra id={r.id} tentativi={r.tentativi} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
