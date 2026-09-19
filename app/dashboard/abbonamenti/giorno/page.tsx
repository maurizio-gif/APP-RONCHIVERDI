import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { euro } from '@/lib/pipeline'
import { dataBreve, giornoPiu, mezzanotteRoma, oggiRoma, oraBreve } from '@/lib/agenda'
import { caricaAttivitaCommerciale, formattaVoceData } from '@/lib/attivitaCommerciale'

export const dynamic = 'force-dynamic'

type RigaVendita = {
  data_vendita: string
  abbonamento: string | null
  variante: string | null
  totale: number | null
  operatore_nome: string | null
  persona_id: string | null
  persone: { nome: string | null; cognome: string | null } | null
}

export default async function DettaglioGiornoPage({ searchParams }: { searchParams: { data?: string } }) {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  const oggi = oggiRoma()
  const giorno = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.data ?? '') ? searchParams.data! : oggi

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('abbonamenti')
    .select('data_vendita, abbonamento, variante, totale, operatore_nome, persona_id, persone(nome, cognome)')
    .gte('data_vendita', mezzanotteRoma(giorno))
    .lt('data_vendita', mezzanotteRoma(giornoPiu(giorno, 1)))
    .order('data_vendita', { ascending: false })

  const vendite = (data ?? []) as unknown as RigaVendita[]
  const totaleGiorno = vendite.reduce((s, v) => s + Number(v.totale ?? 0), 0)
  // Solo per le persone di queste vendite, non per l'anagrafica intera (vedi
  // lib/attivitaCommerciale.ts): un giorno ne porta al massimo qualche decina.
  const attivita = await caricaAttivitaCommerciale(
    supabase,
    vendite.map((v) => v.persona_id)
  )

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Abbonamenti</p>
        <h1>Dettaglio del giorno</h1>
        <p className="muted">
          Ogni abbonamento venduto in {dataBreve(giorno)}, dal più recente al più vecchio — {vendite.length} vendite,{' '}
          {euro(totaleGiorno)}.
        </p>
        <Link href="/dashboard/abbonamenti" className="muted">
          ← Torna ad Abbonamenti
        </Link>
      </div>

      <div className="report-mese-nav">
        <Link href={`/dashboard/abbonamenti/giorno?data=${giornoPiu(giorno, -1)}`} className="btn btn-ghost btn-sm">
          ← Giorno prec.
        </Link>
        <form action="/dashboard/abbonamenti/giorno" method="get" className="form-row">
          <input type="date" name="data" defaultValue={giorno} max={oggi} />
          <button type="submit" className="btn btn-ghost btn-sm">
            Vai
          </button>
        </form>
        {giorno < oggi ? (
          <Link href={`/dashboard/abbonamenti/giorno?data=${giornoPiu(giorno, 1)}`} className="btn btn-ghost btn-sm">
            Giorno succ. →
          </Link>
        ) : (
          <span className="btn btn-ghost btn-sm" aria-disabled="true">
            Giorno succ. →
          </span>
        )}
      </div>

      {error && /abbonamenti/.test(error.message) ? (
        <div className="card">
          <p className="vuoto">Errore nel leggere le vendite: {error.message}</p>
        </div>
      ) : vendite.length === 0 ? (
        <div className="card">
          <p className="vuoto">Nessuna vendita in questo giorno.</p>
        </div>
      ) : (
        <div className="card">
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Ora</th>
                  <th>Prodotto</th>
                  <th>Cliente</th>
                  <th>Operatore</th>
                  <th>Importo</th>
                </tr>
              </thead>
              <tbody>
                {vendite.map((v, i) => {
                  const storia = v.persona_id ? attivita.get(v.persona_id) : undefined
                  return (
                    <tr key={i}>
                      <td className="cella-nowrap">{oraBreve(v.data_vendita)}</td>
                      <td>
                        {v.abbonamento ?? '—'}
                        {v.variante && <span className="muted"> · {v.variante}</span>}
                      </td>
                      <td>
                        {v.persone ? `${v.persone.nome ?? ''} ${v.persone.cognome ?? ''}`.trim() || '—' : '—'}
                        {/* In evidenza solo se c'è stato un lavoro — una vendita
                            senza storia (un rinnovo al banco, un walk-in mai
                            passato dal sito) non porta nessun tag, invece di un
                            "non lavorato" che affollerebbe la lista senza dire
                            niente di più della sua stessa assenza. */}
                        {storia?.lavorata && (
                          <details className="tag-cronistoria">
                            <summary className="badge badge-info">
                              Lavorato · {storia.cronistoria.length}
                            </summary>
                            <ul className="cronistoria-mini">
                              {storia.cronistoria.map((voce) => (
                                <li key={voce.id}>
                                  <span className="muted">{formattaVoceData(voce.data)}</span> — {voce.etichetta}
                                  {voce.dettaglio && <span className="muted"> · {voce.dettaglio}</span>}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td>{v.operatore_nome ?? '—'}</td>
                      <td>{v.totale ? euro(v.totale) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
