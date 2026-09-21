import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { oggiRoma } from '@/lib/agenda'
import { ordinaPerCognome, type RigaStaff } from '@/lib/staff'
import { NuovaVoce, type ContattoScegliibile } from '../NuovaVoce'

export const dynamic = 'force-dynamic'

/** Quanti contatti si caricano per la tendina: stessa soglia usata nel resto dell'agenda. */
const CONTATTI_NEL_FORM = 300

// `staff=1` dice allo script di tracciamento del sito (tracking.client.js)
// di non aprire nessuna sessione: chi clicca da qui è la segreteria, sul PC
// del banco, non il lead sul suo telefono.
const LINK_GUEST_REGISTER = 'https://www.ronchiverdi.it/guest-register?staff=1'

// Chi telefona alla segreteria o scrive alla casella info quando nessun
// commerciale è disponibile non deve sfuggire — ma non è passato dal banco,
// quindi non è un walk-in. Qui si registra soltanto (mai una programmazione
// futura), solo telefonata o email, e la trattativa che si apre resta da
// assegnare invece di andare a chi la scrive — vedi le prop passate a
// NuovaVoce e la logica in creaVoce (app/dashboard/agenda/actions.ts).
export default async function PhoneEmailInPage() {
  if (!(await utenteHaSezione('phone-email-in'))) {
    redirect('/dashboard')
  }

  const supabase = createSupabaseServiceClient()

  const [{ data: staff }, { data: persone, error: errorePersone }] = await Promise.all([
    supabase.from('staff_users').select('email, nome, cognome, commerciale'),
    supabase
      .from('persone_con_richieste')
      .select('id, nome, cognome, email, cellulare')
      .order('ultima_richiesta', { ascending: false, nullsFirst: false })
      .limit(CONTATTI_NEL_FORM),
  ])

  if (errorePersone) {
    console.error('Contatti per il form Phone In / Email In non letti:', errorePersone.message)
  }

  const staffOrdinato = ordinaPerCognome(
    (staff ?? []) as (RigaStaff & { commerciale?: boolean })[]
  )
  const operatori = staffOrdinato.map((s) => s.email)
  const contattiForm = (persone ?? []) as unknown as ContattoScegliibile[]
  const contattiTroncati = contattiForm.length === CONTATTI_NEL_FORM

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

      <NuovaVoce
        giornoPredefinito={oggiRoma()}
        operatori={operatori}
        contatti={contattiForm}
        contattiTroncati={contattiTroncati}
        apertaInizialmente
        tipiConsentiti={['appuntamento_telefonico', 'email']}
        soloRegistrazione
        trattativaDaAssegnare
        assegnazioneVoceFissa
        notaUnica
        placeholderNote="Cosa ha chiesto o scritto, com'è andata, e cosa succede adesso"
      />

      <p className="muted">
        <Link className="link" href="/dashboard/agenda">
          Vai all&apos;agenda
        </Link>
      </p>
    </>
  )
}
