import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { euro } from '@/lib/pipeline'

// Il recupero dei mancati rinnovi, misurato.
//
// Dal 15 ottobre 2026 chi non rinnova un abbonamento Core entro 30 giorni
// diventa un lead di recupero per il settore New (crea_trattative_recupero,
// scripts/sql/2026-10-15-recupero-mancati-rinnovi.sql). La domanda giusta non
// è «quanti ne abbiamo recuperati» ma «quanti in più di quelli che sarebbero
// tornati da soli»: una parte degli ex soci torna comunque, soprattutto i più
// fedeli. Per questo accanto al tasso di rientro dei lead di recupero c'è il
// ritorno spontaneo degli anni passati (ritorno_spontaneo_mancati_rinnovi):
// fra chi non aveva rinnovato a 30 giorni, quanti sono tornati entro il 90°
// giorno, per la stessa fascia di anzianità. Il recupero funziona se la prima
// colonna sta sopra la seconda.
//
// Le fasce sono le stesse dei due lati: «1° anno» è chi aveva un solo
// abbonamento annuale (o un 3-6 mesi), «5+ anni» chi ne aveva cinque o più.

const FASCE = ['1° anno', '2° anno', '3-4 anni', '5+ anni'] as const
type Fascia = (typeof FASCE)[number]

function fasciaDi(anni: number | null): Fascia {
  if (anni == null || anni <= 1) return '1° anno'
  if (anni === 2) return '2° anno'
  if (anni <= 4) return '3-4 anni'
  return '5+ anni'
}

type Riga = { create: number; aperte: number; vinte: number; perse: number; valore: number }

function percentuale(parte: number, totale: number): string {
  return totale > 0 ? `${Math.round((parte / totale) * 100)}%` : '—'
}

export async function RecuperoMancatiRinnovi() {
  const supabase = createSupabaseServiceClient()
  const [{ data: lead, error }, { data: storico }] = await Promise.all([
    supabase
      .from('opportunita')
      .select('stato, recupero_anni, valore_euro')
      .eq('origine', 'recupero-rinnovo')
      .neq('stato', 'annullato'),
    supabase.rpc('ritorno_spontaneo_mancati_rinnovi'),
  ])

  if (error) {
    console.error('Recupero mancati rinnovi non letto:', error.message)
    return null
  }
  if (!lead || lead.length === 0) return null

  const righe = new Map<Fascia, Riga>(FASCE.map((f) => [f, { create: 0, aperte: 0, vinte: 0, perse: 0, valore: 0 }]))
  for (const l of lead) {
    const r = righe.get(fasciaDi(l.recupero_anni != null ? Number(l.recupero_anni) : null))!
    r.create += 1
    if (l.stato === 'vinto') {
      r.vinte += 1
      if (l.valore_euro != null) r.valore += Number(l.valore_euro)
    } else if (l.stato === 'perso') r.perse += 1
    else r.aperte += 1
  }

  const spontaneo = new Map<string, { non_rinnovati: number; tornati_entro_90: number }>()
  for (const s of (storico ?? []) as { fascia: string; non_rinnovati: number; tornati_entro_90: number }[]) {
    spontaneo.set(s.fascia, { non_rinnovati: Number(s.non_rinnovati), tornati_entro_90: Number(s.tornati_entro_90) })
  }

  const totale = [...righe.values()].reduce(
    (a, r) => ({
      create: a.create + r.create,
      aperte: a.aperte + r.aperte,
      vinte: a.vinte + r.vinte,
      perse: a.perse + r.perse,
      valore: a.valore + r.valore,
    }),
    { create: 0, aperte: 0, vinte: 0, perse: 0, valore: 0 }
  )
  const spontaneoTotale = [...spontaneo.values()].reduce(
    (a, s) => ({ non_rinnovati: a.non_rinnovati + s.non_rinnovati, tornati_entro_90: a.tornati_entro_90 + s.tornati_entro_90 }),
    { non_rinnovati: 0, tornati_entro_90: 0 }
  )

  return (
    <div className="card">
      <div className="card-head">
        <h2>Recupero mancati rinnovi</h2>
        <span className="muted">dall’inizio, lead aperti a 31 giorni dalla scadenza</span>
      </div>
      <p className="card-nota muted">
        Rientrati = trattative di recupero chiuse vinte (si chiudono da sole quando la persona ricompra). Il
        ritorno spontaneo è quello degli anni passati: fra chi non rinnovava a 30 giorni, quanti tornavano da
        soli entro il 90° giorno. Il recupero funziona se la prima percentuale supera la seconda.
      </p>

      <div className="tabella-wrap">
        <table className="tabella">
          <thead>
            <tr>
              <th>Anzianità</th>
              <th>Lead creati</th>
              <th>Aperti</th>
              <th>Rientrati</th>
              <th>Persi</th>
              <th>
                Tasso di rientro
                <span className="th-nota">rientrati sui creati</span>
              </th>
              <th>
                Ritorno spontaneo
                <span className="th-nota">2021-2025, entro 90 giorni</span>
              </th>
              <th>Valore</th>
            </tr>
          </thead>
          <tbody>
            {FASCE.map((f) => {
              const r = righe.get(f)!
              const s = spontaneo.get(f)
              return (
                <tr key={f}>
                  <td>{f}</td>
                  <td>{r.create}</td>
                  <td>{r.aperte}</td>
                  <td>{r.vinte}</td>
                  <td>{r.perse}</td>
                  <td>{percentuale(r.vinte, r.create)}</td>
                  <td className="muted">{s ? percentuale(s.tornati_entro_90, s.non_rinnovati) : '—'}</td>
                  <td className="cella-valore">{r.valore > 0 ? euro(r.valore) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th>Totale</th>
              <th>{totale.create}</th>
              <th>{totale.aperte}</th>
              <th>{totale.vinte}</th>
              <th>{totale.perse}</th>
              <th>{percentuale(totale.vinte, totale.create)}</th>
              <th className="muted">
                {percentuale(spontaneoTotale.tornati_entro_90, spontaneoTotale.non_rinnovati)}
              </th>
              <th className="cella-valore">{totale.valore > 0 ? euro(totale.valore) : '—'}</th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
