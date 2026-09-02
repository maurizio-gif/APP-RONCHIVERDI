import Link from 'next/link'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { AZIONI_LOG, etichettaAzione } from '@/lib/audit'
import { dataOra } from '@/lib/persone'

const PERIODI = [
  { chiave: '7', etichetta: '7 giorni', giorni: 7 },
  { chiave: '30', etichetta: '30 giorni', giorni: 30 },
  { chiave: '90', etichetta: '90 giorni', giorni: 90 },
] as const

const MAX_RIGHE = 300

/**
 * I dettagli sono un jsonb libero: si mostrano come coppie chiave/valore
 * invece di un JSON grezzo, che in tabella non si legge. Le chiavi tecniche
 * (email_target) diventano parole.
 */
const ETICHETTE_DETTAGLIO: Record<string, string> = {
  email_target: 'utente',
  valore: 'valore',
  sezioni: 'sezioni',
  motivo: 'motivo',
  distanza_metri: 'distanza',
  precisione_metri: 'precisione',
  raggio_metri: 'raggio',
  prima: 'prima',
  dopo: 'dopo',
  da: 'da',
  a: 'a',
  tipo: 'tipo',
  titolo: 'titolo',
  data: 'data',
  ora: 'ora',
  gestito: 'gestito',
  nome: 'nome',
  cognome: 'cognome',
  durata_minuti: 'durata',
}

function dettagliLeggibili(d: unknown): string {
  if (!d || typeof d !== 'object') return ''
  return Object.entries(d as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => {
      const etichetta = ETICHETTE_DETTAGLIO[k] ?? k
      const valore = Array.isArray(v)
        ? v.join(', ')
        : typeof v === 'boolean'
          ? v
            ? 'sì'
            : 'no'
          : String(v)
      return `${etichetta}: ${valore}`
    })
    .join(' · ')
}

export async function AttivitaLog({
  searchParams,
}: {
  searchParams: { operatore?: string; azione?: string; periodo?: string }
}) {
  const periodo = PERIODI.find((p) => p.chiave === searchParams.periodo) ?? PERIODI[1]
  const da = new Date()
  da.setDate(da.getDate() - periodo.giorni)

  const supabase = createSupabaseServiceClient()
  let query = supabase
    .from('audit_log')
    .select('id, created_at, email, azione, entita, entita_id, dettagli')
    .gte('created_at', da.toISOString())
    .order('created_at', { ascending: false })
    .limit(MAX_RIGHE)

  if (searchParams.operatore) query = query.eq('email', searchParams.operatore)
  if (searchParams.azione) query = query.eq('azione', searchParams.azione)

  const [{ data: righe, error }, { data: staff }] = await Promise.all([
    query,
    supabase.from('staff_users').select('email, nome, cognome').order('email'),
  ])

  if (error) console.error('Log non letto:', error.message)

  const elenco = righe ?? []
  const operatori = (staff ?? []).map((s) => ({
    email: s.email as string,
    nome: [s.nome, s.cognome].filter(Boolean).join(' ') || (s.email as string),
  }))

  // Le azioni offerte nel filtro sono quelle davvero presenti nel periodo:
  // un elenco di venti voci di cui diciotto vuote non aiuta a filtrare.
  const azioniPresenti = [...new Set(elenco.map((r) => r.azione as string))].sort((a, b) =>
    etichettaAzione(a).localeCompare(etichettaAzione(b))
  )

  function link(p: { operatore?: string | null; azione?: string | null; periodo?: string }) {
    const params = new URLSearchParams({ vista: 'attivita' })
    const operatore = p.operatore === null ? '' : (p.operatore ?? searchParams.operatore ?? '')
    const azione = p.azione === null ? '' : (p.azione ?? searchParams.azione ?? '')
    if (operatore) params.set('operatore', operatore)
    if (azione) params.set('azione', azione)
    params.set('periodo', p.periodo ?? periodo.chiave)
    return `/dashboard/log-operatori?${params.toString()}`
  }

  return (
    <>
      <div className="agenda-barra">
        <div className="agenda-nav">
          {PERIODI.map((p) => (
            <Link
              key={p.chiave}
              className={`btn btn-sm ${p.chiave === periodo.chiave ? '' : 'btn-ghost'}`}
              href={link({ periodo: p.chiave })}
            >
              {p.etichetta}
            </Link>
          ))}
        </div>
        {(searchParams.operatore || searchParams.azione) && (
          <Link className="btn btn-ghost btn-sm" href={link({ operatore: null, azione: null })}>
            Togli i filtri
          </Link>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Filtra</h2>
        </div>
        <div className="filtri">
          <div>
            <p className="filtri-titolo muted">Operatore</p>
            <div className="agenda-nav">
              {operatori.map((o) => (
                <Link
                  key={o.email}
                  className={`btn btn-sm ${searchParams.operatore === o.email ? '' : 'btn-ghost'}`}
                  href={link({ operatore: searchParams.operatore === o.email ? null : o.email })}
                >
                  {o.nome}
                </Link>
              ))}
            </div>
          </div>
          {azioniPresenti.length > 1 && (
            <div>
              <p className="filtri-titolo muted">Azione</p>
              <div className="agenda-nav">
                {azioniPresenti.map((a) => (
                  <Link
                    key={a}
                    className={`btn btn-sm ${searchParams.azione === a ? '' : 'btn-ghost'}`}
                    href={link({ azione: searchParams.azione === a ? null : a })}
                  >
                    {etichettaAzione(a)}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Attività</h2>
          <span className="muted">
            {elenco.length}
            {elenco.length === MAX_RIGHE ? ` (mostrate le più recenti)` : ''}
            {' '}
            {elenco.length === 1 ? 'azione' : 'azioni'}
          </span>
        </div>

        {elenco.length === 0 ? (
          <p className="vuoto">Nessuna azione registrata con questi filtri.</p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Operatore</th>
                  <th>Azione</th>
                  <th>Dettagli</th>
                </tr>
              </thead>
              <tbody>
                {elenco.map((r) => (
                  <tr key={r.id as number}>
                    <td className="cella-nowrap">{dataOra(r.created_at as string)}</td>
                    <td>{r.email ?? '—'}</td>
                    <td>
                      {/* Un'azione senza etichetta mostra la chiave grezza:
                          meglio una parola tecnica che una riga vuota. */}
                      {AZIONI_LOG[r.azione as string] ? (
                        etichettaAzione(r.azione as string)
                      ) : (
                        <code>{r.azione as string}</code>
                      )}
                    </td>
                    <td className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                      {dettagliLeggibili(r.dettagli)}
                      {r.entita ? ` [${r.entita}]` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
