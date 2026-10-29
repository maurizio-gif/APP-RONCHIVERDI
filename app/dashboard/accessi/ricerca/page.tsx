import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { oggiRoma } from '@/lib/agenda'
import {
  ScriptAccessiMancante,
  caricaGruppiAccessi,
  caricaVarchi,
  personeDegliUtenti,
  presenzeDiUnUtente,
  ricercaAccessi,
  risolviRicerca,
  type ParametriRicerca,
} from '@/lib/accessi-server'
import { COLORE_SENZA_GRUPPO, ESITI_PASSAGGIO, PRESET, chiaveVarco, etichettaIntervallo, numero } from '@/lib/accessi'
import { dataBreve, dataOra, nomePersona } from '@/lib/persone'
import { NavAccessi } from '../NavAccessi'

export const dynamic = 'force-dynamic'

const PER_PAGINA = 50

// La ricerca sugli accessi: periodo, persona, gruppo o singolo varco, esito.
// Tutto passa dall'URL (un form GET), quindi una ricerca si condivide e si
// riapre; l'esportazione CSV usa gli stessi filtri (vedi risolviRicerca).
export default async function RicercaAccessiPage({ searchParams }: { searchParams: ParametriRicerca }) {
  if (!(await utenteHaSezione('accessi'))) redirect('/dashboard')

  const db = createSupabaseServiceClient()
  let ricerca
  try {
    const [gruppi, varchi] = await Promise.all([caricaGruppiAccessi(db), caricaVarchi(db)])
    ricerca = { gruppi, varchi, risolta: await risolviRicerca(db, searchParams, oggiRoma(), varchi, gruppi) }
  } catch (e) {
    if (e instanceof ScriptAccessiMancante) {
      return (
        <>
          <div className="page-head">
            <h1>Accessi</h1>
          </div>
          <div className="card card-avviso">
            <p className="card-nota">{e.message}</p>
          </div>
        </>
      )
    }
    throw e
  }
  const { gruppi, varchi, risolta } = ricerca
  const { periodo, filtri, persona, candidate, nessunaPersona } = risolta

  const pagina = Math.max(1, Number.parseInt(searchParams.p ?? '1', 10) || 1)
  // Si cerca solo quando la persona è chiara: con più candidate si sceglie prima.
  const daCercare = candidate.length === 0 && !nessunaPersona
  const [esiti, risultati, presenze] = await Promise.all([
    db.from('esiti_accesso').select('numero_esito, descrizione'),
    daCercare ? ricercaAccessi(db, filtri, (pagina - 1) * PER_PAGINA, PER_PAGINA) : Promise.resolve({ righe: [], ceAltro: false }),
    persona?.utente != null ? presenzeDiUnUtente(db, persona.utente, periodo.dal, periodo.al) : Promise.resolve(null),
  ])
  const nomeEsito = new Map((esiti.data ?? []).map((e) => [e.numero_esito as number, e.descrizione as string]))
  const persone = await personeDegliUtenti(db, risultati.righe.map((r) => r.utente).filter((u): u is number => u != null))
  const varcoDi = new Map(varchi.map((v) => [v.chiave, v]))
  const gruppoDi = new Map(gruppi.map((g) => [g.id, g]))

  const parametriBase = (extra: Record<string, string | undefined> = {}) => {
    const q = new URLSearchParams()
    const tutti: Record<string, string | undefined> = {
      ...(searchParams.periodo ? { periodo: searchParams.periodo } : { dal: periodo.dal, al: periodo.al }),
      q: searchParams.q,
      persona: persona?.id ?? searchParams.persona,
      varco: risolta.varcoScelto ?? undefined,
      gruppo: risolta.gruppoScelto ?? undefined,
      esito: filtri.esito === 'ammessi' ? undefined : filtri.esito,
      ...extra,
    }
    for (const [k, v] of Object.entries(tutti)) if (v) q.set(k, v)
    return q.toString()
  }
  const presetHref = (chiave: string) => {
    const q = new URLSearchParams()
    const altri: Record<string, string | undefined> = {
      periodo: chiave,
      q: searchParams.q,
      persona: persona?.id ?? searchParams.persona,
      varco: risolta.varcoScelto ?? undefined,
      gruppo: risolta.gruppoScelto ?? undefined,
      esito: filtri.esito === 'ammessi' ? undefined : filtri.esito,
    }
    for (const [k, v] of Object.entries(altri)) if (v) q.set(k, v)
    return `/dashboard/accessi/ricerca?${q.toString()}`
  }

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Report</p>
        <h1>Accessi</h1>
        <p className="muted">Cerca i passaggi ai varchi per periodo, persona, gruppo o singolo varco.</p>
        <NavAccessi attiva="ricerca" />
      </div>

      <div className="card">
        <form method="get" className="accessi-ricerca">
          <label>
            <span className="muted">Dal</span>
            <input type="date" name="dal" defaultValue={periodo.dal} min="2023-01-01" />
          </label>
          <label>
            <span className="muted">Al</span>
            <input type="date" name="al" defaultValue={periodo.al} />
          </label>
          <label className="accessi-ricerca-persona">
            <span className="muted">Persona (nome, cognome, email, cellulare o n. utente)</span>
            <input type="search" name="q" defaultValue={persona ? nomePersona(persona) : searchParams.q ?? ''} placeholder="Tutti i soci" />
          </label>
          <label>
            <span className="muted">Gruppo di varchi</span>
            <select name="gruppo" defaultValue={risolta.gruppoScelto ?? ''}>
              <option value="">Tutti</option>
              {gruppi.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nome}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="muted">Singolo varco</span>
            <select name="varco" defaultValue={risolta.varcoScelto ?? ''}>
              <option value="">Tutti</option>
              {varchi.map((v) => (
                <option key={v.chiave} value={v.chiave}>
                  {v.descrizione}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="muted">Esito</span>
            <select name="esito" defaultValue={filtri.esito}>
              <option value="ammessi">Ingressi ammessi</option>
              <option value="negati">Ingressi negati</option>
              <option value="tutti">Tutti</option>
            </select>
          </label>
          <button type="submit" className="btn">
            Cerca
          </button>
        </form>
        <div className="agenda-nav accessi-ricerca-preset">
          <span className="muted">Periodo veloce:</span>
          {PRESET.map((p) => (
            <Link key={p.chiave} href={presetHref(p.chiave)} className={`btn btn-sm ${periodo.preset === p.chiave ? '' : 'btn-ghost'}`}>
              {p.etichetta}
            </Link>
          ))}
        </div>
      </div>

      {nessunaPersona && (
        <div className="card">
          <p className="vuoto">Nessuna persona corrisponde a «{searchParams.q}».</p>
        </div>
      )}

      {candidate.length > 1 && (
        <div className="card">
          <div className="card-head">
            <h2>Quale persona?</h2>
            <span className="muted">{candidate.length === 20 ? 'prime 20 corrispondenze' : `${candidate.length} corrispondenze`}</span>
          </div>
          <ul className="storia">
            {candidate.map((c) => (
              <li key={c.id}>
                <Link href={`/dashboard/accessi/ricerca?${parametriBase({ persona: c.id, q: undefined, p: undefined })}`} className="link">
                  {nomePersona(c)}
                </Link>{' '}
                <span className="muted">{[c.email, c.cellulare, c.utente != null && `n. ${c.utente}`].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {daCercare && (
        <div className="card">
          <div className="card-head">
            <h2>
              {persona ? (
                <>
                  <Link href={`/dashboard/persone/${persona.id}`} className="link">
                    {nomePersona(persona)}
                  </Link>
                </>
              ) : (
                'Passaggi'
              )}
            </h2>
            <span className="muted">{etichettaIntervallo(periodo.dal, periodo.al)}</span>
          </div>

          {presenze && (
            <p className="accessi-ricerca-sintesi">
              <strong>{numero(presenze.giorni)}</strong> {presenze.giorni === 1 ? 'giorno' : 'giorni'} di presenza nel periodo
              {presenze.primo && presenze.ultimo && (
                <span className="muted">
                  {' '}
                  · dal {dataBreve(presenze.primo)} al {dataBreve(presenze.ultimo)}
                </span>
              )}
            </p>
          )}
          {persona && persona.utente == null && <p className="vuoto">Questa persona non ha un numero utente Info4U: non ha accessi.</p>}

          {risultati.righe.length === 0 ? (
            <p className="vuoto">Nessun passaggio con questi filtri.</p>
          ) : (
            <>
              <div className="tabella-wrap">
                <table className="tabella">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      {!persona && <th>Persona</th>}
                      <th>Varco</th>
                      <th>Esito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {risultati.righe.map((r) => {
                      const v = varcoDi.get(r.varcoChiave)
                      const g = v?.gruppoId ? gruppoDi.get(v.gruppoId) : undefined
                      const p = r.utente != null ? persone.get(r.utente) : undefined
                      const ammesso = ESITI_PASSAGGIO.includes(r.esito)
                      return (
                        <tr key={r.id}>
                          <td className="cella-nowrap">{dataOra(r.quando)}</td>
                          {!persona && (
                            <td>
                              {p ? (
                                <Link href={`/dashboard/persone/${p.id}`} className="link">
                                  {p.nome}
                                </Link>
                              ) : (
                                <span className="muted">{r.utente != null ? `Utente ${r.utente}` : 'Nessuna persona'}</span>
                              )}
                            </td>
                          )}
                          <td>
                            {v?.descrizione ?? `Varco ${r.varcoChiave}`}
                            {g && (
                              <span className="accessi-chip">
                                <i className="accessi-pallino" style={{ background: g.colore ?? COLORE_SENZA_GRUPPO }} /> {g.nome}
                              </span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${ammesso ? 'badge-ok' : r.esito < 0 ? 'badge-ko' : ''}`}>
                              {nomeEsito.get(r.esito) ?? `Esito ${r.esito}`}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="accessi-paginazione">
                {pagina > 1 ? (
                  <Link className="btn btn-sm btn-ghost" href={`/dashboard/accessi/ricerca?${parametriBase({ p: String(pagina - 1) })}`}>
                    ← Più recenti
                  </Link>
                ) : (
                  <span />
                )}
                <span className="muted">
                  Passaggi {(pagina - 1) * PER_PAGINA + 1}–{(pagina - 1) * PER_PAGINA + risultati.righe.length}
                </span>
                {risultati.ceAltro ? (
                  <Link className="btn btn-sm btn-ghost" href={`/dashboard/accessi/ricerca?${parametriBase({ p: String(pagina + 1) })}`}>
                    Più vecchi →
                  </Link>
                ) : (
                  <span />
                )}
              </div>
              <p className="card-nota">
                <a className="link" href={`/dashboard/accessi/ricerca/export?${parametriBase({ p: undefined })}`}>
                  Scarica in CSV
                </a>{' '}
                <span className="muted">(fino a 20.000 passaggi, con gli stessi filtri)</span>
              </p>
            </>
          )}
        </div>
      )}
    </>
  )
}
