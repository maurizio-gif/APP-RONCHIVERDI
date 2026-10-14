import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { nomeStaff, ordinaPerCognome, type RigaStaff } from '@/lib/staff'
import { PhoneEmailInForm, type CommercialeLead } from './PhoneEmailInForm'

export const dynamic = 'force-dynamic'

// `staff=1` dice allo script di tracciamento del sito (tracking.client.js)
// di non aprire nessuna sessione: chi clicca da qui è la segreteria, sul PC
// del banco, non il lead sul suo telefono.
const LINK_GUEST_REGISTER = 'https://www.ronchiverdi.it/guest-register?staff=1'

// Chi telefona alla segreteria o scrive alla casella info quando nessun
// commerciale è disponibile non deve sfuggire — ma non è passato dal banco,
// quindi non è un walk-in. Il form ha tre sezioni: il contatto (verificato
// su tutta l'anagrafica prima di crearlo, e con il commerciale a cui va il
// lead), la registrazione di cosa è arrivato, e un seguito facoltativo da
// programmare — vedi PhoneEmailInForm e registraPhoneEmailIn
// (app/dashboard/agenda/actions.ts).
//
// Nessun elenco di contatti caricato in pagina: la verifica cerca sul server
// (cercaContattiPerVerifica), perché i 300 più recenti non bastano a dire
// «non c'è».
export default async function PhoneEmailInPage() {
  if (!(await utenteHaSezione('phone-email-in'))) {
    redirect('/dashboard')
  }

  const supabase = createSupabaseServiceClient()

  const { data: staff } = await supabase.from('staff_users').select('email, nome, cognome, commerciale')

  const staffOrdinato = ordinaPerCognome(
    (staff ?? []) as (RigaStaff & { commerciale?: boolean })[]
  )
  const commerciali: CommercialeLead[] = staffOrdinato
    .filter((s) => s.commerciale)
    .map((s) => ({ email: s.email, nome: nomeStaff(s) }))

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Segreteria</p>
        <h1>Phone In / Email In</h1>
        <p className="muted">
          Per una telefonata o un&apos;email arrivate quando nessun commerciale era disponibile:
          si registra solo quello che è già successo, con chi ha chiamato o scritto.
        </p>
      </div>

      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          Chi si presenta di persona non va registrato qui: fagli scansionare il QR code del
          Guest Register in reception.{' '}
          <a href={LINK_GUEST_REGISTER} target="_blank" rel="noopener" className="link">
            Apri il Guest Register
          </a>
          .
        </p>
      </div>

      <PhoneEmailInForm commerciali={commerciali} />

      <p className="muted">
        <Link className="link" href="/dashboard/agenda">
          Vai all&apos;agenda
        </Link>
      </p>
    </>
  )
}
