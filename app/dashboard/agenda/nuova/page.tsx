import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { oggiRoma } from '@/lib/agenda'
import { ordinaPerCognome, type RigaStaff } from '@/lib/staff'
import { NuovaVoce, type ContattoScegliibile } from '../NuovaVoce'

export const dynamic = 'force-dynamic'

/** Quanti contatti si caricano per la tendina: stessa soglia di agenda/page.tsx. */
const CONTATTI_NEL_FORM = 300

// Una scorciatoia diretta al form di NuovaVoce, permesso suo (vedi
// 'agenda-nuova' in lib/auth/sezioni.ts): chi deve solo fissare un impegno —
// un richiamo, una visita — non deve aprire calendario e lista dell'agenda
// intera per trovare il pulsante in fondo alla pagina. Legge solo quello che
// il form usa davvero: niente task, niente richieste, niente trattative.
export default async function NuovaVocePage() {
  if (!(await utenteHaSezione('agenda-nuova'))) {
    redirect('/dashboard')
  }

  const supabase = createSupabaseServiceClient()

  const [{ data: staff }, { data: persone, error: errorePersone }] = await Promise.all([
    supabase.from('staff_users').select('email, nome, cognome, commerciale'),
    // Dalla vista e non dalla tabella: `ultima_richiesta` è un conto sulle
    // richieste e sta lì (stesso inciampo già corretto in agenda/page.tsx e
    // dashboard/page.tsx).
    supabase
      .from('persone_con_richieste')
      .select('id, nome, cognome, email, cellulare')
      .order('ultima_richiesta', { ascending: false, nullsFirst: false })
      .limit(CONTATTI_NEL_FORM),
  ])

  if (errorePersone) {
    console.error('Contatti per il form di NuovaVoce non letti:', errorePersone.message)
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
        <h1>Aggiungi in agenda</h1>
        <p className="muted">
          Fissa un impegno — un appuntamento, una telefonata, un richiamo — senza aprire tutta
          l&apos;agenda. Appena salvato, lo trovi lì, al suo giorno.{' '}
          <Link className="link" href="/dashboard/agenda">
            Vai all&apos;agenda
          </Link>
          .
        </p>
      </div>

      <NuovaVoce
        giornoPredefinito={oggiRoma()}
        operatori={operatori}
        contatti={contattiForm}
        contattiTroncati={contattiTroncati}
        apertaInizialmente
      />
    </>
  )
}
