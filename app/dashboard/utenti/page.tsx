import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { puoAmministrare } from '@/lib/auth/permessi'
import { invitaStaff, impostaPuoCancellare, impostaPuoInvitare } from './actions'
import { TogglePermesso } from './TogglePermesso'
import { SezioniToggle } from './SezioniToggle'
import { RimuoviButton } from './RimuoviButton'

export const dynamic = 'force-dynamic'

type RigaUtente = {
  email: string
  nome: string | null
  cognome: string | null
  sezioni_consentite: string[] | null
  puo_invitare: boolean
  puo_cancellare: boolean
  created_at: string
}

export default async function UtentiPage({
  searchParams,
}: {
  searchParams: { error?: string; ok?: string }
}) {
  // Doppio controllo: la sezione deve essere fra quelle consentite, e le
  // modifiche restano possibili solo a chi amministra. Chi ha la sezione ma
  // non il permesso vede l'elenco in sola lettura — sapere chi ha accesso al
  // pannello è utile anche senza poterlo cambiare.
  if (!(await utenteHaSezione('utenti'))) {
    redirect('/dashboard')
  }

  const email = emailCorrente()
  const amministra = await puoAmministrare(email)

  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('staff_users')
    .select('email, nome, cognome, sezioni_consentite, puo_invitare, puo_cancellare, created_at')
    .order('created_at', { ascending: true })

  const utenti = (data ?? []) as RigaUtente[]

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Amministrazione</p>
        <h1>Gestione utenti</h1>
        <p className="muted">
          Chi può entrare nel pannello e cosa può vedere. Togliere una sezione la fa sparire dal
          menu di quella persona al caricamento successivo.
        </p>
      </div>

      {searchParams.error && <p className="error-banner">{searchParams.error}</p>}
      {searchParams.ok === 'invito' && (
        <p className="ok-banner">
          Invito inviato. La persona riceve un&apos;email con il link per scegliere la password.
        </p>
      )}

      {!amministra && (
        <p className="banner">
          Puoi vedere l&apos;elenco ma non modificarlo: serve il permesso «Può invitare e
          amministrare».
        </p>
      )}

      {amministra && (
        <div className="card">
          <div className="card-head">
            <h2>Invita una persona</h2>
          </div>
          <form action={invitaStaff}>
            <div className="form-row">
              <div className="field">
                <label htmlFor="nome">Nome</label>
                <input id="nome" name="nome" type="text" required autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="cognome">Cognome</label>
                <input id="cognome" name="cognome" type="text" required autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" name="email" type="email" required autoComplete="off" />
              </div>
            </div>
            <p className="field-hint" style={{ marginBottom: '1rem' }}>
              Parte senza permessi di amministrazione e con le sole sezioni operative: allarga tu
              quello che serve dalla tabella qui sotto.
            </p>
            <button type="submit" className="btn">
              Invia invito
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Persone con accesso</h2>
          <span className="muted">{utenti.length} in totale</span>
        </div>

        {utenti.length === 0 ? (
          <p className="vuoto">
            Nessun utente in tabella. Il primo va inserito da Supabase, poi da qui si invitano gli
            altri.
          </p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Permessi</th>
                  <th>Sezioni visibili</th>
                  {amministra && <th />}
                </tr>
              </thead>
              <tbody>
                {utenti.map((u) => {
                  const eSeStesso = u.email === email
                  return (
                    <tr key={u.email}>
                      <td>
                        <strong>{[u.nome, u.cognome].filter(Boolean).join(' ') || '—'}</strong>
                        <br />
                        <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                          {u.email}
                        </span>
                        {eSeStesso && (
                          <>
                            <br />
                            <span className="badge">tu</span>
                          </>
                        )}
                      </td>
                      <td>
                        <TogglePermesso
                          email={u.email}
                          valoreIniziale={u.puo_invitare}
                          etichetta="Può invitare e amministrare"
                          azione={impostaPuoInvitare}
                          disabilitato={!amministra || eSeStesso}
                          motivoDisabilitato={
                            eSeStesso
                              ? 'Non puoi togliere a te stesso il permesso di amministrare'
                              : 'Serve il permesso di amministrare'
                          }
                        />
                        <TogglePermesso
                          email={u.email}
                          valoreIniziale={u.puo_cancellare}
                          etichetta="Può cancellare record"
                          azione={impostaPuoCancellare}
                          disabilitato={!amministra}
                          motivoDisabilitato="Serve il permesso di amministrare"
                        />
                      </td>
                      <td>
                        <SezioniToggle
                          email={u.email}
                          sezioniIniziali={u.sezioni_consentite ?? []}
                          disabilitato={!amministra}
                        />
                      </td>
                      {amministra && (
                        <td className="cella-nowrap">
                          <RimuoviButton email={u.email} disabilitato={eSeStesso} />
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
