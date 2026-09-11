import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import {
  eCommerciale,
  puoCancellare as haDirittoDiCancellare,
  puoRiassegnare,
} from '@/lib/auth/permessi'
import { emailCorrente } from '@/lib/auth/sezioni-server'
import { ETICHETTA_MANUALE, dataOra, eInseritoAMano, nomePersona } from '@/lib/persone'
import { dataOraDi, oraDi, percorsoBreve } from '@/lib/percorsoSito'
import { mappaNomiStaff, ordinaPerCognome, nomeDiEmail, type RigaStaff } from '@/lib/staff'
import {
  COLONNE_ASSEGNAZIONE_RICHIESTA,
  COLONNE_NOTA_VINTA,
  conColonneNuove,
} from '@/lib/migrazioni'
import { CLASSE_BADGE_STATO, ETICHETTE_STATO, euro, type StatoTrattativa } from '@/lib/pipeline'
import { RichiestePersona, type RichiestaDiPersona } from '../RichiestePersona'

/** Quante pagine viste riportare prima di dire che ce ne sono altre. */
const MAX_PAGINE_VISITATE = 120

/**
 * Le pagine del sito che questa persona ha visto, in ordine cronologico e
 * attraverso **tutte** le sue visite.
 *
 * Le visite si tengono insieme col `visitor_id`, che è l'unica chiave che
 * attraversa i giorni: il `session_id` vale per una visita sola. Senza
 * visitor_id — chi non ha dato il consenso, e i lead arrivati prima che il
 * sito cominciasse a spedirlo — restano le sole sessioni in cui ha compilato
 * un form, che è comunque la parte che dice qualcosa.
 *
 * La colonna `visitor_id` arriva con una migration del sito
 * (2026-09-11-visitor-id-e-sessione-del-lead.sql): finché non è passata la si
 * chiede e basta, e si ripiega sulle sessioni delle richieste.
 */
async function pagineVisitate(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  personaId: string
) {
  type RigaVisita = { session_id?: string | null; visitor_id?: string | null }
  const { data: conVisitatore, error } = await supabase
    .from('form_contatti')
    .select('session_id, visitor_id')
    .eq('persona_id', personaId)

  let righe = (conVisitatore ?? []) as RigaVisita[]
  if (error && /visitor_id/.test(error.message)) {
    const { data: senza } = await supabase
      .from('form_contatti')
      .select('session_id')
      .eq('persona_id', personaId)
    righe = (senza ?? []) as RigaVisita[]
  }

  const sessioni = new Set(righe.map((r) => r.session_id ?? null).filter(Boolean) as string[])
  const visitatori = [
    ...new Set(righe.map((r) => r.visitor_id ?? null).filter(Boolean) as string[]),
  ]

  // Le altre visite dello stesso visitatore: quelle in cui ha guardato e non
  // ha scritto niente, che sono spesso le più interessanti — è il giro che ha
  // fatto prima di decidersi.
  if (visitatori.length) {
    const { data: altre } = await supabase
      .from('sessioni')
      .select('session_id')
      .in('visitor_id', visitatori)
    for (const x of altre ?? []) sessioni.add(x.session_id as string)
  }

  if (sessioni.size === 0) return { pagine: [], troncato: false }

  // Una in più del massimo: è il modo di sapere se ne restano fuori senza
  // doverle contare tutte.
  const { data: pagine } = await supabase
    .from('sessioni_pagine')
    .select('pagina, titolo, visto_at')
    .in('session_id', [...sessioni])
    .order('visto_at', { ascending: true })
    .limit(MAX_PAGINE_VISITATE + 1)

  const viste = pagine ?? []
  return {
    pagine: viste.slice(0, MAX_PAGINE_VISITATE),
    troncato: viste.length > MAX_PAGINE_VISITATE,
  }
}

export const dynamic = 'force-dynamic'

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
    percorso,
    possoCancellare,
    { data: staff },
    sonoCommerciale,
    possoRiassegnare,
  ] = await Promise.all([
    supabase
      .from('persone')
      .select('id, nome, cognome, email, cellulare, note, creato_il, fonte')
      .eq('id', params.id)
      .maybeSingle(),
    // Tutte le colonne che servono a **lavorare** la richiesta, non solo a
    // leggerla: esito, nota, assegnatario e firme. La scheda era in sola
    // lettura e rimandava alla sezione del responsabile — tre passaggi per il
    // gesto immediatamente successivo a quello che si stava facendo, cioè
    // chiudere la telefonata appena fatta (vedi RichiestePersona).
    conColonneNuove<Record<string, any>>(
      'id, created_at, origine, attivita, attivita_label, settore, azione, data_scelta, ora_scelta, messaggio, dettagli, gestito, gestito_da, gestito_il, assegnato_a, note, note_da, note_il, esito_tipo, esito, esito_da, esito_il, pagina, cta, audience, utm_source, utm_medium, utm_campaign, first_utm_source, first_utm_campaign, landing_page',
      COLONNE_ASSEGNAZIONE_RICHIESTA,
      (colonne) =>
        supabase
          .from('form_contatti')
          .select(colonne)
          .eq('persona_id', params.id)
          .order('created_at', { ascending: false })
    ),
    // Le trattative in sola lettura: lo stato si cambia dalla dashboard o
    // dalla sezione Club e Family, dove c'è la pipeline intorno. Qui si
    // lavorano le **richieste**, che sono il lavoro concreto di una scheda.
    conColonneNuove<Record<string, any>>(
      'id, stato, assegnato_a, creato_il, chiuso_il, motivo_perso, motivo_annullato, motivo_vinto, valore_euro, origine',
      COLONNE_NOTA_VINTA,
      (colonne) =>
        supabase
          .from('opportunita')
          .select(colonne)
          .eq('persona_id', params.id)
          .order('creato_il', { ascending: false })
    ),
    pagineVisitate(supabase, params.id),
    haDirittoDiCancellare(email),
    supabase.from('staff_users').select('email, nome, cognome'),
    eCommerciale(email),
    puoRiassegnare(email),
  ])

  const staffOrdinato = ordinaPerCognome((staff ?? []) as RigaStaff[])
  const operatori = staffOrdinato.map((x) => x.email)
  const nomiStaff = mappaNomiStaff(staffOrdinato)

  // La trattativa aperta, per poterla chiudere dalla richiesta che si sta
  // lavorando. Al massimo una (vedi trova_o_crea_opportunita); le chiuse
  // restano nell'elenco in sola lettura qui sopra, che è la loro storia.
  const apertaOra = (trattative ?? []).find(
    (t) => t.stato === 'nuovo' || t.stato === 'in_gestione'
  )
  const trattativaAperta = apertaOra
    ? {
        id: apertaOra.id as string,
        stato: apertaOra.stato as StatoTrattativa,
        assegnato_a: (apertaOra.assegnato_a as string) ?? null,
        motivo_perso: (apertaOra.motivo_perso as string) ?? null,
        motivo_annullato: (apertaOra.motivo_annullato as string) ?? null,
        motivo_vinto: (apertaOra.motivo_vinto as string) ?? null,
        valore_euro: apertaOra.valore_euro != null ? Number(apertaOra.valore_euro) : null,
      }
    : null

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
                      {t.assegnato_a
                        ? `la segue ${nomeDiEmail(t.assegnato_a as string, nomiStaff)}`
                        : 'nessun assegnatario'}
                    </span>
                  </span>
                  {t.stato === 'vinto' && (t.motivo_vinto || t.valore_euro != null) && (
                    <span className="voce-note muted">
                      Venduto: {t.motivo_vinto ?? '—'}
                      {euro(t.valore_euro != null ? Number(t.valore_euro) : null) &&
                        ` · ${euro(Number(t.valore_euro))}`}
                    </span>
                  )}
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

      {/* Le pagine del sito che ha guardato, in ordine cronologico.
          Prima qui c'erano la correzione del nome e una nota generica della
          persona; il percorso sul sito stava chiuso dentro ogni singola
          richiesta, una visita per volta. Ma è il percorso a dire cosa
          interessa a questa persona — le tre volte che è tornata sulla pagina
          del padel prima di scrivere del nuoto — e si legge tutto insieme o
          non si legge. */}
      <div className="card">
        <div className="card-head">
          <h2>Pagine viste sul sito</h2>
          <span className="muted">
            {percorso.pagine.length > 0
              ? `${percorso.pagine.length}${percorso.troncato ? '+' : ''} in ordine di visita`
              : 'nessuna visita collegata'}
          </span>
        </div>

        {percorso.pagine.length === 0 ? (
          <p className="vuoto">
            Nessuna pagina registrata: la visita non è stata riconosciuta, o la persona è stata
            inserita a mano.
          </p>
        ) : (
          <>
            <ol className="visite-elenco">
              {percorso.pagine.map((v, i) => {
                const precedente = i > 0 ? percorso.pagine[i - 1] : null
                // Il giorno si scrive solo quando cambia: ripeterlo su venti
                // righe di fila lo rende la colonna più rumorosa e meno
                // informativa dell'elenco.
                const giornoNuovo =
                  !precedente ||
                  String(precedente.visto_at).slice(0, 10) !== String(v.visto_at).slice(0, 10)
                return (
                  <li className="visite-riga" key={`${v.visto_at}-${i}`}>
                    <span className="visite-quando muted">
                      {giornoNuovo ? dataOraDi(v.visto_at as string) : oraDi(v.visto_at as string)}
                    </span>
                    <span className="visite-dove" title={v.pagina as string}>
                      {(v.titolo as string) || percorsoBreve(v.pagina as string)}
                    </span>
                  </li>
                )
              })}
            </ol>
            {percorso.troncato && (
              <p className="card-nota muted">
                Le più recenti {MAX_PAGINE_VISITATE}: oltre, l&apos;elenco smette di essere un
                percorso e diventa un registro.
              </p>
            )}
          </>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Le sue richieste</h2>
          <span className="muted">dalla più recente · si lavorano da qui</span>
        </div>

        {elenco.length === 0 ? (
          <p className="vuoto">Nessuna richiesta collegata.</p>
        ) : (
          <RichiestePersona
            richieste={elenco as unknown as RichiestaDiPersona[]}
            email={persona.email}
            cellulare={persona.cellulare}
            nome={nomePersona(persona)}
            operatori={operatori}
            puoCancellare={possoCancellare}
            trattativaAperta={trattativaAperta}
            io={email}
            sonoCommerciale={sonoCommerciale}
            possoRiassegnare={possoRiassegnare}
            nomiStaff={nomiStaff}
          />
        )}
      </div>
    </>
  )
}
