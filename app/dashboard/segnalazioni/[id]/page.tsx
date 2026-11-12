import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import {
  CLASSE_STATO,
  CLASSE_URGENZA,
  ETICHETTE_CANALE,
  ETICHETTE_EVENTO,
  ETICHETTE_STATO,
  ETICHETTE_URGENZA,
  SEZIONE_SEGNALAZIONI,
  inRitardo,
  quando,
  type EventoSegnalazione,
} from '@/lib/segnalazioni'
import { leggiSegnalazione, nomiElenchi, nomiStaff, operatoriSegnalazioni } from '@/lib/segnalazioni-server'
import { PassiSegnalazione } from './PassiSegnalazione'

export const dynamic = 'force-dynamic'

// Una segnalazione: cosa è stato riferito, la sua storia e i comandi per
// farla avanzare.
export default async function SegnalazioneDettaglio({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { registrata?: string }
}) {
  if (!(await utenteHaSezione(SEZIONE_SEGNALAZIONI))) redirect('/dashboard')
  const s = await leggiSegnalazione(params.id)
  if (!s) notFound()

  const supabase = createSupabaseServiceClient()
  const [{ data: eventi }, elenchi, nomi, operatori] = await Promise.all([
    supabase.from('segnalazioni_eventi').select('id, creato_il, autore, tipo, testo').eq('segnalazione_id', s.id).order('creato_il'),
    nomiElenchi(),
    nomiStaff(),
    operatoriSegnalazioni(),
  ])
  const nome = (email: string | null) => (email ? (nomi.get(email) ?? email) : null)
  const storia = (eventi ?? []) as EventoSegnalazione[]
  const io = emailCorrente()

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">
          <Link href="/dashboard/segnalazioni">← Segnalazioni soci</Link>
        </p>
        <h1>
          <span className="muted">#{s.numero}</span> {elenchi.settori.get(s.settore) ?? s.settore} ·{' '}
          {elenchi.motivi.get(s.motivo) ?? s.motivo}
        </h1>
        <div className="tk-meta">
          <span className={CLASSE_STATO[s.stato]}>{ETICHETTE_STATO[s.stato]}</span>
          <span className={CLASSE_URGENZA[s.urgenza]}>{ETICHETTE_URGENZA[s.urgenza]}</span>
          {inRitardo(s) && <span className="badge badge-ko">in ritardo</span>}
          <span>
            raccolta da <b>{nome(s.raccolta_da)}</b> il {quando(s.ricevuta_il)} · {ETICHETTE_CANALE[s.canale].toLowerCase()}
          </span>
          <span>
            assegnata a <b>{nome(s.assegnato_a) ?? 'nessuno'}</b>
          </span>
        </div>
      </div>

      {searchParams.registrata && <p className="ok-banner">Segnalazione registrata.</p>}

      <div className="tk-griglia">
        <div>
          <div className="card">
            <div className="card-head">
              <h2>Cosa è stato riferito</h2>
            </div>
            <p className="tk-testo">{s.descrizione}</p>
            <dl className="sg-dati">
              <dt>Socio</dt>
              <dd>{s.socio_nome ?? <span className="muted">non indicato</span>}</dd>
              <dt>Richiamo</dt>
              <dd>
                {s.richiamo_richiesto
                  ? s.richiamato_il
                    ? `richiesto, fatto il ${quando(s.richiamato_il)}`
                    : 'richiesto, ancora da fare'
                  : 'non richiesto'}
              </dd>
              <dt>Da prendere in carico entro</dt>
              <dd>{quando(s.scadenza_presa_il)}</dd>
              <dt>Da risolvere entro</dt>
              <dd>{quando(s.scadenza_risoluzione_il)}</dd>
            </dl>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Storia</h2>
            </div>
            <ol className="tk-storia">
              {storia.map((e) => (
                <li key={e.id} className="tk-ev">
                  <div className="tk-ev-testa">
                    <b>{ETICHETTE_EVENTO[e.tipo]}</b>
                    <span className="muted">
                      {nome(e.autore)} · {quando(e.creato_il)}
                    </span>
                  </div>
                  {e.testo && <p className="tk-testo">{e.testo}</p>}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <PassiSegnalazione
          id={s.id}
          stato={s.stato}
          assegnatoA={s.assegnato_a}
          sonoIo={s.assegnato_a === io}
          operatori={operatori}
          richiamoDaFare={s.richiamo_richiesto && !s.richiamato_il}
        />
      </div>
    </>
  )
}
