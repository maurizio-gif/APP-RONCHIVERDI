import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { giornoPiu, oggiRoma, voceDaContatto, voceDaTask, type VoceAgenda } from '@/lib/agenda'
import { ATTIVITA_IN_AGENDA, COLONNE_RICHIESTA } from '@/lib/richieste'
import { contattiDelleVoci } from '@/lib/eventi-server'
import { conTentativiRichiamo } from '@/lib/richiamo-server'
import { ordinaPerCognome, type RigaStaff } from '@/lib/staff'
import { GrigliaAgenda, type Operatore } from './GrigliaAgenda'
import { NuovaVoce, type ContattoScegliibile } from '../agenda/NuovaVoce'

export const dynamic = 'force-dynamic'

/** Quanti contatti per la tendina del modulo, come nell'agenda a elenco. */
const CONTATTI_NEL_FORM = 300

// Agenda Test: la nuova agenda a calendario, giorno e settimana, in prova
// accanto a quella a elenco (/dashboard/agenda). Legge le stesse voci —
// task della segreteria e richieste dal sito — con le stesse funzioni, e le
// mostra sulla griglia delle ore. Si aggiunge con lo stesso modulo
// dell'agenda a elenco (NuovaVoce); le azioni esistenti qui si guardano
// soltanto: si gestiscono nella scheda del contatto, aperta da «Gestisci».
//
// Si caricano sempre i sette giorni della settimana del giorno scelto: la
// vista Giorno e la vista Settimana leggono gli stessi dati, e passare
// dall'una all'altra non ricarica niente.

type Parametri = { g?: string; vista?: string }

function lunediDi(giorno: string): string {
  const d = new Date(`${giorno}T12:00:00Z`)
  return giornoPiu(giorno, -((d.getUTCDay() + 6) % 7))
}

export default async function AgendaTestPage({ searchParams }: { searchParams: Parametri }) {
  if (!(await utenteHaSezione('agenda-test'))) redirect('/dashboard')

  const oggi = oggiRoma()
  const giorno = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.g ?? '') ? searchParams.g! : oggi
  const tempo = searchParams.vista === 'settimana' ? 'settimana' : 'giorno'
  const dal = lunediDi(giorno)
  const al = giornoPiu(dal, 6)
  const io = emailCorrente()

  const COLONNE_TASK =
    'id, titolo, tipo, data, ora, durata_minuti, stato, note, assegnato_a, esito_tipo, esito, esito_da, esito_il, entita, entita_id'

  const supabase = createSupabaseServiceClient()
  const [
    { data: task, error: erroreTask },
    { data: richieste, error: erroreRichieste },
    { count: taskArretrati },
    { count: richiesteArretrate },
    { data: staff },
    { data: persone },
  ] = await Promise.all([
    supabase.from('task').select(COLONNE_TASK).gte('data', dal).lte('data', al),
    // Le richieste stanno nel giorno scelto dalla persona o, senza un giorno,
    // in quello in cui sono arrivate: come nell'agenda a elenco.
    supabase
      .from('form_contatti')
      .select(COLONNE_RICHIESTA)
      .in('attivita', ATTIVITA_IN_AGENDA)
      .or(
        `and(data_scelta.gte.${dal},data_scelta.lte.${al}),` +
          `and(data_scelta.is.null,created_at.gte.${dal},created_at.lt.${giornoPiu(al, 1)})`
      ),
    supabase.from('task').select('id', { count: 'exact', head: true }).eq('stato', 'aperto').lt('data', oggi),
    supabase
      .from('form_contatti')
      .select('id', { count: 'exact', head: true })
      .in('attivita', ATTIVITA_IN_AGENDA)
      .eq('gestito', false)
      .is('appuntamento_annullato_il', null)
      .or(`data_scelta.lt.${oggi},and(data_scelta.is.null,created_at.lt.${oggi})`),
    supabase.from('staff_users').select('email, nome, cognome, commerciale'),
    supabase
      .from('persone_con_richieste')
      .select('id, nome, cognome, email, cellulare')
      .order('ultima_richiesta', { ascending: false, nullsFirst: false })
      .limit(CONTATTI_NEL_FORM),
  ])

  if (erroreTask) console.error('Agenda Test: task non letti:', erroreTask.message)
  if (erroreRichieste) console.error('Agenda Test: richieste non lette:', erroreRichieste.message)

  const righeTask = (task ?? []) as Record<string, any>[]
  const contattiDiVoce = await contattiDelleVoci(righeTask)
  const voci: VoceAgenda[] = (
    await conTentativiRichiamo([
      ...righeTask.map((riga) => voceDaTask(riga, contattiDiVoce.get(String(riga.id)))),
      ...((richieste ?? []) as unknown as Record<string, any>[]).map(voceDaContatto),
    ])
  ).filter((v) => v.stato !== 'annullato' && v.data >= dal && v.data <= al)

  // Gli operatori fra cui scegliere sono i commerciali (staff_users.commerciale,
  // da Gestione utenti): l'agenda è la loro. Le azioni assegnate ad altri non
  // compaiono; quelle di nessuno sì, in «Senza assegnatario».
  const commerciali = ((staff ?? []) as (RigaStaff & { commerciale: boolean | null })[]).filter((s) => s.commerciale)
  const operatori: Operatore[] = ordinaPerCognome(commerciali).map((s) => ({
    email: s.email,
    nome: [s.nome, s.cognome ? `${s.cognome[0]}.` : null].filter(Boolean).join(' ') || s.email.split('@')[0],
  }))

  // Il modulo «Aggiungi in agenda» è lo stesso dell'agenda a elenco, con gli
  // stessi dati: tutto lo staff fra cui assegnare e gli ultimi contatti.
  const contattiForm = (persone ?? []) as unknown as ContattoScegliibile[]
  const tuttoLoStaff = ordinaPerCognome((staff ?? []) as RigaStaff[]).map((s) => s.email)

  return (
    <>
      <div className="agenda-nuova">
        <NuovaVoce
          giornoPredefinito={giorno}
          operatori={tuttoLoStaff}
          contatti={contattiForm}
          contattiTroncati={contattiForm.length === CONTATTI_NEL_FORM}
        />
      </div>
      {(erroreTask || erroreRichieste) && (
        <p className="error-banner">L’agenda non è stata letta per intero: quello che vedi è incompleto.</p>
      )}
      <GrigliaAgenda
        voci={voci}
        operatori={operatori}
        io={io}
        oggi={oggi}
        giorno={giorno}
        tempo={tempo}
        arretrati={(taskArretrati ?? 0) + (richiesteArretrate ?? 0)}
      />
    </>
  )
}
