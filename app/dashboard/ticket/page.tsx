import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { etichettaSezione, nomiStaff, ruoloCorrente } from '@/lib/ticket-server'
import { CLASSE_STATO, COLONNE_TICKET, ETICHETTE_STATO, quando, type Ticket } from '@/lib/ticket'

export const dynamic = 'force-dynamic'

// I ticket. Chi gestisce (ticket_gestori) li vede tutti, con i filtri del suo
// lavoro: il secondo livello controlla anche quelli che non gli sono stati
// passati. Tutti gli altri vedono i propri e da qui ne aprono di nuovi.

const FILTRI = [
  { chiave: 'miei', testo: 'Da gestire da me' },
  { chiave: 'aperti', testo: 'Tutti aperti' },
  { chiave: 'risposti', testo: 'In attesa di chi li ha aperti' },
  { chiave: 'chiusi', testo: 'Chiusi' },
  { chiave: 'tutti', testo: 'Tutti' },
] as const
type Filtro = (typeof FILTRI)[number]['chiave']

export default async function TicketPage({ searchParams }: { searchParams: { f?: string } }) {
  const ruolo = await ruoloCorrente()
  if (!ruolo) redirect('/login')
  const gestore = ruolo.livello !== null
  const filtro: Filtro = FILTRI.some((f) => f.chiave === searchParams.f) ? (searchParams.f as Filtro) : 'miei'

  const supabase = createSupabaseServiceClient()
  let query = supabase.from('ticket').select(COLONNE_TICKET).order('aggiornato_il', { ascending: false }).limit(300)
  if (!gestore) query = query.eq('aperto_da', ruolo.email)
  else if (filtro === 'miei') query = query.eq('assegnato_a', ruolo.email).eq('stato', 'aperto')
  else if (filtro === 'aperti') query = query.neq('stato', 'chiuso')
  else if (filtro === 'risposti') query = query.eq('stato', 'risposto')
  else if (filtro === 'chiusi') query = query.eq('stato', 'chiuso')

  const [{ data }, { data: daLeggere }, nomi] = await Promise.all([
    query,
    supabase.from('ticket_da_leggere').select('ticket_id').eq('email', ruolo.email),
    nomiStaff(),
  ])
  const ticket = (data ?? []) as Ticket[]
  const evidenza = new Set((daLeggere ?? []).map((r) => r.ticket_id as string))
  const nome = (email: string) => nomi.get(email) ?? email

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Assistenza</p>
        <h1>{gestore ? 'Ticket' : 'I tuoi ticket'}</h1>
        <p className="muted">
          {gestore
            ? 'Tutti i ticket aperti nel CRM. Primo livello: Simone; secondo livello: Maurizio.'
            : 'Le segnalazioni che hai aperto e le risposte che hai ricevuto.'}
        </p>
      </div>

      <div className="agenda-nav" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
        <Link href="/dashboard/ticket/nuovo" className="btn">
          + Apri un ticket
        </Link>
        {gestore &&
          FILTRI.map((f) => (
            <Link
              key={f.chiave}
              href={`/dashboard/ticket?f=${f.chiave}`}
              className={`btn btn-sm ${f.chiave === filtro ? '' : 'btn-ghost'}`}
            >
              {f.testo}
            </Link>
          ))}
      </div>

      <div className="card">
        {ticket.length === 0 ? (
          <p className="vuoto">
            {gestore ? 'Nessun ticket con questo filtro.' : 'Non hai ancora aperto ticket.'}
          </p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Ticket</th>
                  {gestore && <th>Aperto da</th>}
                  <th>Stato</th>
                  {gestore && <th>Livello</th>}
                  <th>Aggiornato</th>
                </tr>
              </thead>
              <tbody>
                {ticket.map((t) => (
                  <tr key={t.id} className={evidenza.has(t.id) ? 'tk-riga-evidenza' : undefined}>
                    <td className="cella-nowrap">
                      <Link href={`/dashboard/ticket/${t.id}`}>#{t.numero}</Link>
                    </td>
                    <td>
                      <Link href={`/dashboard/ticket/${t.id}`} className="cella-chi-nome">
                        {evidenza.has(t.id) && <span className="tk-pallino" aria-label="Da leggere" />}
                        {t.titolo}
                      </Link>
                      <div className="cella-chi-dettagli">{etichettaSezione(t.sezione)}</div>
                    </td>
                    {gestore && <td>{nome(t.aperto_da)}</td>}
                    <td className="cella-nowrap">
                      <span className={CLASSE_STATO[t.stato]}>{ETICHETTE_STATO[t.stato]}</span>
                    </td>
                    {gestore && (
                      <td className="cella-nowrap">
                        {t.livello === 2 ? 'Secondo' : 'Primo'}
                        <div className="cella-chi-dettagli">{nome(t.assegnato_a)}</div>
                      </td>
                    )}
                    <td className="cella-nowrap">{quando(t.aggiornato_il)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
