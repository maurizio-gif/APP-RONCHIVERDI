import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { dataOra, nomePersona } from '@/lib/persone'
import { ETICHETTE_STATO, eStatoValido } from '@/lib/pipeline'

const MAX_RIGHE = 200

function stato(v: unknown): string {
  const s = v as string | null
  if (!s) return '—'
  return eStatoValido(s) ? ETICHETTE_STATO[s] : s
}

/**
 * Passaggi di stato e riassegnazioni delle trattative. In TCA questa vista
 * non c'è: qui serve perché il diritto di riassegnare permette di spostare
 * una trattativa che è di un altro, e una riassegnazione contestata si
 * ricostruisce solo se resta scritta.
 */
export async function StoricoTrattative() {
  const supabase = createSupabaseServiceClient()
  const { data: righe, error } = await supabase
    .from('opportunita_storico')
    .select(
      'id, cambiato_il, cambiato_da, stato_precedente, stato, assegnato_precedente, assegnato_a, opportunita_id'
    )
    .order('cambiato_il', { ascending: false })
    .limit(MAX_RIGHE)

  if (error) console.error('Storico trattative non letto:', error.message)
  const elenco = righe ?? []

  // Di chi era la trattativa: senza il nome della persona, una riga di
  // storico dice solo che qualcosa è cambiato, non su chi.
  const ids = [...new Set(elenco.map((r) => r.opportunita_id as string))]
  const { data: trattative } = ids.length
    ? await supabase.from('trattative').select('id, nome, cognome, email').in('id', ids)
    : { data: [] as any[] }

  const chi = new Map(
    (trattative ?? []).map((t) => [t.id as string, nomePersona(t as any)])
  )

  return (
    <div className="card">
      <div className="card-head">
        <h2>Passaggi delle trattative</h2>
        <span className="muted">
          {elenco.length}
          {elenco.length === MAX_RIGHE ? ' (i più recenti)' : ''}
        </span>
      </div>

      {elenco.length === 0 ? (
        <p className="vuoto">
          Nessun passaggio registrato: si scrive da sé a ogni cambio di stato o di assegnatario.
        </p>
      ) : (
        <div className="tabella-wrap">
          <table className="tabella">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Chi ha cambiato</th>
                <th>Trattativa di</th>
                <th>Stato</th>
                <th>Assegnatario</th>
              </tr>
            </thead>
            <tbody>
              {elenco.map((r) => {
                const statoCambiato = r.stato_precedente !== r.stato
                const assegnatarioCambiato = r.assegnato_precedente !== r.assegnato_a
                return (
                  <tr key={r.id as number}>
                    <td className="cella-nowrap">{dataOra(r.cambiato_il as string)}</td>
                    <td>{(r.cambiato_da as string) ?? '—'}</td>
                    <td>{chi.get(r.opportunita_id as string) ?? '—'}</td>
                    <td className="cella-nowrap">
                      {statoCambiato ? (
                        <>
                          {stato(r.stato_precedente)} → <strong>{stato(r.stato)}</strong>
                        </>
                      ) : (
                        <span className="muted">{stato(r.stato)}</span>
                      )}
                    </td>
                    <td className="cella-nowrap">
                      {assegnatarioCambiato ? (
                        <>
                          {(r.assegnato_precedente as string) ?? 'nessuno'} →{' '}
                          <strong>{(r.assegnato_a as string) ?? 'nessuno'}</strong>
                        </>
                      ) : (
                        <span className="muted">{(r.assegnato_a as string) ?? 'nessuno'}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
