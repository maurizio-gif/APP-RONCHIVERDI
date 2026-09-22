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
  const [{ data, error }, { data: manuali }, { count: totalePersone }, { data: inGestione }] = await Promise.all([
    supabase
      .from('persone_con_richieste')
      .select('id, nome, cognome, email, cellulare, note, richieste, richieste_da_lavorare, prima_richiesta, ultima_richiesta')
      // Chi ha scritto più di recente sta in cima: è l'ordine con cui si
      // guarda un'anagrafica di lavoro, non l'alfabetico. Con l'arrivo dei
      // contatti Info4U (senza nessuna richiesta dal sito, quindi in fondo a
      // questo ordinamento) questo elenco è "attività recente", non "tutti":
      // chi non c'è si trova con la ricerca, che guarda l'anagrafica intera
      // (vedi RicercaPersone/cercaPersone).
      .order('ultima_richiesta', { ascending: false, nullsFirst: false })
      .limit(MAX_PERSONE),
    // Chi è stato inserito a mano dalla segreteria. La fonte non sta nella
    // vista dei conteggi, e serve a una cosa sola: un contatto con zero
    // richieste, in un'anagrafica che si popola dalle richieste del sito, va
    // spiegato — altrimenti si legge come una riga rotta. Si chiedono solo i
    // manuali, che sono pochi, e non la fonte di tutti.
    supabase.from('persone').select('id').eq('fonte', FONTE_MANUALE),
    // Il vero totale, non le sole 500 caricate: senza, la statistica
    // "In anagrafica" mentirebbe proprio sul numero che i contatti storici
    // importati da Info4U hanno reso sbagliato.
    supabase.from('persone').select('id', { count: 'exact', head: true }),
    // Chi ha una trattativa aperta (da prendere in carico o già in
    // gestione), per il filtro omonimo. Si chiede anche lo stato, non solo
    // l'id: la riga mostra a che punto è, non solo che ce n'è una.
    supabase.from('opportunita').select('persona_id, stato').in('stato', ['nuovo', 'in_gestione']),
  ])

  if (error) console.error('Anagrafica non letta:', error.message)

  // Una persona ha al più una trattativa aperta per volta (vedi
  // lib/trattative-server.ts): se mai ce ne fossero due, «in gestione» vince
  // su «da prendere in carico», perché è lo stato più avanzato.
  const statoTrattativaAperta = new Map<string, 'nuovo' | 'in_gestione'>()
  for (const t of inGestione ?? []) {
    const id = t.persona_id as string | null
    if (!id) continue
    if (t.stato === 'in_gestione' || !statoTrattativaAperta.has(id)) {
      statoTrattativaAperta.set(id, t.stato as 'nuovo' | 'in_gestione')
    }
  }
  const idTrattativaAperta = Array.from(statoTrattativaAperta.keys())

  // Una trattativa aperta non vuol dire una richiesta recente: chi è
  // arrivato al banco o da Info4U può stare fuori dalle 500 caricate, e il
  // filtro la perderebbe proprio mentre qualcuno la lavora. Chi manca si
  // carica a parte e si accoda.
  const caricate = (data ?? []) as unknown as Persona[]
  const giaCaricati = new Set(caricate.map((p) => p.id))
  const mancanti = idTrattativaAperta.filter((id) => !giaCaricati.has(id))
  let aggiunte: Persona[] = []
  if (mancanti.length > 0) {
    const { data: extra, error: erroreExtra } = await supabase
      .from('persone_con_richieste')
      .select('id, nome, cognome, email, cellulare, note, richieste, richieste_da_lavorare, prima_richiesta, ultima_richiesta')
      .in('id', mancanti)
    if (erroreExtra) console.error('Contatti con trattativa aperta non letti:', erroreExtra.message)
    aggiunte = (extra ?? []) as unknown as Persona[]
  }

  const idManuali = new Set((manuali ?? []).map((p) => p.id as string))
  const persone = [...caricate, ...aggiunte].map((p) =>
    idManuali.has(p.id) ? { ...p, fonte: FONTE_MANUALE } : p
  )
  const daLavorare = persone.filter((p) => p.richieste_da_lavorare > 0).length

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Anagrafica</p>
        <h1>Contatti</h1>
        <p className="muted">
          Una scheda per persona, con tutte le sue richieste e i suoi abbonamenti. Si popola da sé: il
          database riconosce chi ha già scritto dall’email o dal cellulare, anche scritti in modo
          diverso, e chi ha comprato un abbonamento in Info4U anche se non ha mai scritto dal sito.
          Chi non ha mai scritto — arrivato al telefono o al banco — lo aggiunge la segreteria
          fissandogli qualcosa in agenda, ed è segnato «inserito a mano». L’elenco qui sotto mostra
          l’attività più recente: per uno storico, cerca il suo nome.
        </p>
      </div>

      <div className="griglia-stat">
        <div className="stat">
          <span className="stat-valore">{totalePersone ?? persone.length}</span>
          <span className="stat-label">In anagrafica</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{daLavorare}</span>
          <span className="stat-label">Con richieste da lavorare</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{idTrattativaAperta.length}</span>
          <span className="stat-label">Con trattativa in gestione</span>
        </div>
      </div>

      <RicercaPersone persone={persone} statoTrattativa={Object.fromEntries(statoTrattativaAperta)} />
    </>
  )
}
