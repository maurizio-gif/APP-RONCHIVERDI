import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { canaleDaChiave } from '@/lib/richieste'
import { RigaRichiesta, type Richiesta } from '../RigaRichiesta'

export const dynamic = 'force-dynamic'

// Una pagina sola per tutti i canali (vedi lib/richieste.ts): sette copie
// quasi identiche divergerebbero al primo ritocco, e aggiungere un corso
// diventerebbe un file in più invece di una riga di dati.
export default async function CanalePage({
  params,
  searchParams,
}: {
  params: { canale: string }
  searchParams: { mostra?: string }
}) {
  const canale = canaleDaChiave(params.canale)
  if (!canale) notFound()

  // Il permesso è la chiave del canale: chi ha solo il padel non apre il
  // tennis nemmeno scrivendo l'indirizzo a mano.
  const sezioni = await getSezioniConsentite(emailCorrente())
  if (!sezioni.includes(canale.chiave)) redirect('/dashboard')

  const soloDaLavorare = searchParams.mostra !== 'tutte'

  const supabase = createSupabaseServiceClient()
  let query = supabase
    .from('form_contatti')
    .select(
      'id, created_at, nome, cognome, email, cellulare, attivita_label, settore, azione, data_scelta, ora_scelta, messaggio, dettagli, minore_nome, minore_cognome, minore_data_nascita, marketing, gestito, gestito_da, gestito_il, note, utm_source, utm_campaign'
    )
    .order('created_at', { ascending: false })
    .limit(200)

  // I form inline di pagina (Chinesis) non fanno scegliere un'attività: il
  // loro canale si aggancia all'origine del payload.
  query = canale.origine
    ? query.in('origine', canale.origine)
    : query.in('attivita', canale.attivita)

  // Il tennis è l'unica attività con due responsabili: il settore scelto nel
  // form decide di chi è la richiesta.
  if (canale.settore) query = query.eq('settore', canale.settore)
  if (soloDaLavorare) query = query.eq('gestito', false)

  const { data, error } = await query

  if (error) {
    console.error('Richieste non lette:', error.message)
  }

  const richieste = (data ?? []) as unknown as Richiesta[]

  // Il totale da lavorare non dipende dal filtro in pagina: serve a sapere
  // quanto resta anche mentre si guarda lo storico completo.
  let queryDaLavorare = supabase
    .from('form_contatti')
    .select('*', { count: 'exact', head: true })
    .eq('gestito', false)
  queryDaLavorare = canale.origine
    ? queryDaLavorare.in('origine', canale.origine)
    : queryDaLavorare.in('attivita', canale.attivita)
  if (canale.settore) queryDaLavorare = queryDaLavorare.eq('settore', canale.settore)
  const { count: daLavorare } = await queryDaLavorare

  const r = canale.responsabile

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Richieste dal sito</p>
        <h1>{canale.label}</h1>
        <p className="muted">{canale.descrizione}</p>
      </div>

      <div className="card">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <div>
            <h2 style={{ marginBottom: '0.2rem' }}>{r.nome}</h2>
            <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
              {r.ruolo}
              {r.telefono && ` · ${r.telefono}`}
              {r.email && ` · ${r.email}`}
            </p>
          </div>
          <span className={`badge ${daLavorare ? 'badge-warn' : 'badge-ok'}`}>
            {daLavorare ? `${daLavorare} da lavorare` : 'tutto lavorato'}
          </span>
        </div>
      </div>

      <div className="agenda-barra">
        <div className="agenda-nav">
          <Link
            className={`btn btn-sm ${soloDaLavorare ? '' : 'btn-ghost'}`}
            href={`/dashboard/richieste/${canale.chiave}`}
          >
            Da lavorare
          </Link>
          <Link
            className={`btn btn-sm ${soloDaLavorare ? 'btn-ghost' : ''}`}
            href={`/dashboard/richieste/${canale.chiave}?mostra=tutte`}
          >
            Tutte
          </Link>
        </div>
      </div>

      <div className="card">
        {richieste.length === 0 ? (
          <p className="vuoto">
            {soloDaLavorare
              ? 'Nessuna richiesta da lavorare. '
              : 'Nessuna richiesta per questa sezione. '}
            {soloDaLavorare && (
              <Link href={`/dashboard/richieste/${canale.chiave}?mostra=tutte`}>
                Guarda anche quelle già lavorate
              </Link>
            )}
          </p>
        ) : (
          <ul className="richieste">
            {richieste.map((riga) => (
              <RigaRichiesta r={riga} key={riga.id} />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
