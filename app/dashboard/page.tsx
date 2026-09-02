import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getNomeUtente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { puoAmministrare } from '@/lib/auth/permessi'
import { SEZIONI } from '@/lib/auth/sezioni'
import { canaleDiRichiesta } from '@/lib/richieste'

export const dynamic = 'force-dynamic'

// Conteggi di apertura: i lead che il sito ha raccolto e le sessioni
// registrate da /api/track. Sono le due tabelle che esistono già oggi — i
// numeri dei moduli in arrivo si aggiungeranno qui quando quei moduli
// arriveranno, senza cambiare la struttura della pagina.
async function contatori() {
  const supabase = createSupabaseServiceClient()

  const [lead, leadDaLavorare, sessioni, sessioniConvertite] = await Promise.all([
    supabase.from('form_contatti').select('*', { count: 'exact', head: true }),
    supabase.from('form_contatti').select('*', { count: 'exact', head: true }).eq('gestito', false),
    supabase.from('sessioni').select('*', { count: 'exact', head: true }),
    supabase.from('sessioni').select('*', { count: 'exact', head: true }).eq('convertita', true),
  ])

  return {
    lead: lead.count ?? 0,
    leadDaLavorare: leadDaLavorare.count ?? 0,
    sessioni: sessioni.count ?? 0,
    sessioniConvertite: sessioniConvertite.count ?? 0,
  }
}

/**
 * Le richieste che non corrispondono a nessun canale (vedi lib/richieste.ts):
 * un'attività nuova sul sito non ancora instradata, o una richiesta tennis
 * arrivata senza settore. Non finiscono nella sezione di nessuno, quindi
 * senza questa spia resterebbero invisibili — che è il modo più silenzioso di
 * perdere un contatto.
 */
async function richiesteNonInstradate() {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('form_contatti')
    .select('attivita, settore, origine')
    .eq('gestito', false)
    .limit(500)

  const fuori = (data ?? []).filter((r) => !canaleDiRichiesta(r))
  const motivi = new Map<string, number>()
  for (const r of fuori) {
    const chiave = r.attivita ? `attività "${r.attivita}"${r.settore ? '' : ' (senza settore)'}` : `origine "${r.origine ?? 'non indicata'}"`
    motivi.set(chiave, (motivi.get(chiave) ?? 0) + 1)
  }
  return { totale: fuori.length, motivi: [...motivi.entries()] }
}

export default async function RiepilogoPage() {
  const email = emailCorrente()
  const [nomeUtente, sezioniConsentite, numeri, amministra] = await Promise.all([
    getNomeUtente(email),
    getSezioniConsentite(email),
    contatori(),
    puoAmministrare(email),
  ])

  // La spia interessa solo chi amministra: è lui che aggiunge un canale.
  const nonInstradate = amministra ? await richiesteNonInstradate() : { totale: 0, motivi: [] }

  const conversione =
    numeri.sessioni > 0 ? Math.round((numeri.sessioniConvertite / numeri.sessioni) * 1000) / 10 : 0

  const inArrivo = SEZIONI.filter((s) => s.inArrivo && sezioniConsentite.includes(s.chiave))

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Pannello Ronchiverdi</p>
        <h1>{nomeUtente ? `Ciao ${nomeUtente.split(' ')[0]}` : 'Riepilogo'}</h1>
        <p className="muted">Richieste dal sito e traffico delle campagne.</p>
      </div>

      <div className="griglia-stat">
        <div className="stat">
          <span className="stat-valore">{numeri.lead}</span>
          <span className="stat-label">Richieste totali</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{numeri.leadDaLavorare}</span>
          <span className="stat-label">Ancora da lavorare</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{numeri.sessioni}</span>
          <span className="stat-label">Sessioni sul sito</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{conversione}%</span>
          <span className="stat-label">Sessioni che convertono</span>
        </div>
      </div>

      {nonInstradate.totale > 0 && (
        <div className="card" style={{ borderColor: 'rgba(138, 100, 16, 0.35)' }}>
          <div className="card-head">
            <h2>Richieste senza sezione</h2>
            <span className="badge badge-warn">{nonInstradate.totale} da instradare</span>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            Queste richieste non compaiono nella sezione di nessun responsabile: va aggiunto il
            canale corrispondente in <code>lib/richieste.ts</code>.
          </p>
          <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.1rem' }}>
            {nonInstradate.motivi.map(([motivo, quante]) => (
              <li key={motivo} style={{ marginBottom: '0.35rem' }}>
                {motivo} — {quante} {quante === 1 ? 'richiesta' : 'richieste'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {inArrivo.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Moduli in arrivo</h2>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            Hai già il permesso per queste sezioni: appariranno nel menu appena il modulo è pronto.
          </p>
          <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.1rem' }}>
            {inArrivo.map((s) => (
              <li key={s.chiave} style={{ marginBottom: '0.35rem' }}>
                {s.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
