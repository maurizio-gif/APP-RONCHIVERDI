import Link from 'next/link'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { caricaTesseramenti, chiaveMotivo, elencoDi, vistaValida } from '@/lib/tesseramenti-elenchi'
import { dataOra } from '@/lib/persone'
import { RiprovaOra } from './RiprovaOra'
import {
  CHIAVE_AUTOMAZIONE_TESSERAMENTO,
  ETICHETTE_MOTIVO,
  ETICHETTE_VISTA,
  MOTIVI_DA_SISTEMARE,
  VISTE,
  vistaDi,
  type MotivoTipo,
  type RigaTesseramento,
  type Vista,
} from '@/lib/tesseramenti'

// Tesseramenti CSI: l'esito del tesseramento automatico. Chi è tesserato con
// numero di tessera e scadenza; chi non lo è con il motivo che dà il CSI (o il
// dato che manca) e quante volte è stato riprovato. Non parte nessuna email:
// la segreteria legge qui e, dove serve, corregge il dato in Info4U o sul
// portale CSI. Il giro di ritentativo ogni due ore (pg_cron) lo riprende da
// solo; chi risulta già tesserato dal portale si riconosce da solo.

type SearchParams = { vista?: string; motivo?: string }

const data = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')
// Il credito del CSI è a tessere: la «quota» è quante ne ha scalate (di norma 1).
const tessere = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('it-IT')} ${n === 1 ? 'tessera' : 'tessere'}`)

export async function VistaAutomazione({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createSupabaseServiceClient()

  const [{ righe, error }, { data: automazione }] = await Promise.all([
    caricaTesseramenti(supabase),
    supabase
      .from('automazioni')
      .select('attiva, attiva_dal')
      .eq('chiave', CHIAVE_AUTOMAZIONE_TESSERAMENTO)
      .maybeSingle(),
  ])

  const conteggi: Record<Vista, number> = { tesserati: 0, da_tesserare: 0, non_tesserabili: 0, in_errore: 0 }
  for (const r of righe) conteggi[vistaDi(r)] += 1

  const vista: Vista = vistaValida(searchParams.vista) ?? 'da_tesserare'
  const nellaVista = elencoDi(righe, vista, null)

  // Il filtro per motivo vale dove il motivo c'è: non tesserabili e in errore.
  const perMotivo = new Map<MotivoTipo | 'attesa', number>()
  if (vista === 'non_tesserabili' || vista === 'in_errore') {
    for (const r of nellaVista) perMotivo.set(chiaveMotivo(r), (perMotivo.get(chiaveMotivo(r)) ?? 0) + 1)
  }
  const motivo =
    searchParams.motivo && perMotivo.has(searchParams.motivo as MotivoTipo | 'attesa') ? searchParams.motivo : null
  const elenco = elencoDi(righe, vista, motivo)

  const daSistemare = conteggi.non_tesserabili + conteggi.in_errore

  const href = (v: Vista, m: string | null = null) => {
    const q = new URLSearchParams({ sezione: 'automazione' })
    if (v !== 'da_tesserare') q.set('vista', v)
    if (m) q.set('motivo', m)
    const s = q.toString()
    return `/dashboard/tesseramenti?${s}`
  }


  return (
    <div>
      <p className="muted">
        L&apos;esito del tesseramento automatico: ogni nuovo abbonamento dei prodotti con tessera viene inviato al server
        nazionale del CSI. Qui vedi chi è stato tesserato, con numero di tessera e scadenza, e chi non lo è con il
        motivo risposto dal CSI. I non tesserati vengono riprovati ogni due ore; non parte nessuna email.
      </p>

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
                {VISTE.map((v) => (
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

            {perMotivo.size > 0 && (
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

            {vista === 'da_tesserare' && (
              <p className="field-hint">
                Pronti per il tesseramento. Con «Sarebbe stato tesserato» la simulazione (test = 1) è andata a buon
                fine: il CSI non ha emesso nessuna tessera né scalato il credito, che succede solo quando
                l&apos;invio diventa reale.
              </p>
            )}
            {vista === 'non_tesserabili' && (
              <p className="field-hint">
                Mancano dati in anagrafica (di solito il luogo di nascita): finché non si completano il CSI non si può
                nemmeno chiamare.
              </p>
            )}
            {vista === 'in_errore' && (
              <p className="field-hint">
                Il CSI ha rifiutato il tesseramento o l&apos;invio è fallito. Il motivo è quello risposto dal CSI.
                Resta vuoto finché il tesseramento non va in reale.
              </p>
            )}

            <div className="check-sosp-operatori">
              <span className="muted">{elenco.length.toLocaleString('it-IT')} persone</span>
              {elenco.length > 0 && (
                <a
                  className="btn btn-sm"
                  href={`/dashboard/tesseramenti/export?vista=${vista}${motivo ? `&motivo=${motivo}` : ''}`}
                  download
                >
                  Esporta CSV
                </a>
              )}
            </div>

            {elenco.length === 0 ? (
              <div className="vuoto-buono">
                <span className="vuoto-glifo" aria-hidden="true">
                  ✓
                </span>
                <p className="vuoto-titolo">
                  {vista === 'tesserati'
                    ? 'Ancora nessun tesserato'
                    : vista === 'in_errore'
                      ? 'Nessun errore'
                      : vista === 'non_tesserabili'
                        ? 'Nessuno con dati mancanti'
                        : 'Nessuno da tesserare'}
                </p>
              </div>
            ) : vista === 'tesserati' ? (
              <TabellaTesserati righe={elenco} />
            ) : (
              <TabellaNonTesserati righe={elenco} vista={vista} />
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
            <th className="cella-importo">Credito usato</th>
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
              <td className="cella-importo cella-nowrap">{tessere(r.quota)}</td>
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

function TabellaNonTesserati({ righe, vista }: { righe: RigaTesseramento[]; vista: Vista }) {
  const prove = vista === 'da_tesserare'
  return (
    <div className="tabella-wrap">
      <table className="tabella tabella-compatta">
        <thead>
          <tr>
            <th>Socio</th>
            <th>Prodotto</th>
            <th>{prove ? 'Esito' : 'Motivo'}</th>
            {prove && <th className="cella-importo">Credito usato</th>}
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
                {r.stato === 'simulato' ? (
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
              {prove && <td className="cella-importo cella-nowrap">{tessere(r.quota)}</td>}
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
