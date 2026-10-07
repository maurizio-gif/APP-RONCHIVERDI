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
//
// I due numeri da non confondere hanno ciascuno il suo campo e la sua
// colonna: la DURATA dell'abbonamento (quanti mesi ha comprato) e il PERIODO
// DI SOSPENSIONE (di quanti giorni è stata spostata la scadenza).

const STATI = ['attive', 'scadute', 'tutte'] as const
type Stato = (typeof STATI)[number]
const ETICHETTE_STATO: Record<Stato, string> = { attive: 'In corso', scadute: 'Già scaduti', tutte: 'Tutti' }

const ORDINI = ['recenti', 'giorni', 'fine', 'cliente'] as const
type Ordine = (typeof ORDINI)[number]
const ETICHETTE_ORDINE: Record<Ordine, string> = {
  recenti: 'Più recenti',
  giorni: 'Sospensione più lunga',
  fine: 'Scadenza più lontana',
  cliente: 'Cliente (A–Z)',
}

// Le durate in mesi con cui si vendono gli abbonamenti (dai dati dal 2023).
const DURATE = [1, 3, 4, 6, 8, 9, 12] as const

// Sotto i 4 giorni di scarto la vista non mostra nulla (sono arrotondamenti
// di fine mese, non sospensioni).
const GIORNI_MINIMI = 4
const SOGLIA_LUNGA = 90
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

type SearchParams = {
  q?: string
  durata?: string
  da?: string
  a?: string
  stato?: string
  ordine?: string
  pagina?: string
}

const data = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '—')
const intero = (v: string | undefined, max: number): number | null => {
  const n = Number(v)
  return v && Number.isInteger(n) && n >= 0 && n <= max ? n : null
}

export default async function ScadenzeSpostatePage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  const stato: Stato = (STATI as readonly string[]).includes(searchParams.stato ?? '')
    ? (searchParams.stato as Stato)
    : 'attive'
  const ordine: Ordine = (ORDINI as readonly string[]).includes(searchParams.ordine ?? '')
    ? (searchParams.ordine as Ordine)
    : 'recenti'
  const durata = DURATE.find((d) => String(d) === searchParams.durata) ?? null
  const da = intero(searchParams.da, 9999)
  const a = intero(searchParams.a, 9999)
  const pagina = Math.max(1, Number(searchParams.pagina) || 1)

  // La ricerca di testo riguarda solo cliente e abbonamento: durata e giorni
  // hanno i loro campi. Ogni parola deve comparire in nome, cognome,
  // abbonamento o variante («rossi silver»). Si tolgono i caratteri che nella
  // sintassi dei filtri di PostgREST separano o racchiudono i valori: lasciati
  // dentro, spezzerebbero il filtro.
  const cerca = (searchParams.q ?? '').slice(0, 80).trim()
  const parole = cerca
    .replace(/[,()%*\\:"]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)

  const supabase = createSupabaseServiceClient()

  // I parametri attivi, per costruire link (paginazione, azzera) che li
  // mantengono.
  const attivi: Record<string, string> = { stato, ordine }
  if (cerca) attivi.q = cerca
  if (durata) attivi.durata = String(durata)
  if (da !== null) attivi.da = String(da)
  if (a !== null) attivi.a = String(a)
  const href = (extra: Record<string, string>) =>
    `/dashboard/abbonamenti/scadenze-spostate?${new URLSearchParams({ ...attivi, ...extra }).toString()}`
  const filtriAttivi = Boolean(cerca || durata || da !== null || a !== null || stato !== 'attive' || ordine !== 'recenti')

  const conta = async (attive: boolean | null) => {
    let c = supabase.from('scadenze_spostate').select('source_iscrizione_id', { count: 'exact', head: true })
    if (attive !== null) c = c.eq('attiva', attive)
    const { count } = await c
    return count ?? 0
  }

  let q = supabase
    .from('scadenze_spostate')
    .select(
      'source_iscrizione_id, persona_id, persona_nome, persona_cognome, abbonamento, variante, data_inizio, scadenza_prevista, data_fine, giorni_spostati, attiva, data_disdetta, ultima_variazione_il, durata',
      { count: 'exact' }
    )
    .gte('giorni_spostati', Math.max(GIORNI_MINIMI, da ?? 0))
  if (a !== null) q = q.lte('giorni_spostati', a)
  if (durata) q = q.eq('durata', durata)
  if (stato === 'attive') q = q.eq('attiva', true)
  if (stato === 'scadute') q = q.eq('attiva', false)
  for (const parola of parole) {
    q = q.or(
      [
        `persona_cognome.ilike.%${parola}%`,
        `persona_nome.ilike.%${parola}%`,
        `abbonamento.ilike.%${parola}%`,
        `variante.ilike.%${parola}%`,
      ].join(',')
    )
  }
  // L'ordinamento: di default le più recenti in alto — prima quelle di cui il
  // CRM ha visto lo spostamento (la più recente per prima), poi le altre per
  // scadenza.
  if (ordine === 'recenti') {
    q = q.order('ultima_variazione_il', { ascending: false, nullsFirst: false }).order('data_fine', { ascending: false })
  } else if (ordine === 'giorni') {
    q = q.order('giorni_spostati', { ascending: false }).order('data_fine', { ascending: false })
  } else if (ordine === 'fine') {
    q = q.order('data_fine', { ascending: false })
  } else {
    q = q.order('persona_cognome', { ascending: true, nullsFirst: false }).order('persona_nome', { ascending: true, nullsFirst: false })
  }

  const trentaGiorniFa = new Date(Date.now() - 30 * 86400000).toISOString()
  const [{ data: righe, count, error }, attive, totale, { count: recenti }] = await Promise.all([
    q.order('source_iscrizione_id', { ascending: false }).range((pagina - 1) * PAGINA, pagina * PAGINA - 1),
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
          tabella delle sospensioni. La <strong>data fine originaria</strong> è quella che spetta dalla durata
          dell’abbonamento (inizio + durata); il <strong>periodo di sospensione</strong> è di quanti giorni è stata
          spostata. Può trattarsi di una sospensione, ma anche di un mese omaggio o di una correzione: il dato non lo
          distingue, e non dice <strong>chi</strong> ha spostato la scadenza.
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
          <span className="stat-nota">Dal 2023, tra abbonamenti in corso e già scaduti.</span>
        </div>
      </div>

      <form method="get" className="card" role="search">
        <p className="filtri-titolo">Cerca e filtra</p>
        <div className="form-row">
          <div className="field" style={{ flex: '2 1 16rem' }}>
            <label htmlFor="f-q">Cliente o abbonamento</label>
            <input id="f-q" name="q" type="search" defaultValue={cerca} placeholder="es. rossi silver" autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="f-durata">Durata abbonamento</label>
            <select id="f-durata" name="durata" defaultValue={durata ? String(durata) : ''}>
              <option value="">Tutte</option>
              {DURATE.map((d) => (
                <option key={d} value={d}>
                  {d === 12 ? '12 mesi (annuale)' : d === 1 ? '1 mese' : `${d} mesi`}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-da">Sospensione da (giorni)</label>
            <input id="f-da" name="da" type="number" min={GIORNI_MINIMI} max={9999} defaultValue={da ?? ''} placeholder={String(GIORNI_MINIMI)} />
          </div>
          <div className="field">
            <label htmlFor="f-a">a (giorni)</label>
            <input id="f-a" name="a" type="number" min={GIORNI_MINIMI} max={9999} defaultValue={a ?? ''} placeholder="nessun limite" />
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="f-stato">Stato</label>
            <select id="f-stato" name="stato" defaultValue={stato}>
              {STATI.map((s) => (
                <option key={s} value={s}>
                  {ETICHETTE_STATO[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-ordine">Ordina per</label>
            <select id="f-ordine" name="ordine" defaultValue={ordine}>
              {ORDINI.map((o) => (
                <option key={o} value={o}>
                  {ETICHETTE_ORDINE[o]}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ alignSelf: 'flex-end' }}>
            <button type="submit" className="btn">
              Applica
            </button>{' '}
            {filtriAttivi && (
              <Link href="/dashboard/abbonamenti/scadenze-spostate" className="btn btn-ghost">
                Azzera
              </Link>
            )}
          </div>
        </div>
      </form>

      <div className="card">
        {error ? (
          <p className="vuoto">
            Non riesco a leggere i dati: {error.message}. Se manca una colonna o la vista, esegui
            scripts/sql/2026-10-07-scadenze-spostate.sql nel SQL Editor di Supabase.
          </p>
        ) : elenco.length === 0 ? (
          <p className="vuoto">Nessun abbonamento con questi filtri.</p>
        ) : (
          <>
            <p className="muted">
              <strong>{nElenco.toLocaleString('it-IT')}</strong> abbonamenti
              {pagine > 1 ? `, pagina ${pagina} di ${pagine}` : ''} · sospensione media in questa pagina:{' '}
              <strong>{mediaGiorni} giorni</strong>.
            </p>
            <div className="tabella-wrap">
              <table className="tabella tabella-compatta">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Abbonamento</th>
                    <th className="cella-importo" title="Durata dell’abbonamento acquistato">Durata</th>
                    <th title="Scadenza che spetta dalla durata: inizio + durata">Fine originaria</th>
                    <th title="Scadenza attuale in InfoRYOU">Fine nuova</th>
                    <th className="cella-importo" title="Giorni di cui è stata spostata la scadenza">Sospensione</th>
                    <th title="Quando il CRM ha visto cambiare la scadenza">Rilevato</th>
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
                        <td
                          className="cella-troncata"
                          title={[r.abbonamento, r.variante].filter(Boolean).join(' · ') || undefined}
                        >
                          {r.abbonamento ?? '—'}
                          {r.variante && <span className="nota-in-riga">{r.variante}</span>}
                        </td>
                        <td className="cella-importo">
                          {r.durata ? `${r.durata} ${r.durata === 1 ? 'mese' : 'mesi'}` : '—'}
                        </td>
                        <td className="cella-nowrap">{data(r.scadenza_prevista)}</td>
                        <td className="cella-nowrap">{data(r.data_fine)}</td>
                        <td className="cella-importo">
                          <strong>{r.giorni_spostati} giorni</strong>
                          {r.giorni_spostati > SOGLIA_LUNGA && <span className="badge badge-warn">lunga</span>}
                        </td>
                        <td className="cella-nowrap">
                          {r.ultima_variazione_il
                            ? new Date(r.ultima_variazione_il).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: '2-digit' })
                            : '—'}
                        </td>
                        <td>
                          <span className={`badge ${r.attiva ? 'badge-info' : 'badge-off'}`}>{r.attiva ? 'In corso' : 'Scaduto'}</span>
                          {r.data_disdetta && <span className="nota-in-riga">disdetto il {data(r.data_disdetta)}</span>}
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
