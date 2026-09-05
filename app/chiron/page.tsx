import { entra, esci } from './actions'
import { accessoValido, codiceConfigurato } from './accesso'
import { Validatore } from './Validatore'

export const dynamic = 'force-dynamic'

// La pagina che usa il centro medico: sta fuori da /dashboard — il
// middleware non la protegge e nessuno del partner ha un account del
// pannello — e non mostra niente del Club oltre al nominativo del voucher
// che gli viene dettato.
export const metadata = {
  title: 'Validazione voucher · Ronchiverdi',
  // Non deve finire su Google: è un'interfaccia operativa, non una pagina
  // pubblica.
  robots: { index: false, follow: false },
}

export default function ChironPage({ searchParams }: { searchParams: { error?: string } }) {
  const configurato = codiceConfigurato() !== null

  if (!accessoValido()) {
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
          <p className="muted" style={{ marginBottom: '1rem' }}>
            Validazione dei voucher per la visita medico&#8209;sportiva.
          </p>

          {!configurato && (
            <p className="error-banner">
              Accesso non ancora configurato. Avvisa Ronchiverdi: il codice va impostato prima del
              go&#8209;live.
            </p>
          )}
          {searchParams.error === 'credenziali' && (
            <p className="error-banner">Codice di accesso errato.</p>
          )}

          <form action={entra}>
            <div className="field">
              <label htmlFor="codice_accesso">Codice di accesso</label>
              <input
                id="codice_accesso"
                name="codice_accesso"
                type="password"
                required
                autoComplete="current-password"
              />
            </div>
            <button type="submit" className="btn btn-block" disabled={!configurato}>
              Entra
            </button>
          </form>
        </div>
      </main>
    )
  }

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

        <p className="eyebrow">Visita medico-sportiva</p>
        <p className="muted" style={{ marginBottom: '1.25rem' }}>
          Inserisci il codice che il socio ti detta al telefono: la pagina dice se è valido e a chi
          è intestato, e lo registra come utilizzato quando confermi la prenotazione.
        </p>

        <Validatore />

        <form action={esci} style={{ marginTop: '1.5rem' }}>
          <button type="submit" className="btn btn-ghost btn-sm">
            Esci
          </button>
        </form>
      </div>
    </main>
  )
}
