import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getNomeUtente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { eCommerciale, puoAmministrare, puoCancellare, puoRiassegnare } from '@/lib/auth/permessi'
import { SEZIONI, soloAccessoEsterno } from '@/lib/auth/sezioni'
import { ATTIVITA_IN_AGENDA, canaleDiRichiesta } from '@/lib/richieste'
import { STATI, ETICHETTE_STATO, eChiusa, type StatoTrattativa } from '@/lib/pipeline'
import {
  TIPI_APPUNTAMENTO,
  oggiRoma,
  ordinaVoci,
  voceDaContatto,
  voceDaTask,
  type VoceAgenda,
} from '@/lib/agenda'
import { nomePersona } from '@/lib/persone'
import { ImpegniDashboard } from './ImpegniDashboard'
import { TrattativeDashboard, type TrattativaConPersona } from './TrattativeDashboard'

export const dynamic = 'force-dynamic'

/** Quanti impegni mostrare in elenco prima di rimandare all'agenda. */
const IMPEGNI_IN_ELENCO = 12

/** Quante trattative elencare per blocco prima di rimandare alla sezione. */
const TRATTATIVE_IN_ELENCO = 12

// I quattro riquadri della pipeline, nell'ordine in cui si attraversa.
//
// Sono i numeri **di chi guarda**, non del club: la pagina è la sua giornata,
// e «Vinte: 40» del club non gli dice cosa fare. Il totale del club sta in
// una riga sotto, per chi vuole la fotografia.
//
// `nuovo` non conta le trattative in stato `nuovo` ma quelle **senza
// titolare**: prendere in carico sposta lo stato da `nuovo` a `in_gestione`,
// quindi i due insiemi coincidono, e «senza titolare» è ciò che si può
// davvero prendere — comprese le eventuali in gestione rimaste orfane.
//
// Il link porta al canale già filtrato come il riquadro: un numero che si
// apre su un elenco diverso da quello che promette è peggio di un numero
// senza link.
const RIQUADRI_STATO: {
  stato: StatoTrattativa
  classe: string
  /** Etichetta propria quando quella dello stato, al personale, direbbe altro. */
  etichetta?: string
  filtro: string
}[] = [
  { stato: 'nuovo', classe: 'stat-nuovo', etichetta: 'Da prendere in carico', filtro: 'stato=nuovo' },
  { stato: 'in_gestione', classe: 'stat-gestione', etichetta: 'Le segui tu', filtro: 'mostra=tutte&mie=1' },
  { stato: 'vinto', classe: 'stat-vinto', etichetta: 'Vinte da te', filtro: 'stato=vinto&mie=1' },
  { stato: 'perso', classe: 'stat-perso', etichetta: 'Perse da te', filtro: 'stato=perso&mie=1' },
]

/**
 * Le richieste che non corrispondono a nessun canale (vedi lib/richieste.ts):
 * un'attività nuova sul sito non ancora instradata, o una richiesta tennis
 * arrivata senza settore. Non finiscono nella sezione di nessuno, quindi
 * senza questa spia resterebbero invisibili — che è il modo più silenzioso di
 * perdere un contatto.
 */
async function richiesteNonInstradate() {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('form_contatti')
    .select('attivita, settore, origine')
    .eq('gestito', false)
    .limit(500)

  const fuori = (data ?? []).filter((r) => !canaleDiRichiesta(r))
  const motivi = new Map<string, number>()
  for (const r of fuori) {
    const chiave = r.attivita ? `attività "${r.attivita}"${r.settore ? '' : ' (senza settore)'}` : `origine "${r.origine ?? 'non indicata'}"`
    motivi.set(chiave, (motivi.get(chiave) ?? 0) + 1)
  }
  return { totale: fuori.length, motivi: [...motivi.entries()] }
}

/**
 * I contatori delle trattative, in due scope che la pagina mostra insieme:
 * i **tuoi** numeri grandi, e il totale del club in una riga sotto.
 *
 * Prima erano solo quelli del club, e sopra un elenco delle proprie: con un
 * commerciale solo al lavoro i due coincidevano, e la pagina sembrava dire
 * due volte la stessa cosa — «In gestione: 3» e «Le segui tu: 3». Peggio,
 * «Da prendere in carico» era davvero la stessa cosa detta due volte:
 * prendere in carico sposta lo stato da `nuovo` a `in_gestione`, quindi il
 * riquadro e l'elenco erano lo stesso insieme, un numero e la sua lista.
 *
 * Si contano le opportunità, non le richieste: la trattativa è della persona,
 * e chi ha scritto tre volte è un contatto da richiamare, non tre.
 *
 * Attenzione a un punto che i numeri non dicono: una richiesta Club o Family
 * arrivata senza email né cellulare non genera nessuna persona e quindi
 * nessuna trattativa (vedi trova_o_crea_persona). Resta visibile fra le
 * richieste da lavorare del canale.
 */
async function contatoriTrattative(email: string | null) {
  const supabase = createSupabaseServiceClient()
  // Una lettura sola delle due colonne che servono: otto count separati
  // sarebbero otto round trip per una tabella che sta in una pagina.
  const { data } = await supabase.from('opportunita').select('stato, assegnato_a')

  const vuoto = () => Object.fromEntries(STATI.map((x) => [x, 0])) as Record<StatoTrattativa, number>
  const mie = vuoto()
  const club = vuoto()
  // «Da prendere in carico» sono quelle di nessuno, non quelle in stato
  // `nuovo`: chiunque abbia il diritto commerciale può prendersele, quindi
  // per chi guarda sono lavoro disponibile, non lavoro di altri.
  let libere = 0

  for (const riga of data ?? []) {
    const stato = riga.stato as StatoTrattativa
    if (!(stato in club)) continue
    club[stato] += 1
    if (email && riga.assegnato_a === email) mie[stato] += 1
    if (!riga.assegnato_a && !eChiusa(stato)) libere += 1
  }

  return { mie, club, libere }
}

/**
 * Gli impegni su cui si può agire adesso: gli arretrati e quelli di oggi. Le
 * voci future restano in agenda — qui servirebbero solo a far sembrare la
 * giornata più piena di com'è.
 *
 * Chi vede cosa, e perché non è la stessa regola per tutti:
 *
 *  - **gli appuntamenti — in sede e telefonici — si vedono tutti**, anche
 *    quelli dei colleghi. Il club è uno: chi è al banco deve sapere chi arriva
 *    stamattina anche se l'appuntamento non è suo, altrimenti si scopre la
 *    persona in portineria. Ci sono anche quelli prenotati dal sito, che non
 *    hanno un assegnatario per definizione.
 *  - **le cose da fare si vedono solo se proprie**: un task è un promemoria
 *    personale, e l'elenco di tutti sarebbe illeggibile e per lo più roba di
 *    altri.
 *
 * Email e WhatsApp non compaiono: si registrano già chiusi (vedi
 * TIPI_SOLO_REGISTRATI in lib/agenda.ts), quindi non sono mai «da fare».
 */
async function impegniDelGiorno(email: string | null) {
  const supabase = createSupabaseServiceClient()
  const oggi = oggiRoma()

  const COLONNE_TASK =
    'id, titolo, tipo, data, ora, durata_minuti, stato, note, assegnato_a, esito_tipo, esito, entita, entita_id'

  // Due letture invece di un filtro `or`: le email contengono @ e punti, che
  // in un `or` di PostgREST vanno protetti a mano — e una query che si legge
  // è meglio di una che si azzecca.
  const [{ data: appuntamenti }, { data: miei }, { data: prenotati }] = await Promise.all([
    supabase
      .from('task')
      .select(COLONNE_TASK)
      .eq('stato', 'aperto')
      .in('tipo', TIPI_APPUNTAMENTO)
      // `lte` e non `eq`: un impegno di martedì rimasto aperto è esattamente
      // quello che non deve sparire per il fatto di essere passato.
      .lte('data', oggi),
    email
      ? supabase
          .from('task')
          .select(COLONNE_TASK)
          .eq('stato', 'aperto')
          .eq('assegnato_a', email)
          .lte('data', oggi)
      : Promise.resolve({ data: [] as Record<string, any>[] }),
    // Gli appuntamenti prenotati dal sito: sono voci d'agenda per conto loro
    // (vedi voceDaContatto) e nessuno li ha in carico.
    supabase
      .from('form_contatti')
      .select(
        'id, azione, data_scelta, ora_scelta, nome, cognome, email, cellulare, attivita_label, messaggio, gestito, esito_tipo, esito, persona_id'
      )
      .in('attivita', ATTIVITA_IN_AGENDA)
      .eq('gestito', false)
      .lte('data_scelta', oggi)
      .not('data_scelta', 'is', null),
  ])

  // Le due letture su task si sovrappongono (un mio appuntamento sta in
  // entrambe): si deduplica per id, o comparirebbe due volte.
  const righeTask = new Map<string, Record<string, any>>()
  for (const riga of [...(appuntamenti ?? []), ...(miei ?? [])]) {
    righeTask.set(riga.id as string, riga)
  }

  // I nomi dei contatti agganciati: `task.entita_id` è un id, e un impegno
  // senza il nome di chi riguarda è metà informazione.
  const idContatti = [
    ...new Set(
      [...righeTask.values()]
        .filter((t) => t.entita === 'persona' && t.entita_id)
        .map((t) => t.entita_id as string)
    ),
  ]

  const { data: contatti } = idContatti.length
    ? await supabase.from('persone').select('id, nome, cognome, email, cellulare').in('id', idContatti)
    : { data: [] as Record<string, any>[] }

  const perId = new Map(
    (contatti ?? []).map((p) => [
      p.id as string,
      {
        id: p.id as string,
        nome: nomePersona(p),
        email: (p.email as string) ?? null,
        cellulare: (p.cellulare as string) ?? null,
      },
    ])
  )

  const voci: VoceAgenda[] = [
    ...[...righeTask.values()].map((riga) =>
      voceDaTask(riga, riga.entita === 'persona' && riga.entita_id ? perId.get(riga.entita_id) : undefined)
    ),
    ...(prenotati ?? []).map(voceDaContatto).filter((v): v is VoceAgenda => v !== null),
  ]

  // Prima per giorno (gli arretrati in cima, sono quelli che scottano), poi
  // per ora dentro la giornata.
  const ordinate = [...voci].sort((a, b) => a.data.localeCompare(b.data))
  const perGiorno = new Map<string, VoceAgenda[]>()
  for (const v of ordinate) {
    perGiorno.set(v.data, [...(perGiorno.get(v.data) ?? []), v])
  }
  const tutte = [...perGiorno.keys()].flatMap((g) => ordinaVoci(perGiorno.get(g)!))

  return { voci: tutte.slice(0, IMPEGNI_IN_ELENCO), totaleAperti: tutte.length }
}

/**
 * Le trattative che riguardano chi guarda: quelle che ha in mano, e quelle
 * libere che può prendersi.
 *
 * I quattro riquadri della pipeline dicono quante ce ne sono in ogni stato —
 * la fotografia del club. Questo dice *quali sono le tue*, che è la domanda
 * con cui si apre la giornata e a cui i riquadri non rispondono.
 */
async function trattativeDaLavorare(email: string | null) {
  const supabase = createSupabaseServiceClient()

  // Solo le aperte: una vinta o persa non è lavoro, è storia — si consulta
  // dalla sezione, filtrando per stato.
  const { data } = await supabase
    .from('opportunita')
    .select('id, stato, assegnato_a, motivo_perso, persona_id, creato_il')
    .in('stato', ['nuovo', 'in_gestione'])
    .order('creato_il', { ascending: false })

  const aperte = data ?? []
  const mie = email ? aperte.filter((t) => t.assegnato_a === email) : []
  // «Da prendere in carico» sono quelle di nessuno: una in gestione senza
  // assegnatario è un'incoerenza, e finirebbe qui comunque — è giusto, è
  // lavoro che nessuno ha in mano.
  const libere = aperte.filter((t) => !t.assegnato_a)

  const scelte = [...mie, ...libere].slice(0, TRATTATIVE_IN_ELENCO * 2)
  const personaIds = [...new Set(scelte.map((t) => t.persona_id).filter(Boolean))] as string[]

  const { data: persone } = personaIds.length
    ? await supabase
        .from('persone')
        .select('id, nome, cognome, email, cellulare, ultima_richiesta')
        .in('id', personaIds)
    : { data: [] as Record<string, any>[] }

  const perId = new Map((persone ?? []).map((p) => [p.id as string, p]))

  function conPersona(t: Record<string, any>): TrattativaConPersona {
    const p = t.persona_id ? perId.get(t.persona_id as string) : undefined
    return {
      id: t.id as string,
      stato: t.stato,
      assegnato_a: (t.assegnato_a as string) ?? null,
      motivo_perso: (t.motivo_perso as string) ?? null,
      personaId: (t.persona_id as string) ?? null,
      nome: (p?.nome as string) ?? null,
      cognome: (p?.cognome as string) ?? null,
      email: (p?.email as string) ?? null,
      cellulare: (p?.cellulare as string) ?? null,
      ultimaRichiesta: (p?.ultima_richiesta as string) ?? null,
    }
  }

  return {
    mie: mie.slice(0, TRATTATIVE_IN_ELENCO).map(conPersona),
    mieTotale: mie.length,
    libere: libere.slice(0, TRATTATIVE_IN_ELENCO).map(conPersona),
    libereTotale: libere.length,
  }
}

export default async function RiepilogoPage() {
  const email = emailCorrente()

  // Sezioni e diritti prima di tutto, perché decidono *cosa* vale la pena
  // leggere. Costano una lettura sola: stanno tutti sulla stessa riga di
  // staff_users, che rigaStaffCorrente tiene in cache per la durata della
  // richiesta — e il layout l'ha già chiesta.
  const [sezioniConsentite, amministra, sonoCommerciale, possoRiassegnare, possoCancellare] =
    await Promise.all([
      getSezioniConsentite(email),
      puoAmministrare(email),
      eCommerciale(email),
      puoRiassegnare(email),
      puoCancellare(email),
    ])

  // Un account di un partner esterno non vede il Riepilogo: parla di
  // trattative, richieste e impegni dei soci, e chi valida i voucher non deve
  // leggerne niente. Lo si manda subito sulla sua pagina, che per lui è tutto
  // il pannello. Il controllo sta qui e non solo nel menu: /dashboard resta
  // un indirizzo digitabile.
  if (soloAccessoEsterno(sezioniConsentite)) {
    const suaSezione = SEZIONI.find((s) => sezioniConsentite.includes(s.chiave))
    if (suaSezione) redirect(suaSezione.href)
  }

  // Un numero che porta a «non hai accesso» è peggio di un numero che non
  // c'è: i riquadri esistono solo per chi può poi aprirli, e la lettura che
  // li alimenta si salta del tutto.
  const vedeTrattative = sezioniConsentite.includes('richieste-club')
  const vedeAgenda = sezioniConsentite.includes('agenda')

  // Tutto il resto parte insieme: erano attese in fila, e si sommavano andate
  // e ritorni verso Supabase per disegnare una pagina che il database calcola
  // in frazioni di millisecondo.
  const [nomeUtente, trattative, mieTrattative, impegni, nonInstradate, { data: staff }] =
    await Promise.all([
      getNomeUtente(email),
      vedeTrattative ? contatoriTrattative(email) : Promise.resolve(null),
      vedeTrattative ? trattativeDaLavorare(email) : Promise.resolve(null),
      vedeAgenda ? impegniDelGiorno(email) : Promise.resolve(null),
      // La spia interessa solo chi amministra: è lui che aggiunge un canale.
      amministra
        ? richiesteNonInstradate()
        : Promise.resolve({ totale: 0, motivi: [] as [string, number][] }),
      // Per i comandi sul posto: chi può essere assegnatario di una voce e
      // chi può prendersi una trattativa.
      createSupabaseServiceClient()
        .from('staff_users')
        .select('email, commerciale')
        .order('email'),
    ])

  const operatori = (staff ?? []).map((x) => x.email as string)
  const commerciali = (staff ?? []).filter((x) => x.commerciale).map((x) => x.email as string)

  const oggi = oggiRoma()

  const inArrivo = SEZIONI.filter((s) => s.inArrivo && sezioniConsentite.includes(s.chiave))

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">CRM Ronchiverdi</p>
        <h1>{nomeUtente ? `Ciao ${nomeUtente.split(' ')[0]}` : 'Dashboard'}</h1>
        <p className="muted">Le trattative in corso e cosa ti aspetta oggi.</p>
      </div>

      {/* Una sezione sola, non due: i riquadri sono i tuoi numeri e gli
          elenchi qui sotto sono il loro dettaglio. Prima i riquadri contavano
          tutto il club e sopra c'era un elenco delle proprie: con un
          commerciale solo al lavoro i numeri coincidevano, e la pagina
          sembrava ripetersi — «Da prendere in carico» era perfino lo stesso
          insieme detto due volte, un numero e la sua lista.

          I contatori che c'erano ancora prima — richieste totali, sessioni,
          conversione — erano numeri da guardare, non da aprire. I dati sul
          traffico stanno in Analytics e Visite al sito, dove si leggono col
          periodo e il confronto. */}
      {trattative && (
        <section className="riepilogo-sezione">
          <h2 className="riepilogo-titolo">Le tue trattative</h2>

          <div className="griglia-stat">
            {RIQUADRI_STATO.map(({ stato, classe, etichetta, filtro }) => (
              <Link
                key={stato}
                className={`stat ${classe}`}
                href={`/dashboard/richieste/richieste-club?${filtro}`}
              >
                <span className="stat-freccia" aria-hidden="true">
                  →
                </span>
                <span className="stat-valore">
                  {stato === 'nuovo' ? trattative.libere : trattative.mie[stato]}
                </span>
                <span className="stat-label">{etichetta ?? ETICHETTE_STATO[stato]}</span>
              </Link>
            ))}
          </div>

          {/* La fotografia del club, in una riga: serve a sapere se sei tu a
              essere carico o è carico il club, e non merita quattro riquadri
              accanto ai tuoi. */}
          <p className="muted riepilogo-club">
            Nel club:{' '}
            {STATI.map((x, i) => (
              <span key={x}>
                {i > 0 && ' · '}
                {trattative.club[x]} {ETICHETTE_STATO[x].toLowerCase()}
              </span>
            ))}
            {'. '}
            <Link className="link" href="/dashboard/richieste/richieste-club?mostra=tutte">
              Apri Club e Family
            </Link>
          </p>

          {mieTrattative && mieTrattative.mie.length > 0 && (
            <div className="card">
              <div className="card-head">
                <h2 className="agenda-giorno-titolo">Quelle che segui tu</h2>
              </div>
              <TrattativeDashboard
                trattative={mieTrattative.mie}
                io={email}
                sonoCommerciale={sonoCommerciale}
                possoRiassegnare={possoRiassegnare}
                commerciali={commerciali}
              />
              {mieTrattative.mieTotale > mieTrattative.mie.length && (
                <Link
                  className="btn btn-ghost btn-sm"
                  href="/dashboard/richieste/richieste-club?mostra=tutte&mie=1"
                >
                  Vedi tutte le tue ({mieTrattative.mieTotale})
                </Link>
              )}
            </div>
          )}

          {mieTrattative && mieTrattative.libere.length > 0 && (
            <div className="card">
              <div className="card-head">
                <h2 className="agenda-giorno-titolo">Libere, puoi prenderle</h2>
              </div>
              {/* Prendere in carico richiede il diritto commerciale: senza,
                  l'elenco si vede — è lavoro del club, non un segreto — ma i
                  comandi non compaiono (vedi puoAssegnare in lib/pipeline.ts). */}
              <TrattativeDashboard
                trattative={mieTrattative.libere}
                io={email}
                sonoCommerciale={sonoCommerciale}
                possoRiassegnare={possoRiassegnare}
                commerciali={commerciali}
              />
              {mieTrattative.libereTotale > mieTrattative.libere.length && (
                <Link
                  className="btn btn-ghost btn-sm"
                  href="/dashboard/richieste/richieste-club?stato=nuovo"
                >
                  Vedi tutte quelle libere ({mieTrattative.libereTotale})
                </Link>
              )}
            </div>
          )}

          {mieTrattative && mieTrattative.mie.length === 0 && mieTrattative.libere.length === 0 && (
            <div className="card">
              <p className="vuoto" style={{ padding: '1rem' }}>
                Non hai trattative in mano e non ce ne sono libere da prendere.
              </p>
            </div>
          )}
        </section>
      )}

      {impegni && (
        <section className="riepilogo-sezione">
          <h2 className="riepilogo-titolo">Impegni di oggi</h2>
          {impegni.voci.length > 0 ? (
            <div className="card">
              <div className="card-head">
                <h2 className="agenda-giorno-titolo">Da fare adesso</h2>
                <span className="muted">
                  {impegni.totaleAperti}{' '}
                  {impegni.totaleAperti === 1 ? 'voce aperta' : 'voci aperte'}
                </span>
              </div>

              <p className="muted" style={{ marginTop: 0 }}>
                Gli appuntamenti — in sede e telefonici — sono quelli di tutti: al banco serve
                sapere chi arriva. Le cose da fare sono solo le tue.
              </p>

              {/* Gestibili qui: chiudere una telefonata appena fatta non deve
                  costare tre passaggi verso l'agenda. */}
              <ImpegniDashboard
                voci={impegni.voci}
                oggi={oggi}
                io={email}
                operatori={operatori}
                puoCancellare={possoCancellare}
              />

              {/* Il link porta all'agenda già filtrata sulle proprie: è la
                  continuazione di questo elenco, non un'altra pagina da
                  ri-filtrare a mano. */}
              <Link className="btn btn-ghost btn-sm" href="/dashboard/agenda?vista=lista&solo=mie">
                Apri la tua agenda
              </Link>
            </div>
          ) : (
            <div className="card">
              <p className="vuoto" style={{ padding: '1rem' }}>
                Nessun appuntamento e nessuna cosa da fare, né arretrata né per oggi.{' '}
                <Link className="link" href="/dashboard/agenda">
                  Vedi tutta l&apos;agenda
                </Link>
                .
              </p>
            </div>
          )}
        </section>
      )}

      {nonInstradate.totale > 0 && (
        <div className="card" style={{ borderColor: 'rgba(138, 100, 16, 0.35)' }}>
          <div className="card-head">
            <h2>Richieste senza sezione</h2>
            <span className="badge badge-warn">{nonInstradate.totale} da instradare</span>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            Queste richieste non compaiono nella sezione di nessun responsabile: va aggiunto il
            canale corrispondente in <code>lib/richieste.ts</code>.
          </p>
          <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.1rem' }}>
            {nonInstradate.motivi.map(([motivo, quante]: [string, number]) => (
              <li key={motivo} style={{ marginBottom: '0.35rem' }}>
                {motivo} — {quante} {quante === 1 ? 'richiesta' : 'richieste'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {inArrivo.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Moduli in arrivo</h2>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            Hai già il permesso per queste sezioni: appariranno nel menu appena il modulo è pronto.
          </p>
          <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.1rem' }}>
            {inArrivo.map((s) => (
              <li key={s.chiave} style={{ marginBottom: '0.35rem' }}>
                {s.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
