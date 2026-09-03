import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import type { Persona } from '@/lib/persone'
import { RicercaPersone } from './RicercaPersone'

export const dynamic = 'force-dynamic'

// Quante persone si portano in pagina. Con la ricerca lato client serve un
// tetto: oltre questo numero l'elenco andrà paginato o filtrato sul server.
const MAX_PERSONE = 500

export default async function PersonePage() {
  if (!(await utenteHaSezione('persone'))) {
    redirect('/dashboard')
  }

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('persone_con_richieste')
    .select('id, nome, cognome, email, cellulare, note, richieste, richieste_da_lavorare, prima_richiesta, ultima_richiesta')
    // Chi ha scritto più di recente sta in cima: è l'ordine con cui si
    // guarda un'anagrafica di lavoro, non l'alfabetico.
    .order('ultima_richiesta', { ascending: false, nullsFirst: false })
    .limit(MAX_PERSONE)

  if (error) console.error('Anagrafica non letta:', error.message)

  const persone = (data ?? []) as unknown as Persona[]
  const daLavorare = persone.filter((p) => p.richieste_da_lavorare > 0).length

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Anagrafica</p>
        <h1>Contatti</h1>
        <p className="muted">
          Una scheda per persona, con tutte le sue richieste. Si popola da sé: il database riconosce
          chi ha già scritto dall’email o dal cellulare, anche scritti in modo diverso.
        </p>
      </div>

      <div className="griglia-stat">
        <div className="stat">
          <span className="stat-valore">{persone.length}</span>
          <span className="stat-label">In anagrafica</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{daLavorare}</span>
          <span className="stat-label">Con richieste da lavorare</span>
        </div>
      </div>

      <RicercaPersone persone={persone} />
    </>
  )
}
