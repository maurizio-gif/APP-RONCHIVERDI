import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { euro } from '@/lib/pipeline'
import { etichettaMese, mesePiu, oggiRoma, primoDelMese, ultimoDelMese } from '@/lib/agenda'
import { PRIMO_MESE_DATI } from '@/lib/incassato'
import {
  CATEGORIE,
  ETICHETTE_CATEGORIA,
  applicaFiltri,
  caricaRettifiche,
  causalePulita,
  leggiFiltriRettifiche,
  parametriRettifiche,
  type Categoria,
  type Rettifica,
} from '@/lib/rettifiche'

export const dynamic = 'force-dynamic'

type SearchParams = {
  mese?: string
  categoria?: string
  operatore?: string
  mesediverso?: string
  noncollegate?: string
  zero?: string
  pagina?: string
}

const eur = (n: number) => euro(n) ?? '—'
const PAGINA = 100

function Importo({ valore }: { valore: number }) {
  return <span className={valore < 0 ? 'importo-neg' : undefined}>{eur(valore)}</span>
}

function dataOra(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type Somma = { n: number; importo: number }
const somma = (righe: Rettifica[]): Somma => ({
  n: righe.length,
  importo: Math.round(righe.reduce((s, r) => s + r.importo, 0) * 100) / 100,
})

export default async function EliminazioniStorniPage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await utenteHaSezione('incassato'))) redirect('/dashboard')

  const richiesto = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.mese ?? '') ? primoDelMese(searchParams.mese!) : primoDelMese(oggiRoma())
  const mese = richiesto < PRIMO_MESE_DATI ? PRIMO_MESE_DATI : richiesto
  const primo = mese
  const ultimo = ultimoDelMese(mese)
  const filtri = leggiFiltriRettifiche(searchParams)
  const base = parametriRettifiche(filtri)

  const supabase = createSupabaseServiceClient()
  const { righe: tutte, errore } = await caricaRettifiche(supabase, primo, ultimo)

  const hrefPagina = (extra: Record<string, string | null> = {}, meseDi = mese) => {
    const p: Record<string, string> = { mese: meseDi, ...base }
    for (const [k, v] of Object.entries(extra)) {
      if (v === null) delete p[k]
      else p[k] = v
    }
    return `/dashboard/incassato/eliminazioni?${new URLSearchParams(p).toString()}`
  }

  if (errore) {
    return (
      <div>
        <Testata mese={mese} />
        <div className="card">
          <p className="vuoto">
            Non riesco a leggere le rettifiche: {errore}. Se la vista non esiste, esegui
            scripts/sql/2026-10-07-rettifiche-cassa.sql nel SQL Editor di Supabase.
          </p>
        </div>
      </div>
    )
  }

  // Importi a zero: omaggi e vendite gratuite, si contano ma non si mostrano
  // di default (sono circa un quarto delle righe e non muovono denaro).
  const conImporto = tutte.filter((r) => r.importo !== 0)
  const zeri = tutte.length - conImporto.length
  const perCategoria = new Map<Categoria, Somma>(
    CATEGORIE.map((c) => [c, somma(conImporto.filter((r) => r.categoria === c))])
  )
  const totale = somma(conImporto)
  const eliminazioni = perCategoria.get('eliminazione')!
  const ripristini = perCategoria.get('ripristino')!
  // «Eliminato davvero»: eliminazioni al netto dei ripristini. Un'eliminazione
  // seguita da un ripristino è una modifica di vendita, non una perdita.
  const nettoEliminato = Math.round((eliminazioni.importo + ripristini.importo) * 100) / 100
  const altroMese = somma(conImporto.filter((r) => r.mese_diverso))
  const nonCollegate = somma(conImporto.filter((r) => r.categoria === 'eliminazione' && r.storno_di === null))

  // Per operatore: chi ha fatto le rettifiche, e quante di rettifica pura.
  const operatori = new Map<string, Record<Categoria, Somma> & { totale: Somma }>()
  for (const r of conImporto) {
    const nome = r.operatore_nome ?? '—'
    let o = operatori.get(nome)
    if (!o) {
      o = {
        eliminazione: { n: 0, importo: 0 },
        ripristino: { n: 0, importo: 0 },
        storno_rata: { n: 0, importo: 0 },
        storno_altro: { n: 0, importo: 0 },
        totale: { n: 0, importo: 0 },
      }
      operatori.set(nome, o)
    }
    o[r.categoria].n += 1
    o[r.categoria].importo = Math.round((o[r.categoria].importo + r.importo) * 100) / 100
    o.totale.n += 1
    o.totale.importo = Math.round((o.totale.importo + r.importo) * 100) / 100
  }
  const operatoriOrdinati = Array.from(operatori.entries()).sort((a, b) => a[1].totale.importo - b[1].totale.importo)

  // Per metodo di pagamento dell'incasso rettificato.
  const metodi = new Map<string, Somma>()
  for (const r of conImporto) {
    const m = r.originale_metodo ?? r.metodo_pagamento ?? 'Nessun metodo'
    const s = metodi.get(m) ?? { n: 0, importo: 0 }
    s.n += 1
    s.importo = Math.round((s.importo + r.importo) * 100) / 100
    metodi.set(m, s)
  }
  const metodiOrdinati = Array.from(metodi.entries()).sort((a, b) => a[1].importo - b[1].importo)

  const filtrate = applicaFiltri(tutte, filtri)
  const pagina = Math.max(1, Number(searchParams.pagina) || 1)
  const pagine = Math.max(1, Math.ceil(filtrate.length / PAGINA))
  const visibili = filtrate.slice((pagina - 1) * PAGINA, pagina * PAGINA)
  const esportazione = `/dashboard/incassato/eliminazioni/export?${new URLSearchParams({ mese, ...base }).toString()}`

  return (
    <div>
      <Testata mese={mese} />

      <div className="report-mese-nav">
        <Link
          href={hrefPagina({ pagina: null }, mesePiu(mese, -1))}
          className={`btn btn-ghost btn-sm${mese <= PRIMO_MESE_DATI ? ' is-disabilitato' : ''}`}
        >
          ← Mese prec.
        </Link>
        <span className="report-mese-titolo">{etichettaMese(mese)}</span>
        <Link href={hrefPagina({ pagina: null }, mesePiu(mese, 1))} className="btn btn-ghost btn-sm">
          Mese succ. →
        </Link>
      </div>

      {conImporto.length === 0 ? (
        <div className="card">
          <p className="vuoto">Nessuna eliminazione o storno con importo in {etichettaMese(mese)}.</p>
        </div>
      ) : (
        <>
          <div className="griglia-stat">
            <div className="stat">
              <span className="stat-label">Eliminazioni di vendita</span>
              <span className="stat-valore">{eur(eliminazioni.importo)}</span>
              <span className="stat-nota">{eliminazioni.n} movimenti negativi.</span>
            </div>
            <div className="stat">
              <span className="stat-label">Ripristini</span>
              <span className="stat-valore">{eur(ripristini.importo)}</span>
              <span className="stat-nota">{ripristini.n} incassi che ricreano quanto eliminato.</span>
            </div>
            <div className="stat">
              <span className="stat-label">Eliminato al netto dei ripristini</span>
              <span className="stat-valore">{eur(nettoEliminato)}</span>
              <span className="stat-nota">Quanto è uscito davvero dall’incassato per eliminazioni.</span>
            </div>
            <div className="stat">
              <span className="stat-label">Rettifiche totali</span>
              <span className="stat-valore">{eur(totale.importo)}</span>
              <span className="stat-nota">
                {totale.n} movimenti con importo, tutte le categorie. {zeri} a importo zero non contati.
              </span>
            </div>
          </div>

          <div className="card">
            <p className="filtri-titolo">Da controllare per primo</p>
            <ul className="elenco-controlli">
              <li>
                {altroMese.n > 0 ? (
                  <>
                    <Link href={hrefPagina({ mesediverso: 'si', pagina: null })}>
                      {altroMese.n} rettifiche su incassi di un altro mese
                    </Link>{' '}
                    per {eur(altroMese.importo)}: cambiano un mese che la contabilità può aver già chiuso.
                  </>
                ) : (
                  'Nessuna rettifica su incassi di mesi precedenti.'
                )}
              </li>
              <li>
                {nonCollegate.n > 0 ? (
                  <>
                    <Link href={hrefPagina({ noncollegate: 'si', pagina: null })}>
                      {nonCollegate.n} eliminazioni senza movimento originale collegato
                    </Link>{' '}
                    per {eur(nonCollegate.importo)}: Info4U non dice quale incasso compensano, quindi vanno
                    verificate a mano (per persona e prodotto).
                  </>
                ) : (
                  'Tutte le eliminazioni puntano al loro incasso originale.'
                )}
              </li>
            </ul>
          </div>

          <div className="card">
            <p className="filtri-titolo">Per categoria</p>
            <div className="tabella-wrap">
              <table className="tabella">
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th className="cella-importo">Movimenti</th>
                    <th className="cella-importo">Importo</th>
                  </tr>
                </thead>
                <tbody>
                  {CATEGORIE.map((c) => {
                    const t = perCategoria.get(c)!
                    if (t.n === 0) return null
                    return (
                      <tr key={c}>
                        <td>
                          <Link href={hrefPagina({ categoria: c, pagina: null })}>{ETICHETTE_CATEGORIA[c].nome}</Link>
                          <span className="stat-nota">{ETICHETTE_CATEGORIA[c].nota}</span>
                        </td>
                        <td className="cella-importo">{t.n}</td>
                        <td className="cella-importo">
                          <Importo valore={t.importo} />
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="riga-totale">
                    <td>
                      <strong>Totale</strong>
                    </td>
                    <td className="cella-importo">{totale.n}</td>
                    <td className="cella-importo">
                      <strong>
                        <Importo valore={totale.importo} />
                      </strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <p className="filtri-titolo">Per operatore</p>
            <p className="muted">Chi ha registrato le rettifiche. Clicca un nome per filtrare l’elenco.</p>
            <div className="tabella-wrap">
              <table className="tabella">
                <thead>
                  <tr>
                    <th>Operatore</th>
                    <th className="cella-importo">Eliminazioni</th>
                    <th className="cella-importo">Ripristini</th>
                    <th className="cella-importo">Storni rate</th>
                    <th className="cella-importo">Altri storni</th>
                    <th className="cella-importo">Totale</th>
                  </tr>
                </thead>
                <tbody>
                  {operatoriOrdinati.map(([nome, o]) => (
                    <tr key={nome}>
                      <td>
                        <Link href={hrefPagina({ operatore: nome, pagina: null })}>{nome}</Link>
                      </td>
                      {CATEGORIE.map((c) => (
                        <td key={c} className="cella-importo">
                          {o[c].n === 0 ? '—' : `${o[c].n} · ${eur(o[c].importo)}`}
                        </td>
                      ))}
                      <td className="cella-importo">
                        <strong>
                          <Importo valore={o.totale.importo} />
                        </strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <p className="filtri-titolo">Per metodo di pagamento rettificato</p>
            <p className="muted">
              Il metodo dell’incasso originale: una eliminazione su un pagamento in contanti è denaro che il
              cassetto dovrebbe aver restituito.
            </p>
            <div className="tabella-wrap">
              <table className="tabella">
                <thead>
                  <tr>
                    <th>Metodo</th>
                    <th className="cella-importo">Movimenti</th>
                    <th className="cella-importo">Importo</th>
                  </tr>
                </thead>
                <tbody>
                  {metodiOrdinati.map(([m, t]) => (
                    <tr key={m}>
                      <td>{m}</td>
                      <td className="cella-importo">{t.n}</td>
                      <td className="cella-importo">
                        <Importo valore={t.importo} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="filtri">
        <p className="filtri-titolo">Elenco</p>
        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
            <Link href={hrefPagina({ categoria: null, pagina: null })} className={`chip${!filtri.categoria ? ' is-attivo' : ''}`}>
              Tutte le categorie
            </Link>
            {CATEGORIE.map((c) => (
              <Link key={c} href={hrefPagina({ categoria: c, pagina: null })} className={`chip${filtri.categoria === c ? ' is-attivo' : ''}`}>
                {ETICHETTE_CATEGORIA[c].nome}
              </Link>
            ))}
          </fieldset>
          <fieldset className="filtro-gruppo">
            <Link
              href={hrefPagina({ mesediverso: filtri.soloMeseDiverso ? null : 'si', pagina: null })}
              className={`chip${filtri.soloMeseDiverso ? ' is-attivo' : ''}`}
            >
              Solo su incassi di altri mesi
            </Link>
            <Link
              href={hrefPagina({ noncollegate: filtri.soloNonCollegate ? null : 'si', pagina: null })}
              className={`chip${filtri.soloNonCollegate ? ' is-attivo' : ''}`}
            >
              Solo eliminazioni non collegate
            </Link>
            <Link
              href={hrefPagina({ zero: filtri.conZero ? null : 'si', pagina: null })}
              className={`chip${filtri.conZero ? ' is-attivo' : ''}`}
            >
              Mostra anche importi a zero
            </Link>
            {filtri.operatore && (
              <Link href={hrefPagina({ operatore: null, pagina: null })} className="chip is-attivo">
                Operatore: {filtri.operatore} ✕
              </Link>
            )}
          </fieldset>
        </div>
      </div>

      <div className="card">
        {visibili.length === 0 ? (
          <p className="vuoto">Nessuna rettifica con questi filtri.</p>
        ) : (
          <>
            <p className="muted">
              {filtrate.length.toLocaleString('it-IT')} movimenti{pagine > 1 ? `, pagina ${pagina} di ${pagine}` : ''}.{' '}
              <a href={esportazione} className="btn btn-ghost btn-sm">
                Scarica CSV (tutti i movimenti filtrati)
              </a>
            </p>
            <div className="tabella-wrap">
              <table className="tabella">
                <thead>
                  <tr>
                    <th>Rettifica</th>
                    <th>Categoria</th>
                    <th>Operatore</th>
                    <th>Persona</th>
                    <th>Prodotto / causale</th>
                    <th>Metodo</th>
                    <th className="cella-importo">Importo</th>
                    <th>Incasso rettificato</th>
                  </tr>
                </thead>
                <tbody>
                  {visibili.map((r) => {
                    const persona = [r.persona_cognome, r.persona_nome].filter(Boolean).join(' ')
                    return (
                      <tr key={r.source_movimento_id}>
                        <td className="cella-nowrap">{dataOra(r.data_operazione)}</td>
                        <td>
                          <span className={`badge ${r.categoria === 'ripristino' ? 'badge-ok' : r.categoria === 'eliminazione' ? 'badge-ko' : 'badge-warn'}`}>
                            {ETICHETTE_CATEGORIA[r.categoria].nome}
                          </span>
                        </td>
                        <td>{r.operatore_nome ?? '—'}</td>
                        <td className="cella-persona">
                          {r.persona_id ? <Link href={`/dashboard/persone/${r.persona_id}`}>{persona || 'Senza nome'}</Link> : '—'}
                        </td>
                        <td className="cella-persona">{causalePulita(r.causale)}</td>
                        <td>{r.metodo_pagamento ?? '—'}</td>
                        <td className="cella-importo">
                          <Importo valore={r.importo} />
                        </td>
                        <td className="cella-persona">
                          {r.originale_id !== null && r.originale_data ? (
                            <>
                              {dataOra(r.originale_data)} · {eur(r.originale_importo ?? 0)}
                              <span className="stat-nota">
                                {r.originale_operatore ?? '—'} ·{' '}
                                {r.giorni_dall_originale === 0 ? 'stesso giorno' : `${r.giorni_dall_originale} giorni dopo`}
                              </span>
                              {r.mese_diverso && <span className="badge badge-warn">altro mese</span>}
                            </>
                          ) : r.storno_di !== null ? (
                            <span className="stat-nota">Movimento originale precedente al 2023, non migrato</span>
                          ) : (
                            <span className="stat-nota">Non collegato a un movimento</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {pagine > 1 && (
              <div className="report-mese-nav">
                {pagina > 1 ? (
                  <Link href={hrefPagina({ pagina: String(pagina - 1) })} className="btn btn-ghost btn-sm">
                    ← Precedente
                  </Link>
                ) : (
                  <span />
                )}
                <span className="report-mese-titolo">
                  {pagina} / {pagine}
                </span>
                {pagina < pagine ? (
                  <Link href={hrefPagina({ pagina: String(pagina + 1) })} className="btn btn-ghost btn-sm">
                    Successiva →
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Testata({ mese }: { mese: string }) {
  return (
    <div className="page-head">
      <p className="eyebrow">Amministrazione</p>
      <h1>Eliminazioni e storni</h1>
      <p className="muted">
        Ogni movimento che in InfoRYOU corregge un incasso già registrato, per controllare chi ha rettificato cosa e
        quando. Eliminare una vendita non cancella l’incasso: aggiunge un movimento negativo. Se la vendita viene
        rifatta, un movimento positivo («ripristino») la ricrea: eliminazione e ripristino insieme sono una
        modifica, non una perdita.
      </p>
      <Link href={`/dashboard/incassato?mese=${mese}`} className="muted">
        ← Torna a Incassato
      </Link>
    </div>
  )
}
