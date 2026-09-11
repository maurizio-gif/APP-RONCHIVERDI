import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { ETICHETTA_MANUALE, dataOra, eInseritoAMano, nomePersona } from '@/lib/persone'
import { canaleDiRichiesta } from '@/lib/richieste'
import { percorsoBreve, primoContattoDi, provenienzaRichiesta } from '@/lib/percorsoSito'
import { PercorsoSito } from '@/components/PercorsoSito'
import { CLASSE_BADGE_STATO, ETICHETTE_STATO, type StatoTrattativa } from '@/lib/pipeline'
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
      .select('id, nome, cognome, email, cellulare, note, creato_il, fonte')
      .eq('id', params.id)
      .maybeSingle(),
    supabase
      .from('form_contatti')
      .select('id, created_at, origine, attivita, attivita_label, settore, azione, data_scelta, ora_scelta, messaggio, dettagli, gestito, gestito_da, pagina, cta, audience, utm_source, utm_medium, utm_campaign, first_utm_source, first_utm_campaign, landing_page')
      .eq('persona_id', params.id)
      .order('created_at', { ascending: false }),
    // Le trattative in sola lettura: si lavorano nella sezione Club e Family,
    // e avere due posti dove cambiare stato vorrebbe dire due abitudini
    // diverse per la stessa cosa.
    supabase
      .from('opportunita')
      .select('id, stato, assegnato_a, creato_il, chiuso_il, motivo_perso, motivo_annullato, origine')
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
        <h1>
          {nomePersona(persona)}
          {/* Inserito a mano: non ha mai scritto dal sito, l'ha creato la
              segreteria fissandogli qualcosa in agenda. Va detto qui, perché
              spiega i numeri qui sotto — zero richieste e nessuna «prima
              volta che ha scritto» — che altrimenti si leggono come un
              guasto. */}
          {eInseritoAMano(persona.fonte) && (
            <span className="badge badge-off" style={{ marginLeft: '0.6rem' }}>
              {ETICHETTA_MANUALE}
            </span>
          )}
        </h1>
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
          {/* Chi è stato inserito a mano non ha «scritto» niente: quella data
              è il giorno in cui la segreteria l'ha messo in anagrafica. */}
          <span className="stat-label">
            {eInseritoAMano(persona.fonte) ? 'In anagrafica da' : 'Prima volta che ha scritto'}
          </span>
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
                    <span className={`badge badge-stato badge-punto ${CLASSE_BADGE_STATO[t.stato as StatoTrattativa]}`}>
                      {ETICHETTE_STATO[t.stato as StatoTrattativa]}
                    </span>
                    {/* Nata al banco, non dal sito: cambia come ci si
                        presenta a chi si richiama, e va detto qui perché in
                        pipeline la trattativa si legge da sola. */}
                    {t.origine === 'walk-in' && (
                      <span className="badge badge-walkin" style={{ marginLeft: '0.5rem' }}>
                        Walk-in
                      </span>
                    )}
                    <span className="muted" style={{ marginLeft: '0.5rem', fontSize: 'var(--text-sm)' }}>
                      {t.assegnato_a ? `la segue ${t.assegnato_a}` : 'nessun assegnatario'}
                    </span>
                  </span>
                  {t.motivo_perso && <span className="voce-note muted">Motivo: {t.motivo_perso}</span>}
                  {/* Un'annullata nella storia di una persona va spiegata più
                      di una persa: «Persa» si capisce da sé, una trattativa
                      sparita senza dire perché sembra un buco nei dati. */}
                  {t.motivo_annullato && (
                    <span className="voce-note muted">Annullata: {t.motivo_annullato}</span>
                  )}
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
                    {/* Da dove ha compilato e cosa ha premuto: gli stessi dati
                        che il responsabile vede nel pannello di gestione.
                        Ripetuti qui perché la scheda del contatto è il posto
                        in cui si guarda la storia di una persona, e una
                        richiesta senza il suo contesto è solo una data. */}
                    {(r.pagina || r.cta) && (
                      <span className="voce-note muted">
                        Ha compilato da {r.pagina ?? 'pagina non registrata'}
                        {r.cta && ` · pulsante «${r.cta}»`}
                      </span>
                    )}
                    {r.dettagli && r.dettagli.length > 0 && (
                      <span className="voce-note muted">Interessi: {r.dettagli.join(', ')}</span>
                    )}
                    {(provenienzaRichiesta(r) || r.landing_page) && (
                      <span className="voce-note muted">
                        Provenienza: {provenienzaRichiesta(r) || 'diretto'}
                        {primoContattoDi(r) && primoContattoDi(r) !== provenienzaRichiesta(r) && (
                          <> · primo contatto: {primoContattoDi(r)}</>
                        )}
                        {r.landing_page && (
                          <span title={r.landing_page}> · atterrato su {percorsoBreve(r.landing_page)}</span>
                        )}
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
                  {/* Ultimo, e a riga intera: è un approfondimento, e sopra ci
                      sono le cose che si leggono sempre. */}
                  <PercorsoSito idRichiesta={r.id} paginaForm={r.pagina} />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
