import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { eCommerciale, puoRiassegnare } from '@/lib/auth/permessi'
import {
  ETICHETTA_MANUALE,
  dataOra,
  eInseritoAMano,
  nomePersona,
  dataBreve as dataBreveAnno,
} from '@/lib/persone'
import { mappaNomiStaff, ordinaPerCognome, nomeDiEmail, type RigaStaff } from '@/lib/staff'
import { COLONNE_NOTA_VINTA, conColonneNuove } from '@/lib/migrazioni'
import { CLASSE_BADGE_STATO, ETICHETTE_STATO, euro, motivoDi, type StatoTrattativa } from '@/lib/pipeline'
import {
  CLASSE_TIPO,
  ETICHETTE_TIPO_BREVI,
  dataBreve,
  etichettaEsito,
  oggiRoma,
  voceDaContatto,
  voceDaTask,
  type VoceAgenda,
} from '@/lib/agenda'
import { provenienzaTrattativa } from '@/lib/provenienza'
import { dataOraDi, oraDi, percorsoBreve } from '@/lib/percorsoSito'
import { AzioniVeloci } from '../../AzioniVeloci'
import { ComandiLead } from '../../ComandiLead'
import { NuovaAzione } from './NuovaAzione'

// La scheda del contatto sul modello di Passion: in testa chi è e come lo si
// raggiunge; a sinistra il lavoro (il lead, con assegnatario e stato, e le
// azioni, da chiudere sul posto o da aggiungere); a destra gli abbonamenti.
// Percorso sul sito, registro e storico per tipo non ci sono più: alla
// segreteria non servono per lavorare il contatto.

export const dynamic = 'force-dynamic'

/** Cosa dire di un conflitto Info4U, secondo il campo che l'ha causato. */
function descrizioneConflitto(campo: string | null): string {
  if (campo === 'cellulare') return 'Il cellulare'
  if (campo === 'email') return "L'email"
  return 'Il nome e cognome'
}

/** Quante pagine viste leggere al massimo. */
const MAX_PAGINE_VISITATE = 200

/**
 * Le pagine del sito viste da questa persona, attraverso tutte le sue visite:
 * le sessioni in cui ha scritto, più le altre dello stesso `visitor_id`.
 */
async function pagineVisitate(supabase: ReturnType<typeof createSupabaseServiceClient>, personaId: string) {
  type RigaVisita = { session_id?: string | null; visitor_id?: string | null }
  const { data: conVisitatore, error } = await supabase
    .from('form_contatti')
    .select('session_id, visitor_id')
    .eq('persona_id', personaId)
  let righe = (conVisitatore ?? []) as RigaVisita[]
  if (error && /visitor_id/.test(error.message)) {
    const { data: senza } = await supabase.from('form_contatti').select('session_id').eq('persona_id', personaId)
    righe = (senza ?? []) as RigaVisita[]
  }
  const sessioni = new Set(righe.map((r) => r.session_id ?? null).filter(Boolean) as string[])
  const visitatori = [...new Set(righe.map((r) => r.visitor_id ?? null).filter(Boolean) as string[])]
  if (visitatori.length) {
    const { data: altre } = await supabase.from('sessioni').select('session_id').in('visitor_id', visitatori)
    for (const x of altre ?? []) sessioni.add(x.session_id as string)
  }
  if (sessioni.size === 0) return []
  const { data: pagine } = await supabase
    .from('sessioni_pagine')
    .select('pagina, titolo, visto_at')
    .in('session_id', [...sessioni])
    .order('visto_at', { ascending: false })
    .limit(MAX_PAGINE_VISITATE)
  return pagine ?? []
}

function soloCifre(numero: string): string {
  return numero.replace(/[^0-9]/g, '')
}

export default async function PersonaPage({ params }: { params: { id: string } }) {
  if (!(await utenteHaSezione('persone'))) {
    redirect('/dashboard')
  }

  const email = emailCorrente()
  const supabase = createSupabaseServiceClient()
  const [
    { data: persona },
    { data: richieste },
    { data: trattative },
    { data: abbonamenti },
    { data: staff },
    sonoCommerciale,
    possoRiassegnare,
    pagine,
  ] = await Promise.all([
    supabase
      .from('persone')
      .select('id, nome, cognome, email, cellulare, creato_il, fonte, conflitto_con_persona_id, conflitto_campo')
      .eq('id', params.id)
      .maybeSingle(),
    supabase
      .from('form_contatti')
      .select('id, created_at, origine, attivita, attivita_label, azione, data_scelta, ora_scelta, messaggio, gestito, assegnato_a, note, opportunita_id')
      .eq('persona_id', params.id)
      .order('created_at', { ascending: false }),
    conColonneNuove<Record<string, any>>(
      'id, stato, assegnato_a, creato_il, chiuso_il, motivo_perso, motivo_annullato, motivo_vinto, valore_euro, triple_pack, origine',
      COLONNE_NOTA_VINTA,
      (colonne) =>
        supabase
          .from('opportunita')
          .select(colonne)
          .eq('persona_id', params.id)
          .order('creato_il', { ascending: false })
    ),
    supabase
      .from('abbonamenti')
      .select('id, abbonamento, variante, periodo, durata, totale, data_vendita, data_inizio, data_fine, data_disdetta, operatore_nome')
      .eq('persona_id', params.id)
      .order('data_vendita', { ascending: false, nullsFirst: false }),
    supabase.from('staff_users').select('email, nome, cognome, commerciale'),
    eCommerciale(email),
    puoRiassegnare(email),
    pagineVisitate(supabase, params.id),
  ])

  if (!persona) notFound()

  const staffOrdinato = ordinaPerCognome((staff ?? []) as (RigaStaff & { commerciale?: boolean })[])
  const operatori = staffOrdinato.map((x) => x.email)
  const commerciali = staffOrdinato.filter((x) => x.commerciale).map((x) => x.email)
  const nomiStaff = mappaNomiStaff(staffOrdinato)
  const oggi = oggiRoma()
  const nome = nomePersona(persona)

  // Le azioni: gli eventi in agenda, agganciati alla persona o a una sua
  // richiesta, più le richieste dal sito ancora da gestire.
  const elenco = richieste ?? []
  const idRichieste = elenco.map((r) => r.id as string)
  const COLONNE_EVENTO =
    'id, titolo, tipo, data, ora, durata_minuti, note, assegnato_a, stato, esito_tipo, esito, esito_da, esito_il, entita, entita_id'
  const [{ data: eventiDaRichieste }, { data: eventiDaPersona }, { data: conflitti }] = await Promise.all([
    idRichieste.length
      ? supabase.from('task').select(COLONNE_EVENTO).eq('entita', 'form_contatti').in('entita_id', idRichieste)
      : Promise.resolve({ data: [] as Record<string, any>[] }),
    supabase.from('task').select(COLONNE_EVENTO).eq('entita', 'persona').eq('entita_id', params.id),
    supabase
      .from('persone')
      .select('id, nome, cognome, conflitto_campo')
      .or(
        `conflitto_con_persona_id.eq.${params.id}${persona.conflitto_con_persona_id ? `,id.eq.${persona.conflitto_con_persona_id}` : ''}`
      ),
  ])

  const contatto = { id: persona.id, nome, email: persona.email, cellulare: persona.cellulare }
  const conContatto = (v: VoceAgenda): VoceAgenda => ({
    ...v,
    persona: nome,
    personaId: persona.id,
    cellulare: persona.cellulare,
  })
  const eventi = [...(eventiDaRichieste ?? []), ...(eventiDaPersona ?? [])].map((r) =>
    conContatto(voceDaTask(r, contatto))
  )
  const richiesteAperte = elenco
    .filter((r) => !r.gestito)
    .map((r) => conContatto(voceDaContatto({ ...r, nome: persona.nome, cognome: persona.cognome })))
  // Tre gruppi, sempre con la più recente in alto: da fare ora (oggi o
  // scadute), in programma (future), fatte.
  const piuRecenteSopra = (a: VoceAgenda, b: VoceAgenda) =>
    `${b.data}${b.ora ?? ''}`.localeCompare(`${a.data}${a.ora ?? ''}`)
  const aperte = [...eventi.filter((v) => v.stato === 'aperto'), ...richiesteAperte]
  const daFareOra = aperte.filter((v) => v.data <= oggi).sort(piuRecenteSopra)
  const inProgramma = aperte.filter((v) => v.data > oggi).sort(piuRecenteSopra)
  const fatte = eventi.filter((v) => v.stato !== 'aperto').sort(piuRecenteSopra)

  // Il lead: quello aperto, o il più recente. Gli altri restano una riga sotto.
  const tutte = trattative ?? []
  const lead = tutte.find((t) => t.stato === 'nuovo' || t.stato === 'in_gestione') ?? tutte[0] ?? null
  const altriLead = tutte.filter((t) => t !== lead)
  const richiestaLead = lead ? elenco.find((r) => r.opportunita_id === lead.id) ?? null : null
  const provenienza = lead
    ? provenienzaTrattativa({
        origineRichiesta: richiestaLead?.origine as string | null,
        origineTrattativa: lead.origine as string | null,
        haRichiesta: !!richiestaLead,
      })
    : null
  const motivo = lead ? motivoDi(lead as any) : null

  // Gli accessi al sito, un giorno per riga: quando è venuto, quante pagine,
  // e quali (dentro la tendina).
  const accessi = new Map<string, { quando: string; pagine: Record<string, any>[] }>()
  for (const v of pagine) {
    const giorno = String(v.visto_at).slice(0, 10)
    const gia = accessi.get(giorno)
    if (gia) gia.pagine.push(v)
    else accessi.set(giorno, { quando: v.visto_at as string, pagine: [v] })
  }

  // Gli abbonamenti: prima gli attivi, poi gli altri; in ogni gruppo il più
  // recente in alto (per inizio, o per vendita se l'inizio manca).
  const eAttivo = (a: Record<string, any>) => !a.data_disdetta && (!a.data_fine || (a.data_fine as string) >= oggi)
  const quandoAbb = (a: Record<string, any>) => String(a.data_inizio ?? a.data_vendita ?? '')
  const abbonamentiOrdinati = [...(abbonamenti ?? [])].sort(
    (a, b) => Number(eAttivo(b)) - Number(eAttivo(a)) || quandoAbb(b).localeCompare(quandoAbb(a))
  )

  const conflittoVerso = (conflitti ?? []).find((c) => c.id === persona.conflitto_con_persona_id)
  const personeInConflitto = (conflitti ?? []).filter((c) => c.id !== persona.conflitto_con_persona_id)

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">
          <Link href="/dashboard/persone">← Contatti</Link>
        </p>
        <h1>
          {nome}
          {eInseritoAMano(persona.fonte) && (
            <span className="badge badge-off" style={{ marginLeft: '0.6rem' }}>
              {ETICHETTA_MANUALE}
            </span>
          )}
        </h1>
        <div className="agenda-nav" style={{ marginTop: '0.5rem' }}>
          {persona.cellulare && (
            <>
              <a className="btn btn-ghost btn-sm" href={`tel:${soloCifre(persona.cellulare)}`}>
                {persona.cellulare}
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
              {persona.email}
            </a>
          )}
          {!persona.cellulare && !persona.email && <span className="muted">nessun contatto</span>}
        </div>
      </div>

      {(conflittoVerso || personeInConflitto.length > 0) && (
        <div className="card card-avviso">
          <p className="card-nota muted">
            {conflittoVerso && (
              <>
                {descrizioneConflitto(persona.conflitto_campo)} coincide con quello di{' '}
                <Link href={`/dashboard/persone/${conflittoVerso.id}`}>{nomePersona(conflittoVerso)}</Link>: verifica se
                è la stessa persona.{' '}
              </>
            )}
            {personeInConflitto.map((p) => (
              <span key={p.id as string}>
                Possibile doppione: <Link href={`/dashboard/persone/${p.id}`}>{nomePersona(p)}</Link>.{' '}
              </span>
            ))}
          </p>
        </div>
      )}

      <div className="scheda-griglia">
        {/* ---- Colonna 1: il lavoro ---- */}
        <div>
          <div className="card">
            <div className="card-head">
              <h2>Lead</h2>
              {lead && (
                <span className={`badge badge-stato badge-punto ${CLASSE_BADGE_STATO[lead.stato as StatoTrattativa]}`}>
                  {ETICHETTE_STATO[lead.stato as StatoTrattativa]}
                </span>
              )}
            </div>
            {!lead ? (
              <p className="vuoto">Nessun lead per questa persona.</p>
            ) : (
              <>
                <dl className="dati">
                  <dt>Arrivato</dt>
                  <dd>{dataOra(lead.creato_il as string)}</dd>
                  {provenienza && (
                    <>
                      <dt>Da</dt>
                      <dd>
                        <span className={`tag-provenienza ${provenienza.classe}`}>{provenienza.etichetta}</span>
                      </dd>
                    </>
                  )}
                  {richiestaLead?.attivita_label && (
                    <>
                      <dt>Interesse</dt>
                      <dd>{richiestaLead.attivita_label as string}</dd>
                    </>
                  )}
                  {richiestaLead?.messaggio && (
                    <>
                      <dt>Messaggio</dt>
                      <dd>{richiestaLead.messaggio as string}</dd>
                    </>
                  )}
                  {lead.chiuso_il && (
                    <>
                      <dt>Chiuso</dt>
                      <dd>
                        {dataOra(lead.chiuso_il as string)}
                        {lead.stato === 'vinto' && euro(lead.valore_euro != null ? Number(lead.valore_euro) : null)
                          ? ` · ${euro(Number(lead.valore_euro))}`
                          : ''}
                      </dd>
                    </>
                  )}
                  {motivo && (
                    <>
                      <dt>Nota</dt>
                      <dd>{motivo}</dd>
                    </>
                  )}
                </dl>
                <div className="scheda-comandi">
                  <span className="muted">In carico a · stato</span>
                  <ComandiLead
                    id={lead.id as string}
                    stato={lead.stato as StatoTrattativa}
                    assegnatoA={(lead.assegnato_a as string) ?? null}
                    io={email}
                    commerciali={commerciali}
                    nomiStaff={nomiStaff}
                    sonoCommerciale={sonoCommerciale}
                    possoRiassegnare={possoRiassegnare}
                  />
                </div>
                {altriLead.length > 0 && (
                  <p className="card-nota muted">
                    Lead precedenti:{' '}
                    {altriLead
                      .map((t) => `${ETICHETTE_STATO[t.stato as StatoTrattativa]} (${dataBreveAnno(String(t.creato_il).slice(0, 10))})`)
                      .join(' · ')}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Azioni</h2>
            </div>

            <div className="azioni-gruppo azioni-gruppo-ora">
              <h3>
                Da fare ora <span className="azioni-gruppo-conto">{daFareOra.length}</span>
                <span className="muted azioni-gruppo-nota">oggi o scadute</span>
              </h3>
              {daFareOra.length > 0 ? (
                <AzioniVeloci voci={daFareOra} oggi={oggi} nomiStaff={nomiStaff} mostraChi conScheda={false} />
              ) : (
                <p className="muted azioni-gruppo-vuoto">Niente da fare adesso.</p>
              )}
            </div>

            <div className="azioni-gruppo azioni-gruppo-future">
              <h3>
                In programma <span className="azioni-gruppo-conto">{inProgramma.length}</span>
                <span className="muted azioni-gruppo-nota">nei prossimi giorni</span>
              </h3>
              {inProgramma.length > 0 ? (
                <AzioniVeloci voci={inProgramma} oggi={oggi} nomiStaff={nomiStaff} mostraChi conScheda={false} />
              ) : (
                <p className="muted azioni-gruppo-vuoto">Nessuna azione in programma.</p>
              )}
            </div>

            <div className="azioni-gruppo azioni-gruppo-fatte">
              <h3>
                Fatte <span className="azioni-gruppo-conto">{fatte.length}</span>
              </h3>
              {fatte.length === 0 ? (
                <p className="muted azioni-gruppo-vuoto">Nessuna azione fatta.</p>
              ) : (
                <ol className="storia">
                  {fatte.map((v) => (
                    <li key={v.chiave}>
                      <span className={`badge-tipo ${CLASSE_TIPO[v.tipo]}`}>{ETICHETTE_TIPO_BREVI[v.tipo]}</span>{' '}
                      <span className="muted">
                        {dataBreveAnno(v.data)}
                        {v.ora ? ` · ${v.ora}` : ''}
                        {v.assegnatoA ? ` · ${nomeDiEmail(v.assegnatoA, nomiStaff)}` : ''}
                      </span>{' '}
                      {v.esitoTipo ? (
                        <span className={`badge ${v.esitoTipo === 'eseguita' ? 'badge-ok' : 'badge-ko'}`}>
                          {etichettaEsito(v.esitoTipo, v.tipo)}
                        </span>
                      ) : (
                        <span className="badge">{v.stato === 'annullato' ? 'Annullata' : 'Fatta'}</span>
                      )}
                      {(v.esito || v.note) && <div className="storia-testo">{v.esito || v.note}</div>}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="nuova-azione-box">
              <h3>Nuova azione</h3>
              <NuovaAzione
                personaId={persona.id}
                nome={nome}
                oggi={oggi}
                io={email}
                operatori={operatori}
                nomiStaff={nomiStaff}
              />
            </div>
          </div>
        </div>

        {/* ---- Colonna 2: gli abbonamenti (Info4U) ---- */}
        <div>
          <div className="card">
            <div className="card-head">
              <h2>Abbonamenti</h2>
            </div>
            {(abbonamenti ?? []).length === 0 ? (
              <p className="vuoto">Nessun abbonamento.</p>
            ) : (
              <ul className="storia">
                {abbonamentiOrdinati.map((a) => {
                  const attivo = eAttivo(a)
                  return (
                    <li key={a.id as string}>
                      <strong>{(a.abbonamento as string) || 'Abbonamento'}</strong>
                      {a.variante ? ` — ${a.variante}` : ''}{' '}
                      <span className={`badge ${attivo ? 'badge-ok' : ''}`}>
                        {a.data_disdetta ? 'Disdetto' : attivo ? 'Attivo' : 'Scaduto'}
                      </span>
                      <div className="storia-testo muted">
                        {[
                          euro(a.totale != null ? Number(a.totale) : null),
                          a.data_inizio && `dal ${dataBreveAnno(a.data_inizio as string)}`,
                          a.data_fine && `al ${dataBreveAnno(a.data_fine as string)}`,
                          // Il consulente che l'ha venduto, come scritto su Info4U.
                          a.operatore_nome && `consulente ${a.operatore_nome}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Accessi al sito</h2>
              <span className="muted">
                {accessi.size > 0 ? `${accessi.size} ${accessi.size === 1 ? 'giorno' : 'giorni'}` : 'nessuno'}
              </span>
            </div>
            {accessi.size === 0 ? (
              <p className="vuoto">Nessuna visita al sito collegata a questa persona.</p>
            ) : (
              <ul className="storia">
                {[...accessi.entries()].map(([giorno, a]) => (
                  <li key={giorno}>
                    <details>
                      <summary>
                        <strong>{dataOraDi(a.quando)}</strong>{' '}
                        <span className="muted">
                          · {a.pagine.length} {a.pagine.length === 1 ? 'pagina' : 'pagine'}
                        </span>
                      </summary>
                      <ol className="accessi-pagine">
                        {[...a.pagine].reverse().map((v, i) => (
                          <li key={i} title={v.pagina as string}>
                            <span className="muted">{oraDi(v.visto_at as string)}</span>{' '}
                            {(v.titolo as string) || percorsoBreve(v.pagina as string)}
                          </li>
                        ))}
                      </ol>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
