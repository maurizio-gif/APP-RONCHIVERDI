import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'

export const dynamic = 'force-dynamic'

// Le sospensioni, viste come scadenze spostate. In Info4U le sospensioni di
// oggi non sono registrate in nessuna tabella (quelle dedicate sono ferme a
// marzo 2025): l'operatore sposta a mano la data di fine dell'abbonamento.
// Qui si confronta la scadenza reale con quella che spetterebbe dalla durata
// (vedi scripts/sql/2026-10-07-scadenze-spostate.sql). Info4U non dice chi
// ha fatto lo spostamento: la pagina non ha la colonna Operatore.

const STATI = ['attive', 'scadute', 'tutte'] as const
type Stato = (typeof STATI)[number]
const ETICHETTE_STATO: Record<Stato, string> = { attive: 'In corso', scadute: 'Già scadute', tutte: 'Tutte' }

const FASCE = [
  { chiave: 'tutte', nome: 'Qualsiasi durata', da: 4, a: null },
  { chiave: 'breve', nome: '4–14 giorni', da: 4, a: 14 },
  { chiave: 'media', nome: '15–45 giorni', da: 15, a: 45 },
  { chiave: 'lunga', nome: 'Oltre 45 giorni', da: 46, a: null },
] as const

const PAGINA = 100

type Riga = {
  source_iscrizione_id: number
  persona_id: string | null
  persona_nome: string | null
  persona_cognome: string | null
  abbonamento: string | null
  variante: string | null
  data_inizio: string
  scadenza_prevista: string
  data_fine: string
  giorni_spostati: number
  attiva: boolean
  data_disdetta: string | null
  ultima_variazione_il: string | null
  durata: number | null
}

type SearchParams = { stato?: string; fascia?: string; pagina?: string; q?: string }

const data = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '—')

export default async function ScadenzeSpostatePage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  const stato: Stato = (STATI as readonly string[]).includes(searchParams.stato ?? '')
    ? (searchParams.stato as Stato)
    : 'attive'
  const fascia = FASCE.find((f) => f.chiave === searchParams.fascia) ?? FASCE[0]
  const pagina = Math.max(1, Number(searchParams.pagina) || 1)
  // La ricerca: ogni parola deve comparire in nome, cognome, abbonamento o
  // variante (così «rossi silver» trova Rossi con un abbonamento Silver); una
  // parola fatta solo di cifre cerca anche i giorni di sospensione («30») e
  // trova pure le durate scritte nel nome del prodotto («12 mesi»). Si tolgono
  // i caratteri che nella sintassi dei filtri di PostgREST separano o
  // racchiudono i valori: lasciati dentro, spezzerebbero il filtro.
  const cerca = (searchParams.q ?? '').slice(0, 80).trim()
  const parole = cerca
    .replace(/[,()%*\\:"]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)

  const supabase = createSupabaseServiceClient()

  function href(extra: Record<string, string | null>): string {
    const p: Record<string, string> = { stato, fascia: fascia.chiave }
    if (cerca) p.q = cerca
    for (const [k, v] of Object.entries(extra)) {
      if (v === null) delete p[k]
      else p[k] = v
    }
    return `/dashboard/abbonamenti/scadenze-spostate?${new URLSearchParams(p).toString()}`
  }

  const conta = async (attive: boolean | null) => {
    let q = supabase.from('scadenze_spostate').select('source_iscrizione_id', { count: 'exact', head: true })
    if (attive !== null) q = q.eq('attiva', attive)
    const { count } = await q
    return count ?? 0
  }

  let q = supabase
    .from('scadenze_spostate')
    .select(
      'source_iscrizione_id, persona_id, persona_nome, persona_cognome, abbonamento, variante, data_inizio, scadenza_prevista, data_fine, giorni_spostati, attiva, data_disdetta, ultima_variazione_il, durata',
      { count: 'exact' }
    )
    .gte('giorni_spostati', fascia.da)
  if (fascia.a !== null) q = q.lte('giorni_spostati', fascia.a)
  if (stato === 'attive') q = q.eq('attiva', true)
  if (stato === 'scadute') q = q.eq('attiva', false)
  for (const parola of parole) {
    // «12m» = abbonamenti da 12 mesi, «30g» = 30 giorni di sospensione: la
    // lettera toglie l'ambiguità. Un numero da solo cerca in tutti i campi.
    const mesi = /^(\d{1,2})m$/i.exec(parola)
    const giorni = /^(\d{1,4})g$/i.exec(parola)
    let campi: string[]
    if (mesi) campi = [`durata.eq.${mesi[1]}`]
    else if (giorni) campi = [`giorni_spostati.eq.${giorni[1]}`]
    else {
      campi = [
        `persona_cognome.ilike.%${parola}%`,
        `persona_nome.ilike.%${parola}%`,
        `abbonamento.ilike.%${parola}%`,
        `variante.ilike.%${parola}%`,
      ]
      if (/^\d{1,4}$/.test(parola)) campi.push(`giorni_spostati.eq.${parola}`, `durata.eq.${parola}`)
    }
    q = q.or(campi.join(','))
  }

  const trentaGiorniFa = new Date(Date.now() - 30 * 86400000).toISOString()
  const [{ data: righe, count, error }, attive, totale, { count: recenti }] = await Promise.all([
    // Le più recenti in alto: prima quelle di cui il CRM ha visto lo
    // spostamento (la più recente per prima), poi le altre per scadenza.
    q
      .order('ultima_variazione_il', { ascending: false, nullsFirst: false })
      .order('data_fine', { ascending: false })
      .order('source_iscrizione_id', { ascending: false })
      .range((pagina - 1) * PAGINA, pagina * PAGINA - 1),
    conta(true),
    conta(null),
    supabase
      .from('abbonamenti_scadenze_variazioni')
      .select('id', { count: 'exact', head: true })
      .gte('rilevata_il', trentaGiorniFa)
      .neq('giorni', 0),
  ])

  const elenco = (righe ?? []) as unknown as Riga[]
  const nElenco = count ?? 0
  const pagine = Math.max(1, Math.ceil(nElenco / PAGINA))
  const mediaGiorni = elenco.length ? Math.round(elenco.reduce((s, r) => s + r.giorni_spostati, 0) / elenco.length) : 0

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Abbonamenti</p>
        <h1>Sospensioni (scadenze spostate)</h1>
        <p className="muted">
          In InfoRYOU una sospensione si registra spostando in avanti la data di fine dell’abbonamento: non esiste una
          tabella delle sospensioni. Qui si vedono gli abbonamenti a mesi la cui scadenza è più avanti di quella che
          spetterebbe dalla durata (inizio + durata): la «data fine originaria» è quella calcolata dalla durata, e il «periodo di sospensione» è di quanti giorni è stata spostata. Può trattarsi di una sospensione, ma anche di un mese omaggio o
          di una correzione: il dato non lo distingue, e non dice <strong>chi</strong> ha spostato la scadenza.
        </p>
        <Link href="/dashboard/abbonamenti" className="muted">
          ← Torna ad Abbonamenti
        </Link>
      </div>

      <div className="griglia-stat">
        <div className="stat">
          <span className="stat-label">In corso, con scadenza spostata</span>
          <span className="stat-valore">{attive.toLocaleString('it-IT')}</span>
          <span className="stat-nota">Abbonamenti non ancora scaduti.</span>
        </div>
        <div className="stat">
          <span className="stat-label">Spostamenti negli ultimi 30 giorni</span>
          <span className="stat-valore">{(recenti ?? 0).toLocaleString('it-IT')}</span>
          <span className="stat-nota">
            Cambi di scadenza visti dal CRM (anche anticipi, come le disdette). Il registro parte dal primo sync dopo l’attivazione.
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Spostate in tutto</span>
          <span className="stat-valore">{totale.toLocaleString('it-IT')}</span>
          <span className="stat-nota">Dal 2023, tra abbonamenti in corso e già scaduti. Durata media in elenco: {mediaGiorni} giorni.</span>
        </div>
      </div>

      <form method="get" className="card" role="search">
        <input type="hidden" name="stato" value={stato} />
        <input type="hidden" name="fascia" value={fascia.chiave} />
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="cerca-sospensioni">Cerca</label>
          <div className="form-row">
            <input
              id="cerca-sospensioni"
              name="q"
              type="search"
              defaultValue={cerca}
              placeholder="Cliente, abbonamento, durata (es. rossi silver 12m)"
              autoComplete="off"
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn">
              Cerca
            </button>
            {cerca && (
              <Link href={href({ q: null, pagina: null })} className="btn btn-ghost">
                Azzera
              </Link>
            )}
          </div>
          <p className="field-hint">
            Ogni parola deve comparire nel nome del cliente o dell’abbonamento. <strong>12m</strong> cerca gli
            abbonamenti da 12 mesi, <strong>30g</strong> le sospensioni di 30 giorni; un numero da solo cerca in
            entrambi.
          </p>
        </div>
      </form>

      <div className="filtri">
        <p className="filtri-titolo">Abbonamenti sospesi</p>
        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
            {STATI.map((s) => (
              <Link key={s} href={href({ stato: s, pagina: null })} className={`chip${stato === s ? ' is-attivo' : ''}`}>
                {ETICHETTE_STATO[s]}
              </Link>
            ))}
          </fieldset>
          <fieldset className="filtro-gruppo">
            {FASCE.map((f) => (
              <Link key={f.chiave} href={href({ fascia: f.chiave, pagina: null })} className={`chip${fascia.chiave === f.chiave ? ' is-attivo' : ''}`}>
                {f.nome}
              </Link>
            ))}
          </fieldset>
        </div>
      </div>

      <div className="card">
        {error ? (
          <p className="vuoto">
            Non riesco a leggere i dati: {error.message}. Se la vista non esiste, esegui
            scripts/sql/2026-10-07-scadenze-spostate.sql nel SQL Editor di Supabase.
          </p>
        ) : elenco.length === 0 ? (
          <p className="vuoto">Nessun abbonamento con questi filtri.</p>
        ) : (
          <>
            <p className="muted">
              {nElenco.toLocaleString('it-IT')} abbonamenti{pagine > 1 ? `, pagina ${pagina} di ${pagine}` : ''}, le
              più recenti in alto.
            </p>
            <div className="tabella-wrap">
              <table className="tabella">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Abbonamento</th>
                    <th className="cella-importo">Durata</th>
                    <th>Data fine originaria</th>
                    <th>Data fine nuova</th>
                    <th className="cella-importo">Periodo di sospensione</th>
                    <th>Spostamento rilevato</th>
                    <th>Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {elenco.map((r) => {
                    const persona = [r.persona_cognome, r.persona_nome].filter(Boolean).join(' ')
                    return (
                      <tr key={r.source_iscrizione_id}>
                        <td className="cella-persona">
                          {r.persona_id ? <Link href={`/dashboard/persone/${r.persona_id}`}>{persona || 'Senza nome'}</Link> : '—'}
                        </td>
                        <td className="cella-persona">
                          {r.abbonamento ?? '—'}
                          {r.variante && <span className="stat-nota">{r.variante}</span>}
                        </td>
                        <td className="cella-importo">{r.durata ? `${r.durata} ${r.durata === 1 ? 'mese' : 'mesi'}` : '—'}</td>
                        <td className="cella-nowrap">{data(r.scadenza_prevista)}</td>
                        <td className="cella-nowrap">{data(r.data_fine)}</td>
                        <td className="cella-importo">
                          {r.giorni_spostati} giorni
                          {r.giorni_spostati > 90 && <span className="badge badge-warn">lunga</span>}
                        </td>
                        <td className="cella-nowrap">
                          {r.ultima_variazione_il
                            ? new Date(r.ultima_variazione_il).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: '2-digit' })
                            : '—'}
                        </td>
                        <td>
                          <span className={`badge ${r.attiva ? 'badge-info' : 'badge-off'}`}>{r.attiva ? 'In corso' : 'Scaduto'}</span>
                          {r.data_disdetta && <span className="stat-nota">disdetto il {data(r.data_disdetta)}</span>}
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
