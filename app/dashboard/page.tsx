import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getNomeUtente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { eCommerciale, puoAmministrare, puoCancellare, puoRiassegnare } from '@/lib/auth/permessi'
import { SEZIONI, soloAccessoEsterno } from '@/lib/auth/sezioni'
import { ATTIVITA_IN_AGENDA, canaleDiRichiesta } from '@/lib/richieste'
import {
  STATI,
  STATI_IN_SINTESI,
  ETICHETTE_STATO,
  PUNTO_STATO,
  eChiusa,
  type StatoTrattativa,
} from '@/lib/pipeline'
import {
  TIPI_APPUNTAMENTO,
  oggiRoma,
  ordinaVoci,
  voceDaContatto,
  voceDaTask,
  type VoceAgenda,
} from '@/lib/agenda'
import { nomePersona } from '@/lib/persone'
import { mappaNomiStaff, ordinaPerCognome, type RigaStaff } from '@/lib/staff'
import { GuidaDashboard } from '@/components/GuidaDashboard'
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
  /**
   * Cosa vuol dire quel numero, sotto la cifra. Senza, «Le segui tu: 3» è un
   * numero da interpretare — e chi è nuovo al pannello lo interpreta male.
   */
  nota: string
  /**
   * true se un numero maggiore di zero è lavoro da fare: quei riquadri si
   * accendono (fondo velato, pallino che pulsa), gli altri restano una
   * fotografia. «Vinte: 12» non è una cosa da fare, e accendere anche quello
   * vorrebbe dire non accendere niente.
   */
  chiedeAzione?: boolean
  filtro: string
}[] = [
  {
    stato: 'nuovo',
    classe: 'stat-nuovo',
    etichetta: 'Da prendere in carico',
    nota: 'Nessuno le segue: sono di chi se le prende',
    chiedeAzione: true,
    filtro: 'stato=nuovo',
  },
  {
    stato: 'in_gestione',
    classe: 'stat-gestione',
    etichetta: 'Le segui tu',
    nota: 'Aperte e assegnate a te: hanno un seguito da portare avanti',
    chiedeAzione: true,
    filtro: 'mostra=tutte&mie=1',
  },
  {
    stato: 'vinto',
    classe: 'stat-vinto',
    etichetta: 'Vinte da te',
    nota: 'Chiuse bene: sono diventate socio',
    filtro: 'stato=vinto&mie=1',
  },
  {
    stato: 'perso',
    classe: 'stat-perso',
    etichetta: 'Perse da te',
    nota: 'Chiuse senza esito, col motivo registrato',
    filtro: 'stato=perso&mie=1',
  },
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
    'id, titolo, tipo, data, ora, durata_minuti, stato, note, assegnato_a, esito_tipo, esito, esito_da, esito_il, entita, entita_id'

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
        'id, azione, data_scelta, ora_scelta, nome, cognome, email, cellulare, attivita_label, messaggio, gestito, esito_tipo, esito, persona_id, appuntamento_annullato_il'
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

  const { data: contatti, error: erroreContatti } = idContatti.length
    ? await supabase.from('persone').select('id, nome, cognome, email, cellulare').in('id', idContatti)
    : { data: [] as Record<string, any>[], error: null }

  if (erroreContatti) {
    console.error('Nomi dei contatti degli impegni non letti:', erroreContatti.message)
  }

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

  // Quanti sono di giorni passati: è il numero che va in testa alla sezione.
  // «12 voci aperte» non dice che tre sono di ieri, ed è quello che conta.
  const arretrati = tutte.filter((v) => v.data < oggi).length

  return { voci: tutte.slice(0, IMPEGNI_IN_ELENCO), totaleAperti: tutte.length, arretrati }
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
    .select('id, stato, assegnato_a, motivo_perso, motivo_annullato, persona_id, creato_il')
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

  // Solo le colonne che `persone` ha davvero: `ultima_richiesta` sta sulla
  // vista persone_con_richieste, e chiederla qui faceva fallire la lettura —
  // con l'errore ignorato, ogni trattativa finiva intestata a «Senza nome».
  const { data: persone, error: errorePersone } = personaIds.length
    ? await supabase
        .from('persone')
        .select('id, nome, cognome, email, cellulare')
        .in('id', personaIds)
    : { data: [] as Record<string, any>[], error: null }

  // Un errore qui non svuota la pagina — le trattative si vedono comunque —
  // ma senza i nomi non si capisce di chi siano: va detto nei log invece di
  // lasciare un elenco di «Senza nome» che sembra un problema dei dati.
  if (errorePersone) {
    console.error('Nomi delle trattative non letti:', errorePersone.message)
  }

  const perId = new Map((persone ?? []).map((p) => [p.id as string, p]))

  function conPersona(t: Record<string, any>): TrattativaConPersona {
    const p = t.persona_id ? perId.get(t.persona_id as string) : undefined
    return {
      id: t.id as string,
      stato: t.stato,
      assegnato_a: (t.assegnato_a as string) ?? null,
      motivo_perso: (t.motivo_perso as string) ?? null,
      // Sempre nullo qui, come motivo_perso: l'elenco carica solo le aperte.
      // Si legge lo stesso invece di scrivere `null`, così resta giusto se un
      // domani il filtro sopra cambia.
      motivo_annullato: (t.motivo_annullato as string) ?? null,
      personaId: (t.persona_id as string) ?? null,
      // Da quanto è aperta: in elenco una trattativa di stamattina e una
      // ferma da tre settimane avevano lo stesso aspetto, e la seconda è
      // quella da chiamare.
      creatoIl: (t.creato_il as string) ?? null,
      nome: (p?.nome as string) ?? null,
      cognome: (p?.cognome as string) ?? null,
      email: (p?.email as string) ?? null,
      cellulare: (p?.cellulare as string) ?? null,
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
        .select('email, nome, cognome, commerciale'),
    ])

  // Ordinati per cognome, come in Gestione utenti: una tendina di colleghi
  // ordinata per email li mette in un ordine che nessuno ha in testa.
  const staffOrdinato = ordinaPerCognome((staff ?? []) as (RigaStaff & { commerciale?: boolean })[])
  const operatori = staffOrdinato.map((x) => x.email)
  const commerciali = staffOrdinato.filter((x) => x.commerciale).map((x) => x.email)
  // Email → "Nome Cognome": negli impegni si legge chi ha in mano una riga,
  // non il suo indirizzo.
  const nomiStaff = mappaNomiStaff(staffOrdinato)

  const oggi = oggiRoma()

  const inArrivo = SEZIONI.filter((s) => s.inArrivo && sezioniConsentite.includes(s.chiave))

  // Quante trattative chiedono qualcosa a chi guarda: le libere da prendere
  // più le sue in gestione. Va in testa alla sezione, perché aprendo la
  // pagina la prima domanda è «quante cose ho da fare», non «quante ce ne
  // sono in tutto».
  const daFareTrattative = trattative ? trattative.libere + trattative.mie.in_gestione : 0

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">CRM Ronchiverdi</p>
        <h1>{nomeUtente ? `Ciao ${nomeUtente.split(' ')[0]}` : 'Dashboard'}</h1>
        <p className="muted">Le trattative in corso e cosa ti aspetta oggi.</p>
      </div>

      {/* La legenda: le due sezioni di questa pagina hanno perimetri diversi
          — sopra le trattative **tue**, sotto gli impegni di **tutti** — e
          quella differenza non si vede guardando. */}
      <GuidaDashboard />

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
          {/* Il capitolo si vede: nome pieno, cosa risponde, e a destra quante
              cose chiedono qualcosa. Prima era un'etichettina grigia della
              misura dei metadati, e la pagina risultava un nastro continuo di
              riquadri senza capitoli. */}
          <div className="riepilogo-testa">
            <h2 className="riepilogo-titolo">Le tue trattative</h2>
            <p className="riepilogo-sottotitolo muted">Abbonamento Club e Family</p>
            {daFareTrattative > 0 && (
              <span className="badge badge-warn badge-punto">
                {daFareTrattative} da lavorare
              </span>
            )}
          </div>

          <div className="griglia-stat">
            {RIQUADRI_STATO.map(({ stato, classe, etichetta, nota, chiedeAzione, filtro }) => {
              const valore = stato === 'nuovo' ? trattative.libere : trattative.mie[stato]
              // Tre condizioni, tre aspetti: c'è lavoro (accesa), non c'è
              // lavoro ma il numero conta (normale), è zero (spenta). Senza
              // la terza, quattro zeri in fila pesano come quattro numeri.
              const accesa = chiedeAzione && valore > 0
              return (
                <Link
                  key={stato}
                  className={`stat ${classe}${accesa ? ' is-azione' : ''}${valore === 0 ? ' is-vuoto' : ''}`}
                  href={`/dashboard/richieste/richieste-club?${filtro}`}
                >
                  <span className="stat-testa">
                    <span className="stat-label">
                      {accesa && <span className="stat-punto" aria-hidden="true" />}
                      {etichetta ?? ETICHETTE_STATO[stato]}
                    </span>
                    <span className="stat-freccia" aria-hidden="true">
                      →
                    </span>
                  </span>
                  <span className="stat-valore">{valore}</span>
                  <span className="stat-nota">{valore === 0 ? 'Nessuna, per ora' : nota}</span>
                </Link>
              )
            })}
          </div>

          {/* La fotografia del club, in una riga: serve a sapere se sei tu a
              essere carico o è carico il club, e non merita quattro riquadri
              accanto ai tuoi. */}
          {/* Gli stessi quattro numeri, ma di tutto il club: serve a sapere se
              sei tu a essere carico o è carico il club. In fila con il
              pallino del proprio stato, gli stessi colori dei riquadri qui
              sopra e delle righe qui sotto — prima era una frase di testo
              corrente, che a colpo d'occhio non diceva niente. */}
          <div className="riepilogo-club">
            <ul className="canale-conti muted">
              <li className="muted">Nel club:</li>
              {STATI_IN_SINTESI.map((x) => (
                <li key={x}>
                  <span className={`chip-punto ${PUNTO_STATO[x]}`} aria-hidden="true" />
                  <b>{trattative.club[x]}</b> {ETICHETTE_STATO[x].toLowerCase()}
                </li>
              ))}
            </ul>
            <Link className="link" href="/dashboard/richieste/richieste-club?mostra=tutte">
              Apri Abbonamento Club e Family →
            </Link>
          </div>

          {/* Le libere prima delle proprie, come nell'ordine dei riquadri: una
              trattativa che nessuno segue è la sola che rischia di non essere
              chiamata da nessuno, e chi apre la pagina deve trovarla in cima —
              non sotto l'elenco del lavoro che ha già in mano. */}
          {mieTrattative && mieTrattative.libere.length > 0 && (
            <div className="card card-azione">
              <div className="card-head">
                <h3 className="card-titolo">
                  <span className="chip-punto punto-nuovo" aria-hidden="true" />
                  Libere: le prende chi vuole
                </h3>
                <span className="badge badge-warn badge-punto">
                  {mieTrattative.libereTotale}{' '}
                  {mieTrattative.libereTotale === 1 ? 'senza titolare' : 'senza titolare'}
                </span>
              </div>
              <p className="card-nota muted">
                Nessuno le ha in carico. «Prendi in carico» te le assegna e le sposta in gestione.
              </p>
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

          {mieTrattative && mieTrattative.mie.length > 0 && (
            <div className="card">
              <div className="card-head">
                <h3 className="card-titolo">
                  <span className="chip-punto punto-gestione" aria-hidden="true" />
                  Quelle che segui tu
                </h3>
                <span className="badge badge-info badge-punto">
                  {mieTrattative.mieTotale} in gestione
                </span>
              </div>
              <p className="card-nota muted">
                Aperte e assegnate a te: da portare a vinta o a persa, col motivo.
              </p>
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

          {mieTrattative && mieTrattative.mie.length === 0 && mieTrattative.libere.length === 0 && (
            <div className="card">
              {/* Un elenco vuoto centrato in grigio si legge come un errore:
                  qui è una buona notizia, e va detto come tale. */}
              <div className="vuoto-buono">
                <span className="vuoto-glifo" aria-hidden="true">
                  ✓
                </span>
                <p className="vuoto-titolo">Nessuna trattativa da lavorare</p>
                <p className="vuoto-nota">
                  Non ne hai in mano e non ce ne sono libere da prendere.
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      {impegni && (
        <section className="riepilogo-sezione">
          <div className="riepilogo-testa">
            <h2 className="riepilogo-titolo">Impegni di oggi</h2>
            <p className="riepilogo-sottotitolo muted">Appuntamenti, telefonate e cose da fare</p>
            {/* Gli arretrati staccati dal totale: «12 voci aperte» non dice
                che tre sono di ieri, ed è quello che conta. */}
            {impegni.arretrati > 0 ? (
              <span className="badge badge-ko badge-punto">
                {impegni.arretrati} {impegni.arretrati === 1 ? 'arretrato' : 'arretrati'}
              </span>
            ) : (
              impegni.totaleAperti > 0 && (
                <span className="badge badge-punto">{impegni.totaleAperti} da fare</span>
              )
            )}
          </div>
          {impegni.voci.length > 0 ? (
            <div className={`card${impegni.arretrati > 0 ? ' card-azione' : ''}`}>
              <div className="card-head">
                <h3 className="card-titolo">Da fare adesso</h3>
                <span className="muted">
                  {impegni.totaleAperti}{' '}
                  {impegni.totaleAperti === 1 ? 'voce aperta' : 'voci aperte'}
                </span>
              </div>

              {/* La legenda dei colori, non solo la regola di chi vede cosa:
                  in elenco la banda rossa e quella blu vanno capite al primo
                  sguardo, e una riga qui costa meno di un badge per riga. */}
              <p className="card-nota muted">
                Banda rossa: <strong>arretrato</strong>, è di un giorno passato. Banda blu: è di
                oggi. Gli appuntamenti — in sede e telefonici — sono quelli di tutti, perché al
                banco serve sapere chi arriva; le cose da fare sono solo le tue.
              </p>

              {/* Gestibili qui: chiudere una telefonata appena fatta non deve
                  costare tre passaggi verso l'agenda. */}
              <ImpegniDashboard
                voci={impegni.voci}
                oggi={oggi}
                io={email}
                operatori={operatori}
                puoCancellare={possoCancellare}
                nomiStaff={nomiStaff}
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
              <div className="vuoto-buono">
                <span className="vuoto-glifo" aria-hidden="true">
                  ✓
                </span>
                <p className="vuoto-titolo">Giornata pulita</p>
                <p className="vuoto-nota">
                  Nessun appuntamento e nessuna cosa da fare, né arretrata né per oggi.{' '}
                  <Link className="link" href="/dashboard/agenda">
                    Vedi tutta l&apos;agenda
                  </Link>
                  .
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      {nonInstradate.totale > 0 && (
        <div className="card card-avviso">
          <div className="card-head">
            <h3 className="card-titolo">Richieste senza sezione</h3>
            <span className="badge badge-warn badge-punto">
              {nonInstradate.totale} da instradare
            </span>
          </div>
          <p className="card-nota muted">
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
            <h3 className="card-titolo">Moduli in arrivo</h3>
          </div>
          <p className="card-nota muted">
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
