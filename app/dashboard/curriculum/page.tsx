import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import {
  COLONNE,
  ETICHETTE_STATO,
  STATI,
  eStatoValido,
  type Candidatura,
  type StatoCandidatura,
} from '@/lib/candidature'
import { RigaCandidatura } from './RigaCandidatura'

export const dynamic = 'force-dynamic'

// Le candidature spontanee che arrivano da /lavora-con-noi sul sito. Il
// modulo e la tabella stanno nel repository del sito (src/pages/lavora-con-noi
// e scripts/sql/2026-09-08-candidature.sql): qui si legge soltanto.

const LIMITE = 300

export default async function CurriculumPage({
  searchParams,
}: {
  searchParams: { stato?: string }
}) {
  if (!(await utenteHaSezione('candidature'))) {
    redirect('/dashboard')
  }

  const filtro = searchParams.stato && eStatoValido(searchParams.stato) ? searchParams.stato : null

  const supabase = createSupabaseServiceClient()
  let query = supabase
    .from('candidature')
    .select(COLONNE)
    .order('created_at', { ascending: false })
    .limit(LIMITE)
  if (filtro) query = query.eq('stato', filtro)

  const { data } = await query
  const candidature = (data ?? []) as unknown as Candidatura[]

  // I contatori sono sempre su tutte le candidature, anche quando l'elenco è
  // filtrato: servono a scegliere il filtro, e un contatore che cambia con la
  // vista non dice più quante cose ci sono da fare.
  const { data: perStato } = await supabase.from('candidature').select('stato')
  const conteggi = ((perStato ?? []) as { stato: StatoCandidatura }[]).reduce<
    Record<string, number>
  >((acc, r) => {
    acc[r.stato] = (acc[r.stato] ?? 0) + 1
    return acc
  }, {})
  const totale = (perStato ?? []).length

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Amministrazione</p>
        <h1>Curriculum</h1>
        <p className="muted">
          Le candidature spontanee arrivate da <strong>Lavora con noi</strong> sul sito. Il
          curriculum si scarica da qui: è in un archivio privato, e ogni download resta nel
          registro degli operatori.
        </p>
      </div>

      <div className="griglia-stat">
        <div className="stat">
          <span className="stat-valore">{totale}</span>
          <span className="stat-label">In tutto</span>
        </div>
        {STATI.map((s) => (
          <div className="stat" key={s}>
            <span className="stat-valore">{conteggi[s] ?? 0}</span>
            <span className="stat-label">{ETICHETTE_STATO[s]}</span>
          </div>
        ))}
      </div>

      {/* Stessa forma dei filtri delle richieste: gruppo con legenda e
          pulsanti, non chip inventate qui. */}
      <div className="filtri">
        <div className="filtri-testa">
          <span className="filtri-titolo">Filtra l&apos;elenco</span>
        </div>
        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
            <legend>Stato</legend>
            <Link
              className={`btn btn-sm ${filtro ? 'btn-ghost' : ''}`}
              aria-current={filtro ? undefined : 'true'}
              href="/dashboard/curriculum"
            >
              Tutte
            </Link>
            {STATI.map((s) => (
              <Link
                key={s}
                className={`btn btn-sm ${filtro === s ? '' : 'btn-ghost'}`}
                aria-current={filtro === s ? 'true' : undefined}
                href={`/dashboard/curriculum?stato=${s}`}
              >
                {ETICHETTE_STATO[s]}
              </Link>
            ))}
          </fieldset>
        </div>
      </div>

      {candidature.length === 0 ? (
        <div className="card">
          <p className="vuoto">
            {filtro
              ? 'Nessuna candidatura in questo stato.'
              : 'Ancora nessuna candidatura. Arrivano dalla pagina Lavora con noi del sito.'}
          </p>
        </div>
      ) : (
        <div className="cand-elenco">
          {candidature.map((c) => (
            <RigaCandidatura key={c.id} candidatura={c} />
          ))}
        </div>
      )}
    </>
  )
}
