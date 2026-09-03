import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { puoAmministrare } from '@/lib/auth/permessi'
import { invitaStaff } from './actions'
import { RigaUtente, type DatiUtente } from './RigaUtente'

export const dynamic = 'force-dynamic'

/** La riga come arriva dal database: i campi che la lista mostra, più la data d'ordinamento. */
type RigaStaff = DatiUtente & { created_at: string }

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
    .select('email, nome, cognome, sezioni_consentite, puo_invitare, puo_cancellare, commerciale, puo_riassegnare, created_at')
    .order('created_at', { ascending: true })

  const utenti = (data ?? []) as RigaStaff[]

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
              Parte senza permessi e con le sole sezioni operative: il diritto commerciale — quello
              che permette di prendere in carico le trattative — si dà aprendo la persona
              nell&apos;elenco qui sotto.
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
          <ul className="utenti">
            {utenti.map((u) => (
              <RigaUtente
                key={u.email}
                u={u}
                amministra={amministra}
                eSeStesso={u.email === email}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
