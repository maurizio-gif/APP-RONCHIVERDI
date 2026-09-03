import { redirect } from 'next/navigation'
import { isStaffEmail } from '@/lib/auth/allowlist'
import { emailCorrente, getNomeUtente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { Sidebar } from './Sidebar'

// Il middleware ha già verificato la sessione con getUser() — una chiamata di
// rete a Supabase Auth — e ci passa l'email validata via header: non la
// richiediamo di nuovo qui, altrimenti ogni pagina del pannello pagherebbe
// due volte lo stesso round-trip. Qui controlliamo solo l'allowlist, così un
// utente Supabase Auth "generico" non vede i dati pur essendo autenticato.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const email = emailCorrente()

  // Come nella Server Action di login: il controllo va fuori dal try/catch,
  // perché redirect() segnala l'uscita lanciando e un catch lo scambierebbe
  // per un guasto.
  let autorizzata = false
  try {
    autorizzata = !!email && (await isStaffEmail(email))
  } catch (e) {
    console.error('dashboard: allowlist non verificabile', e)
    redirect('/login?error=servizio')
  }

  if (!email || !autorizzata) {
    redirect('/login?error=non-autorizzato')
  }

  const [sezioniConsentite, nomeUtente] = await Promise.all([
    getSezioniConsentite(email),
    getNomeUtente(email),
  ])

  return (
    <div className="app-shell">
      <Sidebar email={email} nomeUtente={nomeUtente} sezioniConsentite={sezioniConsentite} />
      <main className="main-content">{children}</main>
    </div>
  )
}
