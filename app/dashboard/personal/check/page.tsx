import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { etichettaMese, mesePiu, oggiRoma, primoDelMese, ultimoDelMese } from '@/lib/agenda'
import { COLONNE_SESSIONE, type SessionePersonal } from '@/lib/personal'
import { leggiTrainer } from '@/lib/personal-server'
import { mappaNomiStaff, type RigaStaff } from '@/lib/staff'
import { ConfermaTutte } from './ConfermaTutte'
import { RigaSessione } from './RigaSessione'

export const dynamic = 'force-dynamic'

// Il controllo del responsabile: tutte le sessioni registrate dai trainer,
// da confermare, correggere o eliminare. È l'unico posto in cui una sessione
// cambia dopo essere stata registrata.

const STATI_FILTRO = [
  { chiave: 'tutte', testo: 'Tutte' },
  { chiave: 'in_attesa', testo: 'In attesa' },
  { chiave: 'confermata', testo: 'Confermate' },
] as const
type FiltroStato = (typeof STATI_FILTRO)[number]['chiave']

const ORDINAMENTI = {
  data: 'Data',
  trainer: 'Trainer',
  cliente: 'Cliente',
  stato: 'Stato',
} as const
type Ordinamento = keyof typeof ORDINAMENTI

/** Oltre questo numero di righe la pagina avvisa invece di mostrarle tutte. */
const LIMITE = 1000

type Parametri = { stato?: string; mese?: string; ordina?: string; verso?: string }

function hrefCon(attuali: Required<Parametri>, modifiche: Parametri): string {
  const p = new URLSearchParams({ ...attuali, ...modifiche } as Record<string, string>)
  return `/dashboard/personal/check?${p.toString()}`
}

export default async function CheckPersonalPage({ searchParams }: { searchParams: Parametri }) {
  if (!(await utenteHaSezione('personal-check'))) {
    redirect('/dashboard')
  }

  const oggi = oggiRoma()
  const stato: FiltroStato = STATI_FILTRO.some((s) => s.chiave === searchParams.stato)
    ? (searchParams.stato as FiltroStato)
    : 'tutte'
  // Il mese della sessione, o «tutti» — che serve soprattutto per ritrovare
  // le sessioni in attesa rimaste indietro.
  const mese =
    searchParams.mese === 'tutti'
      ? 'tutti'
      : /^\d{4}-\d{2}-\d{2}$/.test(searchParams.mese ?? '')
        ? primoDelMese(searchParams.mese!)
        : primoDelMese(oggi)
  const ordina: Ordinamento = searchParams.ordina && searchParams.ordina in ORDINAMENTI
    ? (searchParams.ordina as Ordinamento)
    : 'data'
  const verso: 'asc' | 'desc' = searchParams.verso === 'asc' ? 'asc' : searchParams.verso === 'desc' ? 'desc' : ordina === 'data' ? 'desc' : 'asc'
  const attuali = { stato, mese, ordina, verso }

  const supabase = createSupabaseServiceClient()
  let query = supabase.from('personal_sessioni').select(COLONNE_SESSIONE)
  if (mese !== 'tutti') query = query.gte('data', mese).lte('data', ultimoDelMese(mese))

  const crescente = verso === 'asc'
  // La data resta sempre il criterio secondario: dentro lo stesso trainer o
  // lo stesso cliente le sessioni si leggono in ordine di tempo.
  const ordini: [string, boolean][] =
    ordina === 'trainer'
      ? [['trainer_nome', crescente], ['data', false], ['ora', false]]
      : ordina === 'cliente'
        ? [['cliente_cognome', crescente], ['cliente_nome', crescente], ['data', false], ['ora', false]]
        : ordina === 'stato'
          ? // «In attesa» prima di «confermata» in ordine crescente: è quello
            // che il responsabile cerca.
            [['stato', !crescente], ['data', false], ['ora', false]]
          : [['data', crescente], ['ora', crescente]]
  for (const [colonna, asc] of ordini) query = query.order(colonna, { ascending: asc })

  const [{ data, error }, trainer, { data: staff }, { count: attesaAltriMesi }] = await Promise.all([
    query.limit(LIMITE),
    leggiTrainer(),
    supabase.from('staff_users').select('email, nome, cognome'),
    mese === 'tutti'
      ? Promise.resolve({ count: 0 })
      : supabase
          .from('personal_sessioni')
          .select('id', { count: 'exact', head: true })
          .eq('stato', 'in_attesa')
          .or(`data.lt.${mese},data.gt.${ultimoDelMese(mese)}`),
  ])

  const tutte = (data ?? []) as unknown as SessionePersonal[]
  const conteggi = {
    tutte: tutte.length,
    in_attesa: tutte.filter((s) => s.stato === 'in_attesa').length,
    confermata: tutte.filter((s) => s.stato === 'confermata').length,
  }
  const sessioni = stato === 'tutte' ? tutte : tutte.filter((s) => s.stato === stato)
  const daConfermare = sessioni.filter((s) => s.stato === 'in_attesa').map((s) => s.id)
  const nomiStaff = mappaNomiStaff((staff ?? []) as RigaStaff[])

  function intestazione(chiave: Ordinamento) {
    const attivo = ordina === chiave
    const prossimo = attivo ? (verso === 'asc' ? 'desc' : 'asc') : chiave === 'data' ? 'desc' : 'asc'
    return (
      <th aria-sort={attivo ? (verso === 'asc' ? 'ascending' : 'descending') : undefined}>
        <Link href={hrefCon(attuali, { ordina: chiave, verso: prossimo })} className="pt-ordina" scroll={false}>
          {ORDINAMENTI[chiave]}
          <span aria-hidden="true">{attivo ? (verso === 'asc' ? ' ↑' : ' ↓') : ''}</span>
        </Link>
      </th>
    )
  }

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Personal training</p>
        <h1>Check personal</h1>
        <p className="muted">
          Le sessioni registrate dai trainer. Una sessione confermata entra nella scheda del cliente e
          nel rendiconto del mese; solo da qui si corregge o si elimina.
        </p>
      </div>

      {error && (
        <p className="error-banner">
          Sessioni non leggibili: esegui scripts/sql/2026-10-15-personal-training.sql nel SQL Editor di Supabase.
        </p>
      )}

      <div className="report-mese-nav">
        {mese === 'tutti' ? (
          <Link href={hrefCon(attuali, { mese: primoDelMese(oggi) })} className="btn btn-ghost btn-sm">
            Torna al mese in corso
          </Link>
        ) : (
          <>
            <Link href={hrefCon(attuali, { mese: mesePiu(mese, -1) })} className="btn btn-ghost btn-sm">
              ←
            </Link>
            <span className="report-mese-titolo">{etichettaMese(mese)}</span>
            <Link href={hrefCon(attuali, { mese: mesePiu(mese, 1) })} className="btn btn-ghost btn-sm">
              →
            </Link>
            <Link href={hrefCon(attuali, { mese: 'tutti' })} className="chip">
              Tutti i mesi
            </Link>
          </>
        )}
        {mese === 'tutti' && <span className="report-mese-titolo">Tutti i mesi</span>}
      </div>

      {!!attesaAltriMesi && attesaAltriMesi > 0 && (
        <p className="info-banner">
          {attesaAltriMesi === 1 ? 'C’è 1 sessione' : `Ci sono ${attesaAltriMesi} sessioni`} in attesa in altri mesi.{' '}
          <Link href={hrefCon(attuali, { mese: 'tutti', stato: 'in_attesa' })} className="link">
            Vedile
          </Link>
        </p>
      )}

      <div className="card">
        <div className="card-head">
          <div className="pt-filtri">
            {STATI_FILTRO.map((f) => (
              <Link
                key={f.chiave}
                href={hrefCon(attuali, { stato: f.chiave })}
                className={`chip${stato === f.chiave ? ' is-attivo' : ''}`}
                aria-current={stato === f.chiave ? 'true' : undefined}
                scroll={false}
              >
                {stato === f.chiave && (
                  <span className="chip-spunta" aria-hidden="true">
                    ✓
                  </span>
                )}
                {f.testo} <span className="chip-conteggio">{conteggi[f.chiave]}</span>
              </Link>
            ))}
          </div>
          <ConfermaTutte ids={daConfermare} />
        </div>

        {tutte.length === LIMITE && (
          <p className="banner">Sono mostrate le prime {LIMITE} sessioni: scegli un mese per vederle tutte.</p>
        )}

        {sessioni.length === 0 ? (
          <p className="vuoto">
            {stato === 'in_attesa' ? 'Nessuna sessione da confermare.' : 'Nessuna sessione in questo periodo.'}
          </p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella pt-tabella">
              <thead>
                <tr>
                  {intestazione('data')}
                  {intestazione('trainer')}
                  {intestazione('cliente')}
                  <th>Abbonamento</th>
                  {intestazione('stato')}
                  <th>Registrata</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessioni.map((s) => (
                  <RigaSessione key={s.id} sessione={s} trainer={trainer} nomiStaff={nomiStaff} oggi={oggi} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
