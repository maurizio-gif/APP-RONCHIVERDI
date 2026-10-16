import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { etichettaSezione, leggiTicket, nomiStaff, puoVedere, ruoloCorrente } from '@/lib/ticket-server'
import {
  BUCKET_TICKET,
  CLASSE_STATO,
  ETICHETTE_EVENTO,
  ETICHETTE_STATO,
  pesoLeggibile,
  quando,
  type AllegatoTicket,
  type EventoTicket,
} from '@/lib/ticket'
import { PassiTicket } from './PassiTicket'
import { PresaVisione } from './PresaVisione'

export const dynamic = 'force-dynamic'

// Un ticket: la richiesta, la sua storia e i comandi di chi lo sta leggendo.
// Chi l'ha aperto vede solo la parte pubblica (apertura, risposte, chiusura);
// chi gestisce vede anche note interne, passaggi di livello e prese visione.

const DURATA_URL_SECONDI = 600

export default async function TicketDettaglio({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { aperto?: string }
}) {
  const ruolo = await ruoloCorrente()
  if (!ruolo) redirect('/login')
  const t = await leggiTicket(params.id)
  if (!t || !puoVedere(t, ruolo)) notFound()

  const gestore = ruolo.livello !== null
  const richiedente = t.aperto_da === ruolo.email
  const supabase = createSupabaseServiceClient()
  const [{ data: eventi }, { data: allegati }, { data: segnale }, nomi] = await Promise.all([
    supabase.from('ticket_eventi').select('id, creato_il, autore, tipo, testo, pubblico').eq('ticket_id', t.id).order('creato_il'),
    supabase.from('ticket_allegati').select('id, evento_id, percorso, nome, tipo, byte').eq('ticket_id', t.id).order('creato_il'),
    supabase.from('ticket_da_leggere').select('motivo').eq('ticket_id', t.id).eq('email', ruolo.email).maybeSingle(),
    nomiStaff(),
  ])
  const nome = (email: string) => nomi.get(email) ?? email

  const storia = ((eventi ?? []) as EventoTicket[]).filter((e) => gestore || e.pubblico)
  const files = (allegati ?? []) as AllegatoTicket[]
  const firmati = new Map<string, string>()
  if (files.length) {
    const { data } = await supabase.storage.from(BUCKET_TICKET).createSignedUrls(
      files.map((f) => f.percorso),
      DURATA_URL_SECONDI
    )
    for (const f of data ?? []) if (f.signedUrl && f.path) firmati.set(f.path, f.signedUrl)
  }
  const evApertura = storia.find((e) => e.tipo === 'apertura')
  const allegatiDi = (eventoId: string | null) =>
    files.filter((f) => f.evento_id === eventoId || (eventoId === evApertura?.id && f.evento_id === null))

  return (
    <>
      {gestore && segnale && <PresaVisione ticketId={t.id} />}
      <div className="page-head">
        <p className="eyebrow">
          <Link href="/dashboard/ticket">← {gestore ? 'Ticket' : 'I tuoi ticket'}</Link>
        </p>
        <h1>
          <span className="muted">#{t.numero}</span> {t.titolo}
        </h1>
        <div className="tk-meta">
          <span className={CLASSE_STATO[t.stato]}>{ETICHETTE_STATO[t.stato]}</span>
          <span>{etichettaSezione(t.sezione)}</span>
          <span>
            aperto da <b>{nome(t.aperto_da)}</b> il {quando(t.aperto_il)}
          </span>
          {gestore && (
            <span>
              {t.livello === 2 ? 'secondo livello' : 'primo livello'} · <b>{nome(t.assegnato_a)}</b>
            </span>
          )}
        </div>
      </div>

      {searchParams.aperto && (
        <p className="ok-banner">Ticket aperto: lo riceve Simone. Quando ti risponde lo trovi in evidenza nel CRM.</p>
      )}

      <div className="tk-griglia">
        <div>
          <div className="card">
            <div className="card-head">
              <h2>La richiesta</h2>
            </div>
            <p className="tk-testo">{t.descrizione}</p>
            <ElencoAllegati allegati={allegatiDi(evApertura?.id ?? null)} firmati={firmati} />
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Storia</h2>
              <span className="muted">{gestore ? 'con le note interne' : 'risposte e passaggi'}</span>
            </div>
            <ol className="tk-storia">
              {storia
                .filter((e) => e.tipo !== 'apertura')
                .map((e) => (
                  <li key={e.id} className={`tk-ev tk-ev-${e.tipo}${e.pubblico ? '' : ' tk-ev-interno'}`}>
                    <div className="tk-ev-testa">
                      <b>{ETICHETTE_EVENTO[e.tipo]}</b>
                      <span className="muted">
                        {nome(e.autore)} · {quando(e.creato_il)}
                      </span>
                      {!e.pubblico && <span className="badge badge-off">interna</span>}
                    </div>
                    {e.testo && <p className="tk-testo">{e.testo}</p>}
                    <ElencoAllegati allegati={allegatiDi(e.id)} firmati={firmati} />
                  </li>
                ))}
              {storia.filter((e) => e.tipo !== 'apertura').length === 0 && (
                <li className="muted">Ancora nessuna risposta.</li>
              )}
            </ol>
          </div>
        </div>

        <PassiTicket
          ticketId={t.id}
          stato={t.stato}
          livello={t.livello}
          gestore={gestore}
          richiedente={richiedente}
          motivoDaLeggere={(segnale?.motivo as string | undefined) ?? null}
        />
      </div>
    </>
  )
}

function ElencoAllegati({ allegati, firmati }: { allegati: AllegatoTicket[]; firmati: Map<string, string> }) {
  if (!allegati.length) return null
  return (
    <ul className="tk-file">
      {allegati.map((a) => {
        const url = firmati.get(a.percorso)
        // HEIC/HEIF non si vedono nei browser desktop: si scaricano.
        const anteprima = url && a.tipo?.startsWith('image/') && !/hei[cf]/.test(a.tipo)
        return (
          <li key={a.id}>
            {url ? (
              <a href={url} target="_blank" rel="noopener">
                {anteprima ? <img src={url} alt={a.nome} /> : <span className="tk-file-icona">{a.tipo === 'application/pdf' ? 'PDF' : 'IMG'}</span>}
                <span className="tk-file-nome">{a.nome}</span>
                <span className="muted">{pesoLeggibile(a.byte)}</span>
              </a>
            ) : (
              <span className="muted">{a.nome}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
