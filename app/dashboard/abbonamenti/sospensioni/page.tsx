import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { etichettaMese, mesePiu, oggiRoma, primoDelMese, ultimoDelMese } from '@/lib/agenda'

export const dynamic = 'force-dynamic'

// Le sospensioni degli abbonamenti, da dbo.AbbonamentiSospensioni (vedi
// scripts/sql/2026-10-07-sospensioni.sql). Info4U non registra chi le ha
// inserite né quando, quindi la pagina non ha la colonna Operatore: va
// aggiunta quando si trova un registro delle azioni da cui ricavarla.

const STATI = ['in_corso', 'programmata', 'conclusa', 'tutte'] as const
type Stato = (typeof STATI)[number]

const ETICHETTE_STATO: Record<Stato, string> = {
  in_corso: 'In corso',
  programmata: 'Programmate',
  conclusa: 'Concluse',
  tutte: 'Tutte',
}

// Oltre questa durata (giorni di calendario) una sospensione si segnala come
// lunga: di norma sono pochi giorni, e le lunghe sono quelle da guardare.
const SOGLIA_LUNGA = 90
const PAGINA = 100

type Riga = {
  source_sospensione_id: number
  data_inizio: string | null
  data_fine: string | null
  giorni_calendario: number | null
  giorni_netti: number | null
  causale: string | null
  causale_descrizione: string | null
  stato: 'in_corso' | 'programmata' | 'conclusa'
  persona_id: string | null
  persona_nome: string | null
  persona_cognome: string | null
  abbonamento: string | null
  variante: string | null
  abbonamento_fine: string | null
  vendita_assente: boolean
}

type SearchParams = { stato?: string; mese?: string; pagina?: string }

const data = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '—')

export default async function SospensioniPage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  const stato: Stato = (STATI as readonly string[]).includes(searchParams.stato ?? '')
    ? (searchParams.stato as Stato)
    : 'in_corso'
  const mese = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.mese ?? '') ? primoDelMese(searchParams.mese!) : null
  const pagina = Math.max(1, Number(searchParams.pagina) || 1)
  const oggi = oggiRoma()

  const supabase = createSupabaseServiceClient()

  function href(extra: Record<string, string | null>): string {
    const p: Record<string, string> = { stato }
    if (mese) p.mese = mese
    for (const [k, v] of Object.entries(extra)) {
      if (v === null) delete p[k]
      else p[k] = v
    }
    return `/dashboard/abbonamenti/sospensioni?${new URLSearchParams(p).toString()}`
  }

  // I conteggi per stato non dipendono dal filtro: servono a leggere a colpo
  // d'occhio quante ce ne sono, e a scegliere cosa aprire.
  const conta = async (s: Exclude<Stato, 'tutte'>) => {
    const { count } = await supabase.from('sospensioni_elenco').select('source_sospensione_id', { count: 'exact', head: true }).eq('stato', s)
    return count ?? 0
  }
  const [inCorso, programmate] = await Promise.all([conta('in_corso'), conta('programmata')])

  let q = supabase
    .from('sospensioni_elenco')
    .select(
      'source_sospensione_id, data_inizio, data_fine, giorni_calendario, giorni_netti, causale, causale_descrizione, stato, persona_id, persona_nome, persona_cognome, abbonamento, variante, abbonamento_fine, vendita_assente',
      { count: 'exact' }
    )
  if (stato !== 'tutte') q = q.eq('stato', stato)
  if (mese) q = q.gte('data_inizio', mese).lte('data_inizio', ultimoDelMese(mese))
  const { data: righe, count, error } = await q
    .order('data_inizio', { ascending: false })
    .order('source_sospensione_id', { ascending: false })
    .range((pagina - 1) * PAGINA, pagina * PAGINA - 1)

  const elenco = (righe ?? []) as unknown as Riga[]
  const totale = count ?? 0
  const pagine = Math.max(1, Math.ceil(totale / PAGINA))
  const lunghe = elenco.filter((r) => (r.giorni_calendario ?? 0) > SOGLIA_LUNGA).length
  const mediaGiorni = elenco.length
    ? Math.round(elenco.reduce((s, r) => s + (r.giorni_calendario ?? 0), 0) / elenco.length)
    : 0

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Abbonamenti</p>
        <h1>Sospensioni</h1>
        <p className="muted">
          Le sospensioni inserite in InfoRYOU: chi, su quale abbonamento, per quanto tempo. La durata è in giorni di
          calendario (estremi compresi); i «giorni netti» sono quelli che InfoRYOU sottrae davvero all’abbonamento.
        </p>
        <Link href="/dashboard/abbonamenti" className="muted">
          ← Torna ad Abbonamenti
        </Link>
      </div>

      <div className="griglia-stat">
        <div className="stat">
          <span className="stat-label">In corso oggi</span>
          <span className="stat-valore">{inCorso.toLocaleString('it-IT')}</span>
          <span className="stat-nota">Abbonamenti sospesi in questo momento.</span>
        </div>
        <div className="stat">
          <span className="stat-label">Programmate</span>
          <span className="stat-valore">{programmate.toLocaleString('it-IT')}</span>
          <span className="stat-nota">Cominciano dopo oggi.</span>
        </div>
        <div className="stat">
          <span className="stat-label">Durata media (elenco qui sotto)</span>
          <span className="stat-valore">{mediaGiorni} gg</span>
          <span className="stat-nota">
            {lunghe > 0 ? `${lunghe} oltre ${SOGLIA_LUNGA} giorni in questa pagina.` : `Nessuna oltre ${SOGLIA_LUNGA} giorni in questa pagina.`}
          </span>
        </div>
      </div>

      <div className="filtri">
        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
            {STATI.map((s) => (
              <Link key={s} href={href({ stato: s, pagina: null })} className={`chip${stato === s ? ' is-attivo' : ''}`}>
                {ETICHETTE_STATO[s]}
              </Link>
            ))}
          </fieldset>
          <fieldset className="filtro-gruppo">
            {mese ? (
              <>
                <Link href={href({ mese: mesePiu(mese, -1), pagina: null })} className="chip">
                  ←
                </Link>
                <Link href={href({ mese: null, pagina: null })} className="chip is-attivo">
                  Iniziate a {etichettaMese(mese)} ✕
                </Link>
                <Link href={href({ mese: mesePiu(mese, 1), pagina: null })} className="chip">
                  →
                </Link>
              </>
            ) : (
              <Link href={href({ mese: primoDelMese(oggi), pagina: null })} className="chip">
                Filtra per mese di inizio
              </Link>
            )}
          </fieldset>
        </div>
      </div>

      <div className="card">
        {error ? (
          <p className="vuoto">
            Non riesco a leggere le sospensioni: {error.message}. Se la vista non esiste, esegui
            scripts/sql/2026-10-07-sospensioni.sql nel SQL Editor di Supabase e lancia il sync.
          </p>
        ) : elenco.length === 0 ? (
          <p className="vuoto">Nessuna sospensione con questi filtri.</p>
        ) : (
          <>
            <p className="muted">
              {totale.toLocaleString('it-IT')} sospensioni{pagine > 1 ? `, pagina ${pagina} di ${pagine}` : ''}.
            </p>
            <div className="tabella-wrap">
              <table className="tabella">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Abbonamento</th>
                    <th>Dal</th>
                    <th>Al</th>
                    <th className="cella-importo">Giorni</th>
                    <th className="cella-importo">Netti</th>
                    <th>Causale</th>
                    <th>Stato</th>
                    <th>Scadenza abbonamento</th>
                  </tr>
                </thead>
                <tbody>
                  {elenco.map((r) => {
                    const persona = [r.persona_cognome, r.persona_nome].filter(Boolean).join(' ')
                    const lunga = (r.giorni_calendario ?? 0) > SOGLIA_LUNGA
                    return (
                      <tr key={r.source_sospensione_id}>
                        <td className="cella-persona">
                          {r.persona_id ? <Link href={`/dashboard/persone/${r.persona_id}`}>{persona || 'Senza nome'}</Link> : '—'}
                        </td>
                        <td className="cella-persona">
                          {r.vendita_assente ? <span className="stat-nota">Vendita non più presente</span> : r.abbonamento ?? '—'}
                          {r.variante && <span className="stat-nota">{r.variante}</span>}
                        </td>
                        <td className="cella-nowrap">{data(r.data_inizio)}</td>
                        <td className="cella-nowrap">{data(r.data_fine)}</td>
                        <td className="cella-importo">
                          {r.giorni_calendario ?? '—'}
                          {lunga && <span className="badge badge-warn">lunga</span>}
                        </td>
                        <td className="cella-importo">{r.giorni_netti ?? '—'}</td>
                        <td className="cella-persona">
                          {r.causale_descrizione ?? '—'}
                          {r.causale && r.causale !== r.causale_descrizione && <span className="stat-nota">{r.causale}</span>}
                        </td>
                        <td>
                          <span className={`badge ${r.stato === 'in_corso' ? 'badge-info' : r.stato === 'programmata' ? 'badge-warn' : 'badge-off'}`}>
                            {r.stato === 'in_corso' ? 'In corso' : r.stato === 'programmata' ? 'Programmata' : 'Conclusa'}
                          </span>
                        </td>
                        <td className="cella-nowrap">{data(r.abbonamento_fine)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {pagine > 1 && (
              <div className="report-mese-nav">
                {pagina > 1 ? (
                  <Link href={href({ pagina: String(pagina - 1) })} className="btn btn-ghost btn-sm">
                    ← Precedente
                  </Link>
                ) : (
                  <span />
                )}
                <span className="report-mese-titolo">
                  {pagina} / {pagine}
                </span>
                {pagina < pagine ? (
                  <Link href={href({ pagina: String(pagina + 1) })} className="btn btn-ghost btn-sm">
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
