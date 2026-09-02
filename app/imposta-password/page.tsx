import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/serverClient'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { impostaPassword } from './actions'
import { SalvaButton } from './SalvaButton'

export default async function ImpostaPasswordPage({
  searchParams,
}: {
  searchParams: { error?: string }
}) {
  const supabase = createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Nome e cognome li ha già indicati chi ha invitato: qui sono precompilati,
  // la persona può solo correggerli.
  const supabaseService = createSupabaseServiceClient()
  const { data: staffRow } = await supabaseService
    .from('staff_users')
    .select('nome, cognome')
    .eq('email', user.email ?? '')
    .maybeSingle()

  return (
    <main className="login-shell">
      <div className="login-card">
        <h1>Imposta la password</h1>
        <p className="muted" style={{ marginBottom: '1.25rem' }}>
          Ciao {user.email}, scegli una password per accedere al pannello. Nome e cognome sono già
          compilati con quelli indicati da chi ti ha invitato: correggili se serve.
        </p>

        {searchParams.error && <p className="error-banner">{searchParams.error}</p>}

        <form action={impostaPassword}>
          <div className="field">
            <label htmlFor="nome">Nome</label>
            <input
              id="nome"
              name="nome"
              type="text"
              required
              autoComplete="given-name"
              defaultValue={staffRow?.nome ?? ''}
            />
          </div>
          <div className="field">
            <label htmlFor="cognome">Cognome</label>
            <input
              id="cognome"
              name="cognome"
              type="text"
              required
              autoComplete="family-name"
              defaultValue={staffRow?.cognome ?? ''}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
            <p className="field-hint">Almeno 8 caratteri.</p>
          </div>
          <div className="field">
            <label htmlFor="conferma">Conferma password</label>
            <input
              id="conferma"
              name="conferma"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <SalvaButton />
        </form>
      </div>
    </main>
  )
}
