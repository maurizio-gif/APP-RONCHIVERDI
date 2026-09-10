import { redirect } from 'next/navigation'
import { isStaffEmail } from '@/lib/auth/allowlist'
import { emailCorrente, getNomeUtente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { SEZIONE_NOTIFICHE } from '@/lib/notifiche'
import { contaNonLette } from './notifiche/actions'
import { puoRicevereAvvisoOpportunita } from './opportunita-actions'
import { AvvisoOpportunita } from './AvvisoOpportunita'
import { NotificheProvider } from './NotificheProvider'
import { NotificheBanner } from './NotificheBanner'
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

  // Le tre letture partono insieme e non in fila: questo layout gira davanti
  // a ogni pagina del pannello, e in serie sarebbero tre andate e ritorni
  // verso Supabase prima che la pagina cominci a caricare i propri dati.
  //
  // Il conteggio si chiede anche a chi poi non lo vedrà: è una lettura
  // indicizzata su una tabella piccola, e aspettare di sapere se ha il
  // permesso per poterla chiedere costerebbe più della lettura stessa. Il
  // permesso decide cosa si mostra, non cosa si chiede.
  const [sezioniConsentite, nomeUtente, nonLette, avvisoOpportunita] = await Promise.all([
    getSezioniConsentite(email),
    getNomeUtente(email),
    contaNonLette(),
    // Legge la stessa riga di staff_users delle altre tre, che
    // rigaStaffCorrente tiene in cache per la durata della richiesta: non è
    // un round trip in più.
    puoRicevereAvvisoOpportunita(),
  ])

  // Chi non ha il permesso non riceve niente: nessun badge, nessun avviso,
  // nessun polling lato client (vedi NotificheProvider).
  const riceveMessaggi = sezioniConsentite.includes(SEZIONE_NOTIFICHE)

  return (
    <NotificheProvider abilitato={riceveMessaggi} nonLetteIniziali={riceveMessaggi ? nonLette : 0}>
      <div className="app-shell">
        <Sidebar
          email={email}
          nomeUtente={nomeUtente}
          sezioniConsentite={sezioniConsentite}
          riceveAvvisoSonoro={avvisoOpportunita}
        />
        <main className="main-content">
          <NotificheBanner />
          {/* Solo per i commerciali con la sezione Club e Family: prendere in
              carico è un loro diritto, e avvisare chi non può agire sarebbe
              rumore. */}
          <AvvisoOpportunita abilitato={avvisoOpportunita} />
          {children}
        </main>
      </div>
    </NotificheProvider>
  )
}
