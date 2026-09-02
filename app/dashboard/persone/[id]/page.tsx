import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { dataOra, nomePersona } from '@/lib/persone'
import { canaleDiRichiesta } from '@/lib/richieste'
import { CLASSE_STATO, ETICHETTE_STATO, type StatoTrattativa } from '@/lib/pipeline'
import { SchedaPersona } from '../SchedaPersona'

export const dynamic = 'force-dynamic'

function soloCifre(numero: string): string {
  return numero.replace(/[^0-9]/g, '')
}

export default async function PersonaPage({ params }: { params: { id: string } }) {
  if (!(await utenteHaSezione('persone'))) {
    redirect('/dashboard')
  }

  const supabase = createSupabaseServiceClient()
  const [{ data: persona }, { data: richieste }, { data: trattative }] = await Promise.all([
    supabase
      .from('persone')
      .select('id, nome, cognome, email, cellulare, note, creato_il')
      .eq('id', params.id)
      .maybeSingle(),
    supabase
      .from('form_contatti')
      .select('id, created_at, origine, attivita, attivita_label, settore, azione, data_scelta, ora_scelta, messaggio, gestito, gestito_da, utm_source, utm_campaign')
      .eq('persona_id', params.id)
      .order('created_at', { ascending: false }),
    // Le trattative in sola lettura: si lavorano nella sezione Club e Family,
    // e avere due posti dove cambiare stato vorrebbe dire due abitudini
    // diverse per la stessa cosa.
    supabase
      .from('opportunita')
      .select('id, stato, assegnato_a, creato_il, chiuso_il, motivo_perso')
      .eq('persona_id', params.id)
      .order('creato_il', { ascending: false }),
  ])

  if (!persona) notFound()

  const elenco = richieste ?? []
  const daLavorare = elenco.filter((r) => !r.gestito).length

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">
          <Link href="/dashboard/persone">← Anagrafica</Link>
        </p>
        <h1>{nomePersona(persona)}</h1>
        <p className="muted">
          {[persona.email, persona.cellulare].filter(Boolean).join(' · ') || 'nessun contatto'}
        </p>
        <div className="agenda-nav" style={{ marginTop: '0.75rem' }}>
          {persona.cellulare && (
            <>
              <a className="btn btn-ghost btn-sm" href={`tel:${soloCifre(persona.cellulare)}`}>
                Chiama
              </a>
              <a
                className="btn btn-ghost btn-sm"
                href={`https://wa.me/${soloCifre(persona.cellulare)}`}
                target="_blank"
                rel="noopener"
              >
                WhatsApp
              </a>
            </>
          )}
          {persona.email && (
            <a className="btn btn-ghost btn-sm" href={`mailto:${persona.email}`}>
              Email
            </a>
          )}
        </div>
      </div>

      <div className="griglia-stat">
        <div className="stat">
          <span className="stat-valore">{elenco.length}</span>
          <span className="stat-label">Richieste in tutto</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{daLavorare}</span>
          <span className="stat-label">Ancora da lavorare</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{dataOra(persona.creato_il)}</span>
          <span className="stat-label">Prima volta che ha scritto</span>
        </div>
      </div>

      {(trattative ?? []).length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Trattativa</h2>
            <span className="muted">Club e Family</span>
          </div>
          <ul className="voci">
            {(trattative ?? []).map((t) => (
              <li className="voce" key={t.id as string}>
                <span className="voce-ora">{dataOra(t.creato_il as string)}</span>
                <span className="voce-corpo">
                  <span className="voce-titolo">
                    <span className={`badge ${CLASSE_STATO[t.stato as StatoTrattativa]}`}>
                      {ETICHETTE_STATO[t.stato as StatoTrattativa]}
                    </span>
                    <span className="muted" style={{ marginLeft: '0.5rem', fontSize: 'var(--text-sm)' }}>
                      {t.assegnato_a ? `la segue ${t.assegnato_a}` : 'nessun assegnatario'}
                    </span>
                  </span>
                  {t.motivo_perso && <span className="voce-note muted">Motivo: {t.motivo_perso}</span>}
                </span>
                <span className="voce-azioni">
                  <Link className="btn btn-ghost btn-sm" href="/dashboard/richieste/richieste-club?mostra=tutte">
                    Apri in Club e Family
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SchedaPersona
        id={persona.id}
        nome={persona.nome}
        cognome={persona.cognome}
        note={persona.note}
      />

      <div className="card">
        <div className="card-head">
          <h2>Le sue richieste</h2>
          <span className="muted">dalla più recente</span>
        </div>

        {elenco.length === 0 ? (
          <p className="vuoto">Nessuna richiesta collegata.</p>
        ) : (
          <ul className="voci">
            {elenco.map((r) => {
              const canale = canaleDiRichiesta(r)
              return (
                <li className={`voce${r.gestito ? ' is-fatta' : ''}`} key={r.id}>
                  <span className="voce-ora">{dataOra(r.created_at)}</span>
                  <span className="voce-corpo">
                    <span className="voce-titolo">
                      {r.attivita_label ?? (r.origine === 'chinesis-inline' ? 'Chinesis' : 'Richiesta informazioni')}
                      {r.settore && <span className="badge badge-off" style={{ marginLeft: '0.5rem' }}>{r.settore}</span>}
                      {r.azione && <span className="badge badge-off" style={{ marginLeft: '0.35rem' }}>{r.azione}</span>}
                      {r.gestito && <span className="badge badge-ok" style={{ marginLeft: '0.35rem' }}>lavorata</span>}
                    </span>
                    {r.data_scelta && (
                      <span className="voce-note muted">
                        Appuntamento: {r.data_scelta}
                        {r.ora_scelta && ` alle ${String(r.ora_scelta).slice(0, 5)}`}
                      </span>
                    )}
                    {r.messaggio && <span className="voce-note muted">{r.messaggio}</span>}
                    {r.utm_campaign && (
                      <span className="voce-note muted">
                        Provenienza: {[r.utm_source, r.utm_campaign].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  {/* Il collegamento porta alla sezione del responsabile, dove
                      la richiesta si lavora: qui la scheda persona resta un
                      punto di lettura, non un secondo posto dove agire. */}
                  {canale && (
                    <span className="voce-azioni">
                      <Link className="btn btn-ghost btn-sm" href={`/dashboard/richieste/${canale.chiave}?mostra=tutte`}>
                        {canale.label}
                      </Link>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
