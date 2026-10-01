import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { giornoPiu, oggiRoma, ordinaVoci, voceDaContatto, voceDaTask, type VoceAgenda } from '@/lib/agenda'
import { ATTIVITA_IN_AGENDA, COLONNE_RICHIESTA } from '@/lib/richieste'
import { contattiDelleVoci } from '@/lib/eventi-server'
import { mappaNomiStaff, ordinaPerCognome, type RigaStaff } from '@/lib/staff'
import { AzioniVeloci } from '../AzioniVeloci'
import { NuovaVoce, type ContattoScegliibile } from './NuovaVoce'

export const dynamic = 'force-dynamic'

// L'agenda sul modello dei Task di Passion: un elenco solo, due file di
// schede (quando, di chi), una ricerca, e una riga per azione con «Apri
// scheda». Le azioni si gestiscono nella scheda del contatto.

/** Fin dove guarda «Prossimi», e quanto indietro «Fatte». */
const GIORNI_AVANTI = 30
const GIORNI_FATTE = 14
/** Quante righe per scheda, prima di chiedere di filtrare. */
const RIGHE_IN_ELENCO = 200
/** Quanti contatti per la tendina del modulo. */
const CONTATTI_NEL_FORM = 300

const QUANDO = [
  { chiave: 'arretrati', testo: 'Arretrati' },
  { chiave: 'oggi', testo: 'Oggi' },
  { chiave: 'prossimi', testo: `Prossimi ${GIORNI_AVANTI} giorni` },
  { chiave: 'fatte', testo: 'Fatte' },
] as const
type Quando = (typeof QUANDO)[number]['chiave']

const CHI = [
  { chiave: 'tutti', testo: 'Di tutti' },
  { chiave: 'mie', testo: 'Le mie' },
  { chiave: 'nessuno', testo: 'Senza assegnatario' },
] as const
type Chi = (typeof CHI)[number]['chiave']

type Parametri = { quando?: string; chi?: string; q?: string; persona?: string; apri?: string }

export default async function AgendaPage({ searchParams }: { searchParams: Parametri }) {
  if (!(await utenteHaSezione('agenda'))) {
    redirect('/dashboard')
  }
  // I vecchi link «apri questa voce» portano ora alla scheda della persona.
  if (searchParams.persona) redirect(`/dashboard/persone/${searchParams.persona}`)

  const oggi = oggiRoma()
  const email = emailCorrente()
  const quando: Quando = QUANDO.some((v) => v.chiave === searchParams.quando)
    ? (searchParams.quando as Quando)
    : 'oggi'
  const chi: Chi = CHI.some((v) => v.chiave === searchParams.chi) ? (searchParams.chi as Chi) : 'tutti'
  const q = (searchParams.q ?? '').trim().slice(0, 80)

  // Le aperte senza limite indietro, come in dashboard: un arretrato non
  // smette di esserlo perché è vecchio. Le chiuse solo per la scheda «Fatte».
  const fine = giornoPiu(oggi, GIORNI_AVANTI)
  const limiteFatte = giornoPiu(oggi, -GIORNI_FATTE)
  const COLONNE_TASK =
    'id, titolo, tipo, data, ora, durata_minuti, stato, note, assegnato_a, esito_tipo, esito, esito_da, esito_il, entita, entita_id'

  const supabase = createSupabaseServiceClient()
  const [
    { data: taskAperti, error: erroreTask },
    { data: taskChiusi },
    { data: richiesteAperte, error: erroreRichieste },
    { data: richiesteChiuse },
    { data: staff },
    { data: persone },
  ] = await Promise.all([
    supabase.from('task').select(COLONNE_TASK).eq('stato', 'aperto').lte('data', fine),
    supabase.from('task').select(COLONNE_TASK).neq('stato', 'aperto').gte('data', limiteFatte).lte('data', oggi),
    supabase
      .from('form_contatti')
      .select(COLONNE_RICHIESTA)
      .in('attivita', ATTIVITA_IN_AGENDA)
      .eq('gestito', false)
      .or(`data_scelta.lte.${fine},data_scelta.is.null`),
    supabase
      .from('form_contatti')
      .select(COLONNE_RICHIESTA)
      .in('attivita', ATTIVITA_IN_AGENDA)
      .eq('gestito', true)
      .or(
        `and(data_scelta.gte.${limiteFatte},data_scelta.lte.${oggi}),` +
          `and(data_scelta.is.null,created_at.gte.${limiteFatte})`
      ),
    supabase.from('staff_users').select('email, nome, cognome'),
    supabase
      .from('persone_con_richieste')
      .select('id, nome, cognome, email, cellulare')
      .order('ultima_richiesta', { ascending: false, nullsFirst: false })
      .limit(CONTATTI_NEL_FORM),
  ])
  const task = [...(taskAperti ?? []), ...(taskChiusi ?? [])]
  const contattiGrezzi = [...(richiesteAperte ?? []), ...(richiesteChiuse ?? [])]

  const guasto = erroreTask ?? erroreRichieste
  if (erroreTask) console.error('Voci di agenda non lette:', erroreTask.message)
  if (erroreRichieste) console.error('Richieste in agenda non lette:', erroreRichieste.message)

  const contattiDiVoce = await contattiDelleVoci((task ?? []) as Record<string, any>[])
  const tutte: VoceAgenda[] = [
    ...(task ?? []).map((riga) => voceDaTask(riga, contattiDiVoce.get(String(riga.id)))),
    ...((contattiGrezzi ?? []) as unknown as Record<string, any>[]).map(voceDaContatto),
  ].filter((v) => v.stato !== 'annullato')

  // Di chi, poi la ricerca: le schede «quando» contano su quello che resta.
  const testo = q.toLowerCase()
  const diChi = tutte
    .filter((v) => (chi === 'mie' ? v.assegnatoA === email : chi === 'nessuno' ? !v.assegnatoA : true))
    .filter((v) => !testo || v.ricerca.toLowerCase().includes(testo))

  const filtri: Record<Quando, (v: VoceAgenda) => boolean> = {
    arretrati: (v) => v.daFare && v.data < oggi,
    oggi: (v) => v.daFare && v.data === oggi,
    prossimi: (v) => v.daFare && v.data > oggi,
    fatte: (v) => !v.daFare && v.data >= limiteFatte && v.data <= oggi,
  }
  const conti = Object.fromEntries(QUANDO.map((x) => [x.chiave, diChi.filter(filtri[x.chiave]).length])) as Record<
    Quando,
    number
  >

  // Per giorno e, nel giorno, per ora; le fatte dalla più recente.
  const scelte = diChi.filter(filtri[quando]).sort((a, b) => a.data.localeCompare(b.data))
  const perGiorno = new Map<string, VoceAgenda[]>()
  for (const v of scelte) perGiorno.set(v.data, [...(perGiorno.get(v.data) ?? []), v])
  const giorni = [...perGiorno.keys()]
  if (quando === 'fatte') giorni.reverse()
  const voci = giorni.flatMap((g) => ordinaVoci(perGiorno.get(g)!)).slice(0, RIGHE_IN_ELENCO)

  const staffOrdinato = ordinaPerCognome((staff ?? []) as RigaStaff[])
  const operatori = staffOrdinato.map((s) => s.email)
  const nomiStaff = mappaNomiStaff(staffOrdinato)
  const contattiForm = (persone ?? []) as unknown as ContattoScegliibile[]

  const link = (p: Parametri) => {
    const params = new URLSearchParams()
    const tutti = { quando, chi, q, ...p }
    params.set('quando', tutti.quando!)
    if (tutti.chi && tutti.chi !== 'tutti') params.set('chi', tutti.chi)
    if (tutti.q) params.set('q', tutti.q)
    return `/dashboard/agenda?${params.toString()}`
  }

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Segreteria</p>
        <h1>Agenda</h1>
      </div>

      {guasto && (
        <p className="error-banner">
          L’agenda non è stata letta: quello che vedi qui sotto è incompleto. {guasto.message}
        </p>
      )}

      <div className="agenda-nuova">
        <NuovaVoce
          giornoPredefinito={oggi}
          operatori={operatori}
          contatti={contattiForm}
          contattiTroncati={contattiForm.length === CONTATTI_NEL_FORM}
        />
      </div>

      <section className="riepilogo-sezione">
        <div className="filtro-gruppo">
          {QUANDO.map((v) => (
            <Scheda key={v.chiave} href={link({ quando: v.chiave })} attiva={v.chiave === quando} quante={conti[v.chiave]}>
              {v.testo}
            </Scheda>
          ))}
          <span className="filtro-separatore" aria-hidden="true" />
          {CHI.map((v) => (
            <Scheda key={v.chiave} href={link({ chi: v.chiave })} attiva={v.chiave === chi}>
              {v.testo}
            </Scheda>
          ))}
        </div>

        <form className="agenda-cerca" action="/dashboard/agenda">
          <input type="hidden" name="quando" value={quando} />
          {chi !== 'tutti' && <input type="hidden" name="chi" value={chi} />}
          <input type="search" name="q" defaultValue={q} placeholder="Nome, cognome, telefono, email" />
          <button className="btn btn-ghost btn-sm" type="submit">
            Cerca
          </button>
          {q && (
            <Link className="link" href={link({ q: '' })}>
              Togli la ricerca
            </Link>
          )}
        </form>

        <div className="card">
          {voci.length > 0 ? (
            <AzioniVeloci voci={voci} oggi={oggi} nomiStaff={nomiStaff} mostraChi={chi !== 'mie'} />
          ) : (
            <p className="muted">Nessuna azione qui.</p>
          )}
          {scelte.length > voci.length && (
            <p className="card-nota muted">
              Le prime {RIGHE_IN_ELENCO} di {scelte.length}: usa la ricerca per trovare le altre.
            </p>
          )}
        </div>
      </section>
    </>
  )
}

/** Una scheda di filtro: lo stesso chip della dashboard. */
function Scheda({
  href,
  attiva,
  quante,
  children,
}: {
  href: string
  attiva: boolean
  quante?: number
  children: React.ReactNode
}) {
  return (
    <Link
      className={`chip${attiva ? ' is-attivo' : ''}${quante === 0 ? ' is-zero' : ''}`}
      aria-current={attiva ? 'true' : undefined}
      href={href}
      scroll={false}
    >
      {attiva && (
        <span className="chip-spunta" aria-hidden="true">
          ✓
        </span>
      )}
      {children}
      {quante != null && <span className="chip-conteggio">{quante}</span>}
    </Link>
  )
}
