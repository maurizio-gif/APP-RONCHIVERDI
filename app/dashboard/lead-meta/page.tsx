import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { ORIGINE_META_LEAD, provenienzaDiOrigine } from '@/lib/provenienza'
import { CaricaLeadMetaForm } from './CaricaLeadMetaForm'

export const dynamic = 'force-dynamic'

const STATI: Record<string, string> = {
  nuovo: 'Da prendere in carico',
  in_gestione: 'In gestione',
  vinto: 'Vinta',
  perso: 'Persa',
  annullato: 'Annullata',
}

type RigaLead = {
  id: string
  created_at: string
  nome: string | null
  cognome: string | null
  email: string | null
  cellulare: string | null
  utm_campaign: string | null
  opportunita: { stato: string | null; assegnato_a: string | null } | null
}

// I lead dei moduli Meta si caricano qui a mano (vedi CaricaLeadMetaForm e
// caricaLeadMeta): ognuno diventa una richiesta Club con la targhetta «Meta
// Lead Ads», e la trattativa che ne nasce si prende in carico dalla Dashboard
// come tutte le altre. Questa pagina serve a caricarli e a vedere cosa è
// già stato caricato e a che punto è.
export default async function LeadMetaPage() {
  if (!(await utenteHaSezione('lead-meta'))) {
    redirect('/dashboard')
  }

  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('form_contatti')
    .select('id, created_at, nome, cognome, email, cellulare, utm_campaign, opportunita(stato, assegnato_a)')
    .eq('origine', ORIGINE_META_LEAD)
    .order('created_at', { ascending: false })
    .limit(50)
  const righe = (data ?? []) as unknown as RigaLead[]
  const tag = provenienzaDiOrigine(ORIGINE_META_LEAD)

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Segreteria</p>
        <h1>Lead Meta</h1>
        <p className="muted">
          I contatti raccolti con i moduli delle sponsorizzate su Facebook e Instagram. Una volta
          caricati compaiono in{' '}
          <Link className="link" href="/dashboard">
            Dashboard
          </Link>{' '}
          con la targhetta <span className={`tag-provenienza ${tag.classe}`}>{tag.etichetta}</span>,
          da prendere in carico.
        </p>
      </div>

      <CaricaLeadMetaForm />

      <section className="card">
        <div className="card-head">
          <h2>Ultimi caricati</h2>
        </div>
        {righe.length === 0 ? (
          <p className="muted">Nessun lead Meta caricato finora.</p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Caricato</th>
                  <th>Contatto</th>
                  <th>Campagna</th>
                  <th>Trattativa</th>
                </tr>
              </thead>
              <tbody>
                {righe.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {new Date(r.created_at).toLocaleString('it-IT', {
                        timeZone: 'Europe/Rome',
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td>
                      <span className={`tag-provenienza ${tag.classe}`}>{tag.etichetta}</span>{' '}
                      {[r.nome, r.cognome].filter(Boolean).join(' ')}
                      <br />
                      <span className="muted">{[r.cellulare, r.email].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td>{r.utm_campaign ?? '—'}</td>
                    <td>
                      {r.opportunita
                        ? `${STATI[r.opportunita.stato ?? ''] ?? r.opportunita.stato}${
                            r.opportunita.assegnato_a ? ` · ${r.opportunita.assegnato_a}` : ''
                          }`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
