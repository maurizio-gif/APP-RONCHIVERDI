import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { FONTE_MANUALE, type Persona } from '@/lib/persone'
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
  const [{ data, error }, { data: manuali }] = await Promise.all([
    supabase
      .from('persone_con_richieste')
      .select('id, nome, cognome, email, cellulare, note, richieste, richieste_da_lavorare, prima_richiesta, ultima_richiesta')
      // Chi ha scritto più di recente sta in cima: è l'ordine con cui si
      // guarda un'anagrafica di lavoro, non l'alfabetico.
      .order('ultima_richiesta', { ascending: false, nullsFirst: false })
      .limit(MAX_PERSONE),
    // Chi è stato inserito a mano dalla segreteria. La fonte non sta nella
    // vista dei conteggi, e serve a una cosa sola: un contatto con zero
    // richieste, in un'anagrafica che si popola dalle richieste del sito, va
    // spiegato — altrimenti si legge come una riga rotta. Si chiedono solo i
    // manuali, che sono pochi, e non la fonte di tutti.
    supabase.from('persone').select('id').eq('fonte', FONTE_MANUALE),
  ])

  if (error) console.error('Anagrafica non letta:', error.message)

  const idManuali = new Set((manuali ?? []).map((p) => p.id as string))
  const persone = ((data ?? []) as unknown as Persona[]).map((p) =>
    idManuali.has(p.id) ? { ...p, fonte: FONTE_MANUALE } : p
  )
  const daLavorare = persone.filter((p) => p.richieste_da_lavorare > 0).length

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Anagrafica</p>
        <h1>Contatti</h1>
        <p className="muted">
          Una scheda per persona, con tutte le sue richieste. Si popola da sé: il database riconosce
          chi ha già scritto dall’email o dal cellulare, anche scritti in modo diverso. Chi non ha
          mai scritto — arrivato al telefono o al banco — lo aggiunge la segreteria fissandogli
          qualcosa in agenda, ed è segnato «inserito a mano».
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
