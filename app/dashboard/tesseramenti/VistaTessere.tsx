import Link from 'next/link'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { caricaGruppi } from '@/lib/abbonamenti'
import { dataIt, descriviTessera, giorniA, oggiRoma } from '@/lib/tesseramenti'

// La ricerca fra le tessere CSI. Ogni riga è una tessera di una stagione; il
// nominativo è quello della persona nel CRM (legata per codice fiscale) o,
// se non c'è, quello che CSI ha in archivio. Le righe di chi ha un abbonamento
// reale in corso sono evidenziate: è chi, se la tessera scade, va rinnovato.

type SearchParams = Record<string, string | undefined>

const STATI = [
  { chiave: 'in_corso', etichetta: 'In corso' },
  { chiave: 'scadute', etichetta: 'Scadute' },
  { chiave: 'tutte', etichetta: 'Tutte' },
] as const
type Stato = (typeof STATI)[number]['chiave']

type RigaTessera = {
  id: string
  stagione: number
  tessera: string
  cft: string | null
  persona_id: string | null
  cognome: string | null
  nome: string | null
  tipotess: string | null
  attivita: string[]
  qualifiche: string[]
  rilascio: string | null
  scadenza: string | null
  persone: { nome: string | null; cognome: string | null } | null
}

type AbbonamentoReale = { abbonamento: string; gruppo_id: string | null; data_fine: string | null }

const LIMITE = 300

export async function VistaTessere({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createSupabaseServiceClient()
  const oggi = oggiRoma()

  const q = (searchParams.q ?? '').trim().slice(0, 80)
  const stato: Stato = STATI.some((s) => s.chiave === searchParams.stato) ? (searchParams.stato as Stato) : 'in_corso'
  // Ogni parola deve comparire nel cognome, nel nome, nel numero di tessera o
  // nel codice fiscale; i caratteri che nei filtri di PostgREST hanno un
  // significato si tolgono.
  const parole = q
    .split(/\s+/)
    .map((p) => p.replace(/[%_,()*\\]/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 4)

  let ricerca = supabase
    .from('tessere_csi')
    .select(
      'id, stagione, tessera, cft, persona_id, cognome, nome, tipotess, attivita, qualifiche, rilascio, scadenza, persone(nome, cognome)',
      { count: 'exact' }
    )
  for (const p of parole) {
    ricerca = ricerca.or(`cognome.ilike.%${p}%,nome.ilike.%${p}%,tessera.ilike.%${p}%,cft.ilike.%${p}%`)
  }
  if (stato === 'in_corso') ricerca = ricerca.gte('scadenza', oggi)
  if (stato === 'scadute') ricerca = ricerca.lt('scadenza', oggi)

  const [{ data, count, error }, inCorso, totali, senzaPersona, gruppi] = await Promise.all([
    ricerca.order('scadenza', { ascending: false }).order('id', { ascending: true }).limit(LIMITE),
    supabase.from('tessere_csi_attive').select('persona_id', { count: 'exact', head: true }),
    supabase.from('tessere_csi').select('id', { count: 'exact', head: true }),
    supabase.from('tessere_csi').select('id', { count: 'exact', head: true }).is('persona_id', null),
    caricaGruppi(),
  ])

  const righe = (data ?? []) as unknown as RigaTessera[]

  // L'abbonamento reale in corso delle persone nei risultati.
  const nomeGruppo = new Map(gruppi.map((g) => [g.id, g.nome]))
  const idPersone = Array.from(new Set(righe.map((r) => r.persona_id).filter((x): x is string => !!x)))
  const abbonamenti = new Map<string, AbbonamentoReale>()
  for (let i = 0; i < idPersone.length; i += 100) {
    const { data: ab } = await supabase
      .from('abbonamenti_attivi_oggi_dettaglio')
      .select('persona_id, abbonamento, gruppo_id, data_fine')
      .in('persona_id', idPersone.slice(i, i + 100))
    for (const a of (ab ?? []) as unknown as (AbbonamentoReale & { persona_id: string })[]) {
      const prec = abbonamenti.get(a.persona_id)
      if (!prec || (a.data_fine ?? '9999') > (prec.data_fine ?? '9999')) abbonamenti.set(a.persona_id, a)
    }
  }

  const href = (campi: { q?: string; stato?: Stato }) => {
    const p = new URLSearchParams({ sezione: 'tessere' })
    const qq = campi.q ?? q
    const ss = campi.stato ?? stato
    if (qq) p.set('q', qq)
    if (ss !== 'in_corso') p.set('stato', ss)
    return `/dashboard/tesseramenti?${p.toString()}`
  }

  return (
    <>
      <div className="griglia-stat">
        <div className="stat stat-ok">
          <span className="stat-label">Persone con tessera in corso</span>
          <span className="stat-valore">{(inCorso.count ?? 0).toLocaleString('it-IT')}</span>
          <span className="stat-nota">Legate a una persona del CRM.</span>
        </div>
        <div className="stat">
          <span className="stat-label">Tessere in archivio</span>
          <span className="stat-valore">{(totali.count ?? 0).toLocaleString('it-IT')}</span>
          <span className="stat-nota">Stagione corrente e precedente, da CSI.</span>
        </div>
        <div className={`stat${(senzaPersona.count ?? 0) > 0 ? ' stat-warn' : ''}`}>
          <span className="stat-label">Non legate a una persona</span>
          <span className="stat-valore">{(senzaPersona.count ?? 0).toLocaleString('it-IT')}</span>
          <span className="stat-nota">Il codice fiscale non coincide con nessuna anagrafica.</span>
        </div>
      </div>

      <div className="card">
        <form method="get" action="/dashboard/tesseramenti" className="check-sosp-filtri">
          <input type="hidden" name="sezione" value="tessere" />
          {stato !== 'in_corso' && <input type="hidden" name="stato" value={stato} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Cognome, nome, numero di tessera o codice fiscale"
            aria-label="Cerca una tessera"
            className="input"
            style={{ minWidth: '18rem', flex: '1 1 18rem' }}
          />
          <button type="submit" className="btn">
            Cerca
          </button>
          <div className="check-sosp-gruppo" role="group" aria-label="Stato della tessera">
            {STATI.map((s) => (
              <Link
                key={s.chiave}
                href={href({ stato: s.chiave })}
                className={`chip${stato === s.chiave ? ' is-attivo' : ''}`}
                aria-current={stato === s.chiave ? 'true' : undefined}
                scroll={false}
              >
                {s.etichetta}
              </Link>
            ))}
          </div>
        </form>

        {error ? (
          <p className="vuoto">
            Non riesco a leggere le tessere: {error.message}. Se manca la tabella, esegui
            scripts/sql/2026-10-29-tessere-csi.sql nel SQL Editor di Supabase.
          </p>
        ) : righe.length === 0 ? (
          <div className="vuoto-buono">
            <p className="vuoto-titolo">{q ? 'Nessuna tessera corrisponde alla ricerca' : 'Nessuna tessera'}</p>
          </div>
        ) : (
          <>
            <p className="field-hint">
              {(count ?? righe.length).toLocaleString('it-IT')} {count === 1 ? 'tessera' : 'tessere'}
              {(count ?? 0) > LIMITE ? `, mostrate le prime ${LIMITE}: restringi la ricerca` : ''}. Le righe con il filo
              dorato sono di chi ha un abbonamento reale in corso.
            </p>
            <div className="tabella-wrap">
              <table className="tabella tabella-compatta">
                <thead>
                  <tr>
                    <th>Nominativo</th>
                    <th>Tessera</th>
                    <th>Tipo</th>
                    <th>Rilascio</th>
                    <th>Scadenza</th>
                    <th>Abbonamento reale</th>
                  </tr>
                </thead>
                <tbody>
                  {righe.map((r) => {
                    const cognome = r.persone?.cognome ?? r.cognome
                    const nome = r.persone?.nome ?? r.nome
                    const nominativo = [cognome, nome].filter(Boolean).join(' ') || 'Senza nome'
                    const scaduta = !!r.scadenza && r.scadenza < oggi
                    const ab = r.persona_id ? abbonamenti.get(r.persona_id) : undefined
                    const giorni = r.scadenza ? giorniA(r.scadenza, oggi) : null
                    return (
                      <tr key={r.id} className={ab ? 'riga-evidenza' : undefined}>
                        <td className="cella-persona">
                          {r.persona_id ? (
                            <Link href={`/dashboard/persone/${r.persona_id}`}>{nominativo}</Link>
                          ) : (
                            <>
                              {nominativo}
                              <span className="nota-in-riga" title="Il codice fiscale non coincide con nessuna anagrafica del CRM.">
                                non nel CRM
                              </span>
                            </>
                          )}
                        </td>
                        <td className="cella-nowrap">
                          <strong>{r.tessera}</strong>
                          <span className="nota-in-riga">stagione {r.stagione}</span>
                        </td>
                        <td>{descriviTessera(r)}</td>
                        <td className="cella-nowrap">{dataIt(r.rilascio)}</td>
                        <td className="cella-nowrap">
                          {dataIt(r.scadenza)}
                          <span className={`badge ${scaduta ? 'badge-ko' : giorni != null && giorni <= 30 ? 'badge-warn' : 'badge-ok'}`}>
                            {scaduta ? 'Scaduta' : giorni != null && giorni <= 30 ? `Scade tra ${giorni} gg` : 'In corso'}
                          </span>
                        </td>
                        <td>
                          {ab ? (
                            <>
                              <span className={`badge ${scaduta ? 'badge-warn' : 'badge-ok'}`}>
                                {scaduta ? 'Tessera scaduta, abbonamento in corso' : 'Abbonamento in corso'}
                              </span>
                              <span className="nota-in-riga">
                                {ab.abbonamento}
                                {ab.gruppo_id && nomeGruppo.get(ab.gruppo_id) ? ` · ${nomeGruppo.get(ab.gruppo_id)}` : ''}
                                {ab.data_fine ? ` · fino al ${dataIt(ab.data_fine)}` : ''}
                              </span>
                            </>
                          ) : (
                            <span className="muted">Nessuno in corso</span>
                          )}
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
