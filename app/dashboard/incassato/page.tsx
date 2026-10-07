import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { euro } from '@/lib/pipeline'
import {
  dataBreve,
  etichettaMese,
  giorniDelMese,
  mesePiu,
  oggiRoma,
  primoDelMese,
  ultimoDelMese,
} from '@/lib/agenda'
import {
  COLLEGAMENTI,
  DIMENSIONE_PAGINA_MOVIMENTI,
  ETICHETTE_COLLEGAMENTO,
  ETICHETTE_PERIODO,
  ETICHETTE_STATO_VENDITA,
  METODO_DA_DEFINIRE,
  PERIODI_VENDITA,
  PRIMO_MESE_DATI,
  SENZA_METODO,
  TIPI_SERVIZIO,
  caricaGiornaliero,
  caricaMovimenti,
  caricaRateInsolute,
  caricaVenditeDelMese,
  contaMovimentiFuturi,
  leggiFiltriMovimenti,
  nomeTipo,
  nonSpiegato,
  parametriFiltri,
  raggruppa,
  sommaTutto,
  statoVendita,
  type FiltriMovimenti,
  type RigaGiornaliera,
  type RigaMovimento,
  type RigaVendita,
  type StatoVendita,
  type Totali,
} from '@/lib/incassato'

export const dynamic = 'force-dynamic'

const VISTE = ['riepilogo', 'giornaliero', 'movimenti', 'vendite', 'rate'] as const
type Vista = (typeof VISTE)[number]

const ETICHETTE_VISTA: Record<Vista, string> = {
  riepilogo: 'Riepilogo e riconciliazione',
  giornaliero: 'Chiusura giornaliera',
  movimenti: 'Elenco movimenti',
  vendite: 'Venduto e incassato',
  rate: 'Rate insolute',
}

type SearchParams = {
  mese?: string
  vista?: string
  tipo?: string
  metodo?: string
  collegamento?: string
  segno?: string
  storno?: string
  giorno?: string
  stato?: string
  pagina?: string
}

const eur = (n: number) => euro(n) ?? '—'
const eurOTrattino = (n: number) => (n === 0 ? '—' : eur(n))

function Importo({ valore }: { valore: number }) {
  return <span className={valore < 0 ? 'importo-neg' : undefined}>{eurOTrattino(valore)}</span>
}

function href(mese: string, vista: Vista, extra: Record<string, string> = {}) {
  const p = new URLSearchParams({ mese, vista, ...extra })
  return `/dashboard/incassato?${p.toString()}`
}

export default async function IncassatoPage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await utenteHaSezione('incassato'))) redirect('/dashboard')

  const oggi = oggiRoma()
  const meseRichiesto = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.mese ?? '')
    ? primoDelMese(searchParams.mese!)
    : primoDelMese(oggi)
  // Prima del primo mese migrato non c'è niente da mostrare.
  const mese = meseRichiesto < PRIMO_MESE_DATI ? PRIMO_MESE_DATI : meseRichiesto
  const primo = mese
  const ultimo = ultimoDelMese(mese)
  const vista: Vista = (VISTE as readonly string[]).includes(searchParams.vista ?? '')
    ? (searchParams.vista as Vista)
    : 'riepilogo'

  const supabase = createSupabaseServiceClient()
  const { righe: righeGiornaliere, errore } = await caricaGiornaliero(supabase, primo, ultimo)

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Amministrazione</p>
        <h1>Incassato</h1>
        <p className="muted">
          I movimenti di cassa di InfoRYOU, per controllare i flussi finanziari e riconciliarli con le vendite di
          abbonamenti. A differenza del report del venduto, qui contano i soldi entrati (e usciti) davvero. Dati dal
          1 gennaio 2023.
        </p>
      </div>

      <div className="report-mese-nav">
        <Link
          href={href(mesePiu(mese, -1), vista)}
          className={`btn btn-ghost btn-sm${mese <= PRIMO_MESE_DATI ? ' is-disabilitato' : ''}`}
          aria-disabled={mese <= PRIMO_MESE_DATI}
        >
          ← Mese prec.
        </Link>
        <span className="report-mese-titolo">{etichettaMese(mese)}</span>
        <Link href={href(mesePiu(mese, 1), vista)} className="btn btn-ghost btn-sm">
          Mese succ. →
        </Link>
      </div>

      <div className="filtri">
        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
            {VISTE.map((v) => (
              <Link key={v} href={href(mese, v)} className={`chip${vista === v ? ' is-attivo' : ''}`}>
                {ETICHETTE_VISTA[v]}
              </Link>
            ))}
            <Link href={`/dashboard/incassato/eliminazioni?mese=${mese}`} className="chip">
              Eliminazioni e storni →
            </Link>
          </fieldset>
        </div>
      </div>

      {errore ? (
        <div className="card">
          <p className="vuoto">
            Non riesco a leggere i movimenti: {errore}. Se la vista non esiste, esegui
            scripts/sql/2026-10-07-incassato-report.sql nel SQL Editor di Supabase (dopo
            2026-10-07-transazioni-cassa.sql).
          </p>
        </div>
      ) : vista === 'riepilogo' ? (
        <Riepilogo righe={righeGiornaliere} mese={mese} primo={primo} ultimo={ultimo} supabase={supabase} />
      ) : vista === 'giornaliero' ? (
        <Giornaliero righe={righeGiornaliere} mese={mese} primo={primo} ultimo={ultimo} oggi={oggi} />
      ) : vista === 'movimenti' ? (
        <Movimenti
          mese={mese}
          filtri={leggiFiltriMovimenti(primo, ultimo, searchParams)}
          righeGiornaliere={righeGiornaliere}
          pagina={Math.max(1, Number(searchParams.pagina) || 1)}
          supabase={supabase}
        />
      ) : vista === 'vendite' ? (
        <Vendite mese={mese} primo={primo} ultimo={ultimo} stato={searchParams.stato} supabase={supabase} />
      ) : (
        <Rate supabase={supabase} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────── riepilogo

type Supabase = ReturnType<typeof createSupabaseServiceClient>

function Stat({ label, valore, nota }: { label: string; valore: string; nota?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-valore">{valore}</span>
      {nota && <span className="stat-nota">{nota}</span>}
    </div>
  )
}

function RigaTotali({ nome, nota, t, extra }: { nome: React.ReactNode; nota?: string; t: Totali; extra?: React.ReactNode }) {
  return (
    <tr>
      <td>
        {nome}
        {nota && <span className="stat-nota">{nota}</span>}
      </td>
      {extra}
      <td className="cella-importo">{t.movimenti.toLocaleString('it-IT')}</td>
      <td className="cella-importo">
        <Importo valore={t.entrate} />
      </td>
      <td className="cella-importo">
        <Importo valore={t.uscite} />
      </td>
      <td className="cella-importo">
        <strong>
          <Importo valore={t.netto} />
        </strong>
      </td>
    </tr>
  )
}

async function Riepilogo({
  righe,
  mese,
  primo,
  ultimo,
  supabase,
}: {
  righe: RigaGiornaliera[]
  mese: string
  primo: string
  ultimo: string
  supabase: Supabase
}) {
  const [{ righe: vendite }, futuri] = await Promise.all([
    caricaVenditeDelMese(supabase, primo, ultimo),
    contaMovimentiFuturi(supabase),
  ])

  if (righe.length === 0) {
    return (
      <div className="card">
        <p className="vuoto">Nessun movimento di cassa in {etichettaMese(mese)}.</p>
      </div>
    )
  }

  const totale = sommaTutto(righe)
  const abbonamenti = sommaTutto(righe.filter((r) => r.tipo_servizio === 'A'))
  const venduto = vendite.reduce((s, v) => s + v.venduto, 0)

  const perMetodo = raggruppa(righe, (r) => r.metodo_pagamento)
  const metodoCassa = new Map(righe.map((r) => [r.metodo_pagamento, r.movimenta_cassa]))
  const metodiOrdinati = Array.from(perMetodo.entries()).sort((a, b) => b[1].netto - a[1].netto)
  const perTipo = Array.from(raggruppa(righe, (r) => r.tipo_servizio).entries()).sort((a, b) => b[1].netto - a[1].netto)
  const perCollegamento = raggruppa(righe, (r) => r.collegamento)
  const soloAbbonamento = righe.filter((r) => r.collegamento === 'abbonamento')
  const perPeriodo = raggruppa(soloAbbonamento, (r) => r.periodo_vendita ?? 'stesso_mese')

  // Anomalie: tutto quello che un controllo contabile guarda per primo.
  const daDefinire = sommaTutto(
    righe.filter((r) => r.tipo_servizio !== 'C' && (r.metodo_pagamento === METODO_DA_DEFINIRE || r.metodo_pagamento === SENZA_METODO))
  )
  const conStorno = righe.reduce((s, r) => s + r.storni, 0)
  const venditaEliminata = perCollegamento.get('vendita_eliminata')
  const eliminazioni = perCollegamento.get('eliminazione')

  return (
    <>
      <div className="griglia-stat">
        <Stat
          label="Incassato netto"
          valore={eur(totale.netto)}
          nota={`Tutti i movimenti del mese: ${eur(totale.entrate)} in entrata, ${eur(totale.uscite)} in uscita.`}
        />
        <Stat
          label="di cui abbonamenti"
          valore={eur(abbonamenti.netto)}
          nota={`${abbonamenti.movimenti.toLocaleString('it-IT')} movimenti di tipo Abbonamenti.`}
        />
        <Stat
          label="Venduto del mese"
          valore={eur(venduto)}
          nota={`${vendite.length.toLocaleString('it-IT')} vendite registrate nel mese (report abbonamenti).`}
        />
        <Stat
          label="Incassato meno venduto"
          valore={eur(abbonamenti.netto - venduto)}
          nota="Abbonamenti incassati nel mese contro abbonamenti venduti nel mese: la differenza è spiegata sotto."
        />
      </div>

      <div className="card">
        <p className="filtri-titolo">Come si passa dal venduto all’incassato</p>
        <p className="muted">
          L’incassato di un mese non coincide col venduto: include rate e saldi di vendite precedenti, acconti di
          vendite successive e toglie le eliminazioni. Qui l’incasso sugli abbonamenti, diviso per mese della vendita
          a cui si riferisce.
        </p>
        <div className="tabella-wrap">
          <table className="tabella">
            <thead>
              <tr>
                <th>Voce</th>
                <th className="cella-importo">Movimenti</th>
                <th className="cella-importo">Entrate</th>
                <th className="cella-importo">Uscite</th>
                <th className="cella-importo">Netto</th>
              </tr>
            </thead>
            <tbody>
              {PERIODI_VENDITA.map((p) => {
                const t = perPeriodo.get(p)
                return t ? <RigaTotali key={p} nome={ETICHETTE_PERIODO[p].nome} nota={ETICHETTE_PERIODO[p].nota} t={t} /> : null
              })}
              {eliminazioni && (
                <RigaTotali
                  nome={ETICHETTE_COLLEGAMENTO.eliminazione.nome}
                  nota={ETICHETTE_COLLEGAMENTO.eliminazione.nota}
                  t={eliminazioni}
                />
              )}
              {venditaEliminata && (
                <RigaTotali
                  nome={ETICHETTE_COLLEGAMENTO.vendita_eliminata.nome}
                  nota={ETICHETTE_COLLEGAMENTO.vendita_eliminata.nota}
                  t={venditaEliminata}
                />
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <p className="filtri-titolo">Per collegamento all’abbonamento</p>
        <p className="muted">
          Ogni movimento è collegato a una vendita oppure no. Clicca una riga per l’elenco dei movimenti.
        </p>
        <div className="tabella-wrap">
          <table className="tabella">
            <thead>
              <tr>
                <th>Collegamento</th>
                <th className="cella-importo">Movimenti</th>
                <th className="cella-importo">Entrate</th>
                <th className="cella-importo">Uscite</th>
                <th className="cella-importo">Netto</th>
              </tr>
            </thead>
            <tbody>
              {COLLEGAMENTI.map((c) => {
                const t = perCollegamento.get(c)
                if (!t) return null
                return (
                  <RigaTotali
                    key={c}
                    nome={<Link href={href(mese, 'movimenti', { collegamento: c })}>{ETICHETTE_COLLEGAMENTO[c].nome}</Link>}
                    nota={ETICHETTE_COLLEGAMENTO[c].nota}
                    t={t}
                  />
                )
              })}
              <tr className="riga-totale">
                <td>
                  <strong>Totale</strong>
                </td>
                <td className="cella-importo">{totale.movimenti.toLocaleString('it-IT')}</td>
                <td className="cella-importo">{eurOTrattino(totale.entrate)}</td>
                <td className="cella-importo">
                  <Importo valore={totale.uscite} />
                </td>
                <td className="cella-importo">
                  <strong>
                    <Importo valore={totale.netto} />
                  </strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <p className="filtri-titolo">Per metodo di pagamento</p>
        <p className="muted">
          «Passa dalla cassa» è il flag di InfoRYOU: i bonifici non passano dal cassetto ma sono incassi veri. Per
          bonifici e finanziamenti la data è quella in cui l’operatore registra il pagamento, non quella
          dell’accredito in banca.
        </p>
        <div className="tabella-wrap">
          <table className="tabella">
            <thead>
              <tr>
                <th>Metodo</th>
                <th>Passa dalla cassa</th>
                <th className="cella-importo">Movimenti</th>
                <th className="cella-importo">Entrate</th>
                <th className="cella-importo">Uscite</th>
                <th className="cella-importo">Netto</th>
                <th className="cella-importo">%</th>
              </tr>
            </thead>
            <tbody>
              {metodiOrdinati.map(([metodo, t]) => (
                <tr key={metodo}>
                  <td>
                    <Link href={href(mese, 'movimenti', { metodo })}>{metodo}</Link>
                  </td>
                  <td>{metodoCassa.get(metodo) === null || metodoCassa.get(metodo) === undefined ? '—' : metodoCassa.get(metodo) ? 'Sì' : 'No'}</td>
                  <td className="cella-importo">{t.movimenti.toLocaleString('it-IT')}</td>
                  <td className="cella-importo">
                    <Importo valore={t.entrate} />
                  </td>
                  <td className="cella-importo">
                    <Importo valore={t.uscite} />
                  </td>
                  <td className="cella-importo">
                    <strong>
                      <Importo valore={t.netto} />
                    </strong>
                  </td>
                  <td className="cella-importo">{totale.netto ? `${Math.round((t.netto / totale.netto) * 1000) / 10}%` : '—'}</td>
                </tr>
              ))}
              <tr className="riga-totale">
                <td colSpan={2}>
                  <strong>Totale</strong>
                </td>
                <td className="cella-importo">{totale.movimenti.toLocaleString('it-IT')}</td>
                <td className="cella-importo">{eurOTrattino(totale.entrate)}</td>
                <td className="cella-importo">
                  <Importo valore={totale.uscite} />
                </td>
                <td className="cella-importo">
                  <strong>
                    <Importo valore={totale.netto} />
                  </strong>
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <p className="filtri-titolo">Per tipo di servizio</p>
        <div className="tabella-wrap">
          <table className="tabella">
            <thead>
              <tr>
                <th>Tipo</th>
                <th className="cella-importo">Movimenti</th>
                <th className="cella-importo">Entrate</th>
                <th className="cella-importo">Uscite</th>
                <th className="cella-importo">Netto</th>
              </tr>
            </thead>
            <tbody>
              {perTipo.map(([tipo, t]) => (
                <RigaTotali
                  key={tipo}
                  nome={<Link href={href(mese, 'movimenti', { tipo })}>{nomeTipo(tipo)}</Link>}
                  nota={TIPI_SERVIZIO[tipo]?.nota}
                  t={t}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <p className="filtri-titolo">Da controllare</p>
        <ul className="elenco-controlli">
          <li>
            {daDefinire.movimenti > 0 ? (
              <>
                <Link href={href(mese, 'movimenti', { metodo: METODO_DA_DEFINIRE })}>
                  {daDefinire.movimenti} movimenti senza metodo di pagamento
                </Link>{' '}
                («Da definire» o nessun metodo, cauzioni escluse): {eur(daDefinire.netto)}. Incassati, ma non si sa
                come: da correggere in InfoRYOU.
              </>
            ) : (
              'Nessun movimento senza metodo di pagamento.'
            )}
          </li>
          <li>
            {conStorno > 0 ? (
              <>
                <Link href={href(mese, 'movimenti', { storno: 'si' })}>{conStorno} movimenti di storno</Link> nel
                mese.
              </>
            ) : (
              'Nessuno storno nel mese.'
            )}
          </li>
          <li>
            {eliminazioni && eliminazioni.movimenti > 0 ? (
              <>
                <Link href={href(mese, 'movimenti', { collegamento: 'eliminazione' })}>
                  {eliminazioni.movimenti} eliminazioni di vendita
                </Link>{' '}
                per {eur(eliminazioni.netto)}: la vendita sparisce da InfoRYOU e l’incasso originale viene
                compensato qui.
              </>
            ) : (
              'Nessuna eliminazione di vendita nel mese.'
            )}
          </li>
          <li>
            {futuri > 0
              ? `${futuri} movimenti hanno una data nel futuro (probabile anno digitato male): non sono contati in nessun totale.`
              : 'Nessun movimento con data nel futuro.'}
          </li>
        </ul>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────── giornaliero

function Giornaliero({
  righe,
  mese,
  primo,
  ultimo,
  oggi,
}: {
  righe: RigaGiornaliera[]
  mese: string
  primo: string
  ultimo: string
  oggi: string
}) {
  if (righe.length === 0) {
    return (
      <div className="card">
        <p className="vuoto">Nessun movimento di cassa in {etichettaMese(mese)}.</p>
      </div>
    )
  }

  const giorni = giorniDelMese(mese)
  const perMetodoTotale = raggruppa(righe, (r) => r.metodo_pagamento)
  // Colonne = i metodi del mese, dal più incassato al meno.
  const metodi = Array.from(perMetodoTotale.entries())
    .sort((a, b) => b[1].netto - a[1].netto)
    .map(([m]) => m)

  const perGiornoMetodo = new Map<string, number>()
  const perGiorno = raggruppa(righe, (r) => r.giorno)
  for (const r of righe) {
    const k = `${r.giorno}|${r.metodo_pagamento}`
    perGiornoMetodo.set(k, Math.round(((perGiornoMetodo.get(k) ?? 0) + r.netto) * 100) / 100)
  }
  const totale = sommaTutto(righe)

  return (
    <div className="card">
      <p className="filtri-titolo">Netto per giorno e metodo di pagamento</p>
      <p className="muted">
        Entrate meno uscite di ogni giorno, tutti i tipi di servizio. Il totale di una riga è la chiusura del giorno:
        clicca la data per i movimenti.
      </p>
      <div className="tabella-wrap">
        <table className="tabella tabella-report">
          <thead>
            <tr>
              <th>Giorno</th>
              {metodi.map((m) => (
                <th key={m} className="cella-importo">
                  {m}
                </th>
              ))}
              <th className="cella-importo">Uscite</th>
              <th className="cella-importo">Totale</th>
            </tr>
          </thead>
          <tbody>
            {giorni.map((g) => {
              const t = perGiorno.get(g)
              return (
                <tr key={g} className={g === oggi ? 'is-oggi' : ''}>
                  <td>
                    {t ? <Link href={href(mese, 'movimenti', { giorno: g })}>{dataBreve(g)}</Link> : dataBreve(g)}
                  </td>
                  {metodi.map((m) => (
                    <td key={m} className="cella-importo">
                      <Importo valore={perGiornoMetodo.get(`${g}|${m}`) ?? 0} />
                    </td>
                  ))}
                  <td className="cella-importo">
                    <Importo valore={t?.uscite ?? 0} />
                  </td>
                  <td className="cella-importo">
                    <strong>
                      <Importo valore={t?.netto ?? 0} />
                    </strong>
                  </td>
                </tr>
              )
            })}
            <tr className="riga-totale">
              <td>
                <strong>Totale {etichettaMese(mese)}</strong>
              </td>
              {metodi.map((m) => (
                <td key={m} className="cella-importo">
                  <strong>
                    <Importo valore={perMetodoTotale.get(m)?.netto ?? 0} />
                  </strong>
                </td>
              ))}
              <td className="cella-importo">
                <Importo valore={totale.uscite} />
              </td>
              <td className="cella-importo">
                <strong>
                  <Importo valore={totale.netto} />
                </strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted">
        La colonna «Uscite» è già compresa nei metodi (un rimborso esce dal metodo con cui è registrato): serve a
        vedere quanto del giorno è stato restituito o stornato. Periodo {primo.slice(8)}–{ultimo.slice(8)}.
      </p>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────── movimenti

async function Movimenti({
  mese,
  filtri,
  righeGiornaliere,
  pagina,
  supabase,
}: {
  mese: string
  filtri: FiltriMovimenti
  righeGiornaliere: RigaGiornaliera[]
  pagina: number
  supabase: Supabase
}) {
  const da = (pagina - 1) * DIMENSIONE_PAGINA_MOVIMENTI
  const { righe, totale, errore } = await caricaMovimenti(supabase, filtri, da, DIMENSIONE_PAGINA_MOVIMENTI)
  const base = parametriFiltri(filtri)
  const metodiDelMese = Array.from(new Set(righeGiornaliere.map((r) => r.metodo_pagamento))).sort()
  const tipiDelMese = Array.from(new Set(righeGiornaliere.map((r) => r.tipo_servizio))).sort()
  const pagine = Math.max(1, Math.ceil(totale / DIMENSIONE_PAGINA_MOVIMENTI))

  function conFiltro(chiave: string, valore: string | null): string {
    const p = { ...base }
    if (valore === null) delete p[chiave]
    else p[chiave] = valore
    return href(mese, 'movimenti', p)
  }

  const esportazione = `/dashboard/incassato/export?${new URLSearchParams({ mese, ...base }).toString()}`

  return (
    <>
      <div className="filtri">
        <p className="filtri-titolo">Filtri</p>
        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
            <Link href={conFiltro('tipo', null)} className={`chip${!filtri.tipo ? ' is-attivo' : ''}`}>
              Tutti i tipi
            </Link>
            {tipiDelMese.map((t) => (
              <Link key={t} href={conFiltro('tipo', t)} className={`chip${filtri.tipo === t ? ' is-attivo' : ''}`}>
                {nomeTipo(t)}
              </Link>
            ))}
          </fieldset>
          <fieldset className="filtro-gruppo">
            <Link href={conFiltro('metodo', null)} className={`chip${!filtri.metodo ? ' is-attivo' : ''}`}>
              Tutti i metodi
            </Link>
            {metodiDelMese.map((m) => (
              <Link key={m} href={conFiltro('metodo', m)} className={`chip${filtri.metodo === m ? ' is-attivo' : ''}`}>
                {m}
              </Link>
            ))}
          </fieldset>
          <fieldset className="filtro-gruppo">
            <Link href={conFiltro('collegamento', null)} className={`chip${!filtri.collegamento ? ' is-attivo' : ''}`}>
              Qualsiasi collegamento
            </Link>
            {COLLEGAMENTI.map((c) => (
              <Link key={c} href={conFiltro('collegamento', c)} className={`chip${filtri.collegamento === c ? ' is-attivo' : ''}`}>
                {ETICHETTE_COLLEGAMENTO[c].nome}
              </Link>
            ))}
          </fieldset>
          <fieldset className="filtro-gruppo">
            <Link href={conFiltro('segno', null)} className={`chip${!filtri.segno ? ' is-attivo' : ''}`}>
              Entrate e uscite
            </Link>
            <Link href={conFiltro('segno', 'entrate')} className={`chip${filtri.segno === 'entrate' ? ' is-attivo' : ''}`}>
              Solo entrate
            </Link>
            <Link href={conFiltro('segno', 'uscite')} className={`chip${filtri.segno === 'uscite' ? ' is-attivo' : ''}`}>
              Solo uscite
            </Link>
            <Link href={conFiltro('segno', 'zero')} className={`chip${filtri.segno === 'zero' ? ' is-attivo' : ''}`}>
              Importo zero
            </Link>
            <Link href={conFiltro('storno', filtri.storno ? null : 'si')} className={`chip${filtri.storno ? ' is-attivo' : ''}`}>
              Solo storni
            </Link>
          </fieldset>
          {filtri.giorno && (
            <fieldset className="filtro-gruppo">
              <Link href={conFiltro('giorno', null)} className="chip is-attivo">
                Giorno {dataBreve(filtri.giorno)} ✕
              </Link>
            </fieldset>
          )}
        </div>
      </div>

      <div className="card">
        {errore ? (
          <p className="vuoto">Non riesco a leggere i movimenti: {errore}</p>
        ) : righe.length === 0 ? (
          <p className="vuoto">Nessun movimento con questi filtri.</p>
        ) : (
          <>
            <p className="muted">
              {totale.toLocaleString('it-IT')} movimenti
              {pagine > 1 ? `, pagina ${pagina} di ${pagine}` : ''}.{' '}
              <a href={esportazione} className="btn btn-ghost btn-sm">
                Scarica CSV (tutti i movimenti filtrati)
              </a>
            </p>
            <div className="tabella-wrap">
              <table className="tabella">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Persona</th>
                    <th>Tipo</th>
                    <th>Causale</th>
                    <th>Metodo</th>
                    <th className="cella-importo">Importo</th>
                    <th>Abbonamento collegato</th>
                    <th>Operatore</th>
                  </tr>
                </thead>
                <tbody>
                  {righe.map((r) => (
                    <RigaMovimentoTabella key={r.source_movimento_id} r={r} />
                  ))}
                </tbody>
              </table>
            </div>
            {pagine > 1 && (
              <div className="report-mese-nav">
                {pagina > 1 ? (
                  <Link href={href(mese, 'movimenti', { ...base, pagina: String(pagina - 1) })} className="btn btn-ghost btn-sm">
                    ← Precedente
                  </Link>
                ) : (
                  <span />
                )}
                <span className="report-mese-titolo">
                  {pagina} / {pagine}
                </span>
                {pagina < pagine ? (
                  <Link href={href(mese, 'movimenti', { ...base, pagina: String(pagina + 1) })} className="btn btn-ghost btn-sm">
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
    </>
  )
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

function RigaMovimentoTabella({ r }: { r: RigaMovimento }) {
  const persona = [r.persona_cognome, r.persona_nome].filter(Boolean).join(' ')
  return (
    <tr>
      <td className="cella-nowrap">{dataOra(r.data_operazione)}</td>
      <td className="cella-persona">
        {r.persona_id ? <Link href={`/dashboard/persone/${r.persona_id}`}>{persona || 'Senza nome'}</Link> : '—'}
      </td>
      <td>{nomeTipo(r.tipo_servizio ?? '?')}</td>
      <td className="cella-persona">
        {r.causale ?? r.descrizione_servizio ?? '—'}
        {r.e_storno && <span className="badge badge-warn">storno</span>}
      </td>
      <td>{r.metodo_pagamento ?? SENZA_METODO}</td>
      <td className="cella-importo">
        <span className={r.importo < 0 ? 'importo-neg' : undefined}>{eur(r.importo)}</span>
      </td>
      <td className="cella-persona">
        {r.collegamento === 'abbonamento' ? (
          <>
            {r.abbonamento ?? '—'}
            <span className="stat-nota">
              venduto {r.data_vendita ? dataOra(r.data_vendita).slice(0, 8) : ''}
              {r.vendita_totale !== null ? ` · totale ${eur(r.vendita_totale)}` : ''}
            </span>
          </>
        ) : (
          <span className="stat-nota">{ETICHETTE_COLLEGAMENTO[r.collegamento].nome}</span>
        )}
      </td>
      <td>{r.operatore_nome ?? '—'}</td>
    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────── vendite

const STATI_FILTRO = ['tutti', 'insoluta', 'non_spiegata', 'rateale', 'eccesso', 'completa'] as const

async function Vendite({
  mese,
  primo,
  ultimo,
  stato,
  supabase,
}: {
  mese: string
  primo: string
  ultimo: string
  stato: string | undefined
  supabase: Supabase
}) {
  const { righe, errore } = await caricaVenditeDelMese(supabase, primo, ultimo)
  if (errore) {
    return (
      <div className="card">
        <p className="vuoto">Non riesco a leggere le vendite: {errore}</p>
      </div>
    )
  }

  // Default: solo quelle che non tornano.
  const filtro = (STATI_FILTRO as readonly string[]).includes(stato ?? '') ? (stato as (typeof STATI_FILTRO)[number]) : 'anomale'
  const conStato: { v: RigaVendita; s: StatoVendita }[] = righe.map((v) => ({ v, s: statoVendita(v) }))
  const conteggi: Record<StatoVendita, { n: number; venduto: number; incassato: number }> = {
    completa: { n: 0, venduto: 0, incassato: 0 },
    rateale: { n: 0, venduto: 0, incassato: 0 },
    insoluta: { n: 0, venduto: 0, incassato: 0 },
    non_spiegata: { n: 0, venduto: 0, incassato: 0 },
    eccesso: { n: 0, venduto: 0, incassato: 0 },
  }
  for (const { v, s } of conStato) {
    conteggi[s].n += 1
    conteggi[s].venduto += v.venduto
    conteggi[s].incassato += v.incassato
  }
  const visibili = conStato.filter(({ s }) => (filtro === 'anomale' ? s !== 'completa' : filtro === 'tutti' || s === filtro))
  const LIMITE = 300
  const venduto = righe.reduce((s, v) => s + v.venduto, 0)
  const incassato = righe.reduce((s, v) => s + v.incassato, 0)

  const hrefStato = (s: string) => href(mese, 'vendite', s === 'anomale' ? {} : { stato: s })

  return (
    <>
      <div className="griglia-stat">
        <Stat label="Vendite del mese" valore={righe.length.toLocaleString('it-IT')} nota={`Per ${eur(venduto)} di venduto.`} />
        <Stat
          label="Incassato finora su queste vendite"
          valore={eur(incassato)}
          nota="Somma dei movimenti collegati, di qualsiasi mese, fino a oggi."
        />
        <Stat
          label="Ancora da incassare"
          valore={eur(venduto - incassato)}
          nota="Venduto meno incassato: rate in corso, rate scadute, differenze non spiegate, incassi oltre il venduto."
        />
      </div>

      <div className="card">
        <p className="filtri-titolo">Stato dell’incasso delle vendite di {etichettaMese(mese)}</p>
        <div className="tabella-wrap">
          <table className="tabella">
            <thead>
              <tr>
                <th>Stato</th>
                <th className="cella-importo">Vendite</th>
                <th className="cella-importo">Venduto</th>
                <th className="cella-importo">Incassato</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(conteggi) as StatoVendita[]).map((s) => (
                <tr key={s}>
                  <td>
                    <Link href={hrefStato(s)}>{ETICHETTE_STATO_VENDITA[s]}</Link>
                  </td>
                  <td className="cella-importo">{conteggi[s].n}</td>
                  <td className="cella-importo">{eurOTrattino(conteggi[s].venduto)}</td>
                  <td className="cella-importo">{eurOTrattino(conteggi[s].incassato)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Una vendita con differenza da incassare è <strong>in corso</strong> se la differenza è coperta da rate
          non ancora scadute, <strong>insoluta</strong> se ha rate scadute e non pagate, e <strong>non spiegata</strong>{' '}
          se nessuna rata la giustifica: è quest’ultima la lista da controllare. Le vendite di inizio 2023 possono
          avere incassi precedenti al 2023 non migrati.
        </p>
      </div>

      <div className="filtri">
        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
            <Link href={hrefStato('anomale')} className={`chip${filtro === 'anomale' ? ' is-attivo' : ''}`}>
              Da verificare
            </Link>
            {STATI_FILTRO.map((s) => (
              <Link key={s} href={hrefStato(s)} className={`chip${filtro === s ? ' is-attivo' : ''}`}>
                {s === 'tutti' ? 'Tutte' : ETICHETTE_STATO_VENDITA[s]}
              </Link>
            ))}
          </fieldset>
        </div>
      </div>

      <div className="card">
        {visibili.length === 0 ? (
          <p className="vuoto">Nessuna vendita in questo stato.</p>
        ) : (
          <>
            {visibili.length > LIMITE && (
              <p className="muted">
                {visibili.length} vendite, mostro le prime {LIMITE} (le più recenti).
              </p>
            )}
            <div className="tabella-wrap">
              <table className="tabella">
                <thead>
                  <tr>
                    <th>Venduto il</th>
                    <th>Persona</th>
                    <th>Abbonamento</th>
                    <th className="cella-importo">Venduto</th>
                    <th className="cella-importo">Incassato</th>
                    <th className="cella-importo">Da incassare</th>
                    <th className="cella-importo">Non spiegato</th>
                    <th>Rate</th>
                    <th>Ultimo incasso</th>
                    <th>Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {visibili.slice(0, LIMITE).map(({ v, s }) => {
                    const persona = [v.persona_cognome, v.persona_nome].filter(Boolean).join(' ')
                    return (
                      <tr key={v.source_iscrizione_id}>
                        <td className="cella-nowrap">{dataOra(v.data_vendita).slice(0, 8)}</td>
                        <td className="cella-persona">
                          {v.persona_id ? <Link href={`/dashboard/persone/${v.persona_id}`}>{persona || 'Senza nome'}</Link> : '—'}
                        </td>
                        <td className="cella-persona">
                          {v.abbonamento ?? '—'}
                          {v.variante && <span className="stat-nota">{v.variante}</span>}
                        </td>
                        <td className="cella-importo">{eur(v.venduto)}</td>
                        <td className="cella-importo">{eur(v.incassato)}</td>
                        <td className="cella-importo">
                          <Importo valore={v.differenza} />
                        </td>
                        <td className="cella-importo">
                          <Importo valore={nonSpiegato(v)} />
                        </td>
                        <td className="cella-nowrap">
                          {v.rate_totali === 0 ? '—' : `${v.rate_pagate}/${v.rate_totali}`}
                          {v.rate_insolute > 0 && <span className="stat-nota">{v.rate_insolute} scadute, {eur(v.importo_insoluto)}</span>}
                        </td>
                        <td className="cella-nowrap">{v.ultimo_incasso ? dataOra(v.ultimo_incasso).slice(0, 8) : '—'}</td>
                        <td>
                          <span className={`badge ${s === 'completa' || s === 'rateale' ? 'badge-ok' : s === 'insoluta' || s === 'non_spiegata' ? 'badge-ko' : 'badge-warn'}`}>
                            {ETICHETTE_STATO_VENDITA[s]}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────── rate

async function Rate({ supabase }: { supabase: Supabase }) {
  const { righe, troncato, errore } = await caricaRateInsolute(supabase)
  if (errore) {
    return (
      <div className="card">
        <p className="vuoto">
          Non riesco a leggere le rate: {errore}. Se la vista non esiste, esegui
          scripts/sql/2026-10-07-abbonamenti-rate.sql nel SQL Editor di Supabase e lancia il sync.
        </p>
      </div>
    )
  }
  if (righe.length === 0) {
    return (
      <div className="card">
        <p className="vuoto">
          Nessuna rata scaduta e non pagata. Se il sync delle rate non è ancora partito, la tabella è vuota.
        </p>
      </div>
    )
  }

  const totale = righe.reduce((s, r) => s + r.importo, 0)
  const conErrore = righe.filter((r) => r.transazione_errore)
  const fasce = [
    { nome: 'Fino a 30 giorni', da: 0, a: 30 },
    { nome: '31–90 giorni', da: 31, a: 90 },
    { nome: '91–180 giorni', da: 91, a: 180 },
    { nome: 'Oltre 180 giorni', da: 181, a: Infinity },
  ].map((f) => {
    const dentro = righe.filter((r) => (r.giorni_ritardo ?? 0) >= f.da && (r.giorni_ritardo ?? 0) <= f.a)
    return { ...f, n: dentro.length, importo: dentro.reduce((s, r) => s + r.importo, 0) }
  })
  const LIMITE = 300

  return (
    <>
      <div className="griglia-stat">
        <Stat label="Rate scadute non pagate" valore={righe.length.toLocaleString('it-IT')} nota={`Per ${eur(totale)}.`} />
        <Stat
          label="Con addebito rifiutato"
          valore={conErrore.length.toLocaleString('it-IT')}
          nota={`${eur(conErrore.reduce((s, r) => s + r.importo, 0))}: la banca ha respinto l’addebito automatico (motivo nella tabella).`}
        />
      </div>

      <div className="card">
        <p className="filtri-titolo">Per anzianità</p>
        <div className="tabella-wrap">
          <table className="tabella">
            <thead>
              <tr>
                <th>Ritardo</th>
                <th className="cella-importo">Rate</th>
                <th className="cella-importo">Importo</th>
              </tr>
            </thead>
            <tbody>
              {fasce.map((f) => (
                <tr key={f.nome}>
                  <td>{f.nome}</td>
                  <td className="cella-importo">{f.n}</td>
                  <td className="cella-importo">{eurOTrattino(f.importo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Una rata è «insoluta» se la scadenza è passata e in InfoRYOU non risulta pagata. Un’anzianità molto alta
          spesso non è un credito vero: rate di vendite poi eliminate o regolate fuori dal piano.
          {troncato && ' Mostro le prime 5.000 rate, le più vecchie: ce ne sono di più.'}
        </p>
      </div>

      <div className="card">
        {righe.length > LIMITE && (
          <p className="muted">
            {righe.length.toLocaleString('it-IT')} rate, mostro le prime {LIMITE} (le più vecchie).
          </p>
        )}
        <div className="tabella-wrap">
          <table className="tabella">
            <thead>
              <tr>
                <th>Scadenza</th>
                <th className="cella-importo">Ritardo</th>
                <th>Persona</th>
                <th>Abbonamento</th>
                <th className="cella-importo">Rata</th>
                <th>Metodo</th>
                <th>Esito addebito</th>
              </tr>
            </thead>
            <tbody>
              {righe.slice(0, LIMITE).map((r) => {
                const persona = [r.persona_cognome, r.persona_nome].filter(Boolean).join(' ')
                return (
                  <tr key={r.source_rata_id}>
                    <td className="cella-nowrap">{r.data_rata ? `${r.data_rata.slice(8, 10)}/${r.data_rata.slice(5, 7)}/${r.data_rata.slice(2, 4)}` : '—'}</td>
                    <td className="cella-importo">{r.giorni_ritardo !== null ? `${r.giorni_ritardo} gg` : '—'}</td>
                    <td className="cella-persona">
                      {r.persona_id ? <Link href={`/dashboard/persone/${r.persona_id}`}>{persona || 'Senza nome'}</Link> : '—'}
                    </td>
                    <td className="cella-persona">
                      {r.vendita_assente ? <span className="stat-nota">Vendita non più presente</span> : r.abbonamento ?? '—'}
                      {r.variante && <span className="stat-nota">{r.variante}</span>}
                    </td>
                    <td className="cella-importo">{eur(r.importo)}</td>
                    <td>{r.metodo_pagamento ?? '—'}</td>
                    <td className="cella-persona">{r.transazione_errore ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
