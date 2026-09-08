import Link from 'next/link'
import { chiediRecupero } from './actions'
import { RichiediButton } from './RichiediButton'

export const dynamic = 'force-dynamic'

export default function RecuperaPasswordPage({
  searchParams,
}: {
  searchParams: { error?: string; inviata?: string }
}) {
  return (
    <main className="login-shell">
      <div className="login-card">
        <h1 className="login-brand">
          <img
            src="/logo-ronchiverdi-sport.png"
            alt="Ronchiverdi Sport Club"
            className="brand-logo brand-logo-lg"
          />
        </h1>

        {searchParams.inviata ? (
          <>
            <h2 className="recupero-titolo">Controlla la posta</h2>
            {/* Lo stesso messaggio sia che l'indirizzo esista sia che no: vedi
                il commento in actions.ts — distinguerli farebbe di questa
                pagina un modo per scoprire chi lavora al club. */}
            <p className="muted">
              Se quell&apos;indirizzo è abilitato al pannello, gli è appena arrivata un&apos;email con
              il link per scegliere una password nuova.
            </p>
            <p className="muted">
              Non la trovi? Guarda nello spam, e controlla di aver scritto l&apos;indirizzo con cui
              entri nel pannello.
            </p>
            <Link href="/login" className="btn btn-block">
              Torna al login
            </Link>
          </>
        ) : (
          <>
            <h2 className="recupero-titolo">Password dimenticata</h2>
            <p className="muted">
              Scrivi l&apos;email con cui entri nel pannello: ti arriva un link per sceglierne una
              nuova.
            </p>

            {searchParams.error && <p className="error-banner">{searchParams.error}</p>}

            <form action={chiediRecupero}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>
              <RichiediButton />
            </form>

            <p className="recupero-torna">
              <Link href="/login" className="link">
                ← Torna al login
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  )
}
