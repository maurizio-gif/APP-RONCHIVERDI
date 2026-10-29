import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { ScriptAccessiMancante, caricaGruppiAccessi, caricaVarchi } from '@/lib/accessi-server'
import { NavAccessi } from '../NavAccessi'
import { AssegnaVarchi, NuovoGruppo, RigaGruppo } from './GestioneGruppi'

export const dynamic = 'force-dynamic'

// I gruppi di varchi («Palestra», «Piscina», «Ingresso club»...): servono a
// leggere i numeri per zona invece che per singolo tornello. Un varco sta in
// un solo gruppo; i gruppi si applicano in lettura, quindi cambiarli
// ricalcola anche i grafici sul passato.
export default async function GruppiAccessiPage() {
  if (!(await utenteHaSezione('accessi'))) redirect('/dashboard')

  const db = createSupabaseServiceClient()
  let gruppi, varchi
  try {
    ;[gruppi, varchi] = await Promise.all([caricaGruppiAccessi(db), caricaVarchi(db)])
  } catch (e) {
    if (e instanceof ScriptAccessiMancante) {
      return (
        <>
          <div className="page-head">
            <h1>Accessi</h1>
          </div>
          <div className="card card-avviso">
            <p className="card-nota">{e.message}</p>
          </div>
        </>
      )
    }
    throw e
  }
  const perGruppo = new Map<string, number>()
  for (const v of varchi) if (v.gruppoId) perGruppo.set(v.gruppoId, (perGruppo.get(v.gruppoId) ?? 0) + 1)
  const senzaGruppo = varchi.filter((v) => !v.gruppoId).length

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Report</p>
        <h1>Accessi</h1>
        <p className="muted">Raggruppa i varchi per leggere gli ingressi per zona: palestra, piscina, ingresso club...</p>
        <NavAccessi attiva="gruppi" />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Gruppi</h2>
          <span className="muted">{gruppi.length === 0 ? 'nessuno' : gruppi.length === 1 ? '1 gruppo' : `${gruppi.length} gruppi`}</span>
        </div>
        {gruppi.length > 0 && (
          <ul className="accessi-gruppi">
            {gruppi.map((g) => (
              <RigaGruppo key={g.id} gruppo={g} varchi={perGruppo.get(g.id) ?? 0} />
            ))}
          </ul>
        )}
        <NuovoGruppo />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Varchi</h2>
          <span className="muted">{senzaGruppo === 0 ? 'tutti assegnati' : `${senzaGruppo} senza gruppo`}</span>
        </div>
        {gruppi.length === 0 ? (
          <p className="vuoto">Crea almeno un gruppo per poter assegnare i varchi.</p>
        ) : (
          <AssegnaVarchi varchi={varchi} gruppi={gruppi} />
        )}
        <p className="muted card-nota">
          Info4U distingue il tipo di lettore ma non il verso di marcia: «ingresso» e «uscita» del tornello sono varchi diversi, e puoi tenerli nello stesso
          gruppo.
        </p>
      </div>
    </>
  )
}
