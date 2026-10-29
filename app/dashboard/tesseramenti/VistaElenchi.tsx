import Link from 'next/link'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { RiprovaOra } from './RiprovaOra'
import { caricaElenco, chiaveMotivo, elencoDi, vistaDi, vistaValida } from '@/lib/tesseramenti-elenchi'
import { dataOra } from '@/lib/persone'
import {
  CHIAVE_AUTOMAZIONE_TESSERAMENTO,
  ETICHETTE_MOTIVO,
  ETICHETTE_VISTA,
  MOTIVI_DA_SISTEMARE,
  VISTE,
  dataIt,
  descriviTessera,
  type MotivoTipo,
  type RigaElenco,
  type Vista,
} from '@/lib/tesseramenti'

// Tesseramenti CSI: gli elenchi, calcolati al momento (funzione
// tesseramenti_elenco, vedi scripts/sql/2026-10-29-tesseramenti-elenco.sql),
// non la coda del tesseramento automatico:
//
// - Tesserati: chi ha una tessera CSI in corso di validità;
// - Da tesserare: chi ha un abbonamento reale in corso di un prodotto con
//   tessera e non ha la tessera, con i dati a posto;
// - Non tesserabili: stesso caso, ma in anagrafica manca un dato che CSI vuole;
// - In errore: l'ultimo invio a CSI è fallito, con il motivo (si popola quando
//   il tesseramento va in reale).
//
// Ognuno si cerca e si esporta in CSV con quello che si vede a schermo.

type SearchParams = Record<string, string | undefined>

export async function VistaElenchi({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createSupabaseServiceClient()

  const [{ righe, error }, { data: automazione }] = await Promise.all([
    caricaElenco(supabase),
    supabase
      .from('automazioni')
      .select('attiva, attiva_dal')
      .eq('chiave', CHIAVE_AUTOMAZIONE_TESSERAMENTO)
      .maybeSingle(),
  ])

  const conteggi: Record<Vista, number> = { tesserati: 0, da_tesserare: 0, non_tesserabili: 0, in_errore: 0 }
  for (const r of righe) conteggi[vistaDi(r)] += 1

  const vista: Vista = vistaValida(searchParams.vista) ?? 'da_tesserare'
  const q = (searchParams.q ?? '').trim().slice(0, 80)

  // Il filtro per motivo vale dove il motivo c'è: non tesserabili e in errore.
  const perMotivo = new Map<string, number>()
  if (vista === 'non_tesserabili' || vista === 'in_errore') {
    for (const r of elencoDi(righe, vista, null, q)) perMotivo.set(chiaveMotivo(r), (perMotivo.get(chiaveMotivo(r)) ?? 0) + 1)
  }
  const motivo = searchParams.motivo && perMotivo.has(searchParams.motivo) ? searchParams.motivo : null
  const elenco = elencoDi(righe, vista, motivo, q)

  const href = (v: Vista, m: string | null = null) => {
    const p = new URLSearchParams({ sezione: 'elenchi' })
    if (v !== 'da_tesserare') p.set('vista', v)
    if (m) p.set('motivo', m)
    if (q) p.set('q', q)
    return `/dashboard/tesseramenti?${p.toString()}`
  }
  const hrefCsv = (() => {
    const p = new URLSearchParams({ vista })
    if (motivo) p.set('motivo', motivo)
    if (q) p.set('q', q)
    return `/dashboard/tesseramenti/export?${p.toString()}`
  })()

  return (
    <div>
      <p className="muted">
        Gli elenchi si ricalcolano a ogni apertura: chi ha una tessera CSI in corso di validità, e fra chi ha un
        abbonamento reale in corso di un prodotto con tessera, chi la tessera non ce l&apos;ha. Non è la coda di
        invio: se una tessera viene fatta dal portale CSI, la persona passa da sola fra i tesserati entro un&apos;ora.
      </p>

      {error && (
        <div className="card">
          <p className="vuoto">
            Non riesco a leggere gli elenchi: {error.message}. Se manca la funzione, esegui
            scripts/sql/2026-10-29-tesseramenti-elenco.sql nel SQL Editor di Supabase.
          </p>
        </div>
      )}

      {!error && (
        <>
          <div className="griglia-stat">
            <div className="stat stat-ok">
              <span className="stat-label">Tesserati</span>
              <span className="stat-valore">{conteggi.tesserati.toLocaleString('it-IT')}</span>
              <span className="stat-nota">Con tessera CSI in corso di validità.</span>
            </div>
            <div className={`stat${conteggi.da_tesserare > 0 ? ' stat-warn' : ' stat-ok'}`}>
              <span className="stat-label">Da tesserare</span>
              <span className="stat-valore">{conteggi.da_tesserare.toLocaleString('it-IT')}</span>
              <span className="stat-nota">Abbonamento in corso, tessera assente, dati a posto.</span>
            </div>
            <div className={`stat${conteggi.non_tesserabili + conteggi.in_errore > 0 ? ' stat-warn' : ' stat-ok'}`}>
              <span className="stat-label">Da sistemare</span>
              <span className="stat-valore">
                {(conteggi.non_tesserabili + conteggi.in_errore).toLocaleString('it-IT')}
              </span>
              <span className="stat-nota">Dati mancanti in anagrafica o errore di CSI.</span>
            </div>
            <div className="stat">
              <span className="stat-label">Tesseramento automatico</span>
              <span className="stat-valore">{automazione?.attiva ? 'Acceso' : 'Spento'}</span>
              <span className="stat-nota">
                {automazione?.attiva && automazione.attiva_dal
                  ? `Dalle vendite del ${dataIt(automazione.attiva_dal.slice(0, 10))}.`
                  : 'Non parte nessun tesseramento.'}
              </span>
            </div>
          </div>

          <div className="card">
            <form method="get" action="/dashboard/tesseramenti" className="check-sosp-filtri">
              <input type="hidden" name="sezione" value="elenchi" />
              {vista !== 'da_tesserare' && <input type="hidden" name="vista" value={vista} />}
              {motivo && <input type="hidden" name="motivo" value={motivo} />}
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Cognome, nome, codice fiscale o numero di tessera"
                aria-label="Cerca nell'elenco"
                className="input"
                style={{ minWidth: '18rem', flex: '1 1 18rem' }}
              />
              <button type="submit" className="btn">
                Cerca
              </button>
              <div className="check-sosp-gruppo" role="group" aria-label="Elenco">
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
            </form>

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
                    {m === 'attesa' ? 'Senza motivo' : ETICHETTE_MOTIVO[m as MotivoTipo]}{' '}
                    <span className="chip-conteggio">{n}</span>
                  </Link>
                ))}
              </div>
            )}

            {vista === 'da_tesserare' && (
              <p className="field-hint">
                Hanno un abbonamento in corso di un prodotto con tessera e nessuna tessera CSI in corso: sono quelli
                che il tesseramento automatico deve fare.
              </p>
            )}
            {vista === 'non_tesserabili' && (
              <p className="field-hint">
                Hanno l&apos;abbonamento ma in anagrafica manca un dato che CSI richiede (di solito il luogo di
                nascita): finché non si completa non si può nemmeno chiamare CSI.
              </p>
            )}
            {vista === 'in_errore' && (
              <p className="field-hint">
                L&apos;ultimo invio a CSI è fallito: il motivo è quello risposto da CSI. Resta vuoto finché il
                tesseramento non va in reale.
              </p>
            )}

            <div className="check-sosp-operatori">
              <span className="muted">{elenco.length.toLocaleString('it-IT')} persone</span>
              {elenco.length > 0 && (
                <a className="btn btn-sm" href={hrefCsv} download>
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
                  {q
                    ? 'Nessun risultato'
                    : vista === 'tesserati'
                      ? 'Nessun tesserato'
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
              <TabellaDaSistemare righe={elenco} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Socio({ r }: { r: RigaElenco }) {
  const nome = [r.cognome, r.nome].filter(Boolean).join(' ') || 'Senza nome'
  return <Link href={`/dashboard/persone/${r.persona_id}`}>{nome}</Link>
}

function Abbonamento({ r }: { r: RigaElenco }) {
  return (
    <>
      {r.abbonamento ?? '—'}
      {r.data_fine && <span className="nota-in-riga">fino al {dataIt(r.data_fine)}</span>}
    </>
  )
}

function TabellaTesserati({ righe }: { righe: RigaElenco[] }) {
  return (
    <div className="tabella-wrap">
      <table className="tabella tabella-compatta">
        <thead>
          <tr>
            <th>Socio</th>
            <th>Tessera</th>
            <th>Tipo</th>
            <th>Rilascio</th>
            <th>Scadenza</th>
            <th>Abbonamento in corso</th>
          </tr>
        </thead>
        <tbody>
          {righe.map((r) => (
            <tr key={r.persona_id}>
              <td className="cella-persona">
                <Socio r={r} />
              </td>
              <td className="cella-nowrap">
                <strong>{r.tessera || '—'}</strong>
              </td>
              <td className="cella-troncata">
                {descriviTessera({ tipotess: r.tessera_tipo, attivita: [], qualifiche: [] })}
              </td>
              <td className="cella-nowrap">{dataIt(r.tessera_rilascio)}</td>
              <td className="cella-nowrap">{dataIt(r.tessera_scadenza)}</td>
              <td className="cella-troncata">{r.abbonamento ? <Abbonamento r={r} /> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TabellaDaSistemare({ righe }: { righe: RigaElenco[] }) {
  return (
    <div className="tabella-wrap">
      <table className="tabella tabella-compatta">
        <thead>
          <tr>
            <th>Socio</th>
            <th>Abbonamento in corso</th>
            <th>Iscritto dal</th>
            <th>Situazione</th>
            <th className="cella-importo">Tentativi</th>
            <th>Ultimo tentativo</th>
            <th aria-label="Azioni" />
          </tr>
        </thead>
        <tbody>
          {righe.map((r) => (
            <tr key={r.persona_id}>
              <td className="cella-persona">
                <Socio r={r} />
              </td>
              <td className="cella-troncata">
                <Abbonamento r={r} />
              </td>
              <td className="cella-nowrap">{dataIt(r.data_inizio)}</td>
              <td>
                {r.motivo_tipo ? (
                  <>
                    <span
                      className={`badge ${MOTIVI_DA_SISTEMARE.includes(r.motivo_tipo) ? 'badge-ko' : 'badge-warn'}`}
                    >
                      {ETICHETTE_MOTIVO[r.motivo_tipo]}
                    </span>
                    <span className="nota-in-riga">{r.motivo}</span>
                  </>
                ) : (
                  <span className="badge badge-off">Da tesserare</span>
                )}
              </td>
              <td className="cella-importo">{r.tentativi}</td>
              <td className="cella-nowrap">{r.ultimo_tentativo_il ? dataOra(r.ultimo_tentativo_il) : '—'}</td>
              <td className="cella-nowrap">
                {r.riga_id && r.categoria !== 'tesserato' && <RiprovaOra id={r.riga_id} tentativi={r.tentativi} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
