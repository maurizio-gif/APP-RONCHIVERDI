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
  DURATA_PREDEFINITA,
  eEsitoValido,
  normalizzaOra,
  oggiRoma,
  ordinaVoci,
  tipoDaAzione,
  voceDaContatto,
  voceDaTask,
  type VoceAgenda,
} from '@/lib/agenda'
import { nomePersona } from '@/lib/persone'
import { mappaNomiStaff, ordinaPerCognome, type RigaStaff } from '@/lib/staff'
import { COLONNE_ASSEGNAZIONE_RICHIESTA, conColonneNuove } from '@/lib/migrazioni'
import { GuidaDashboard } from '@/components/GuidaDashboard'
import { EventiElenco, type GestioneSemplicePerVoce } from '@/components/EventiElenco'
import type { DatiTrattativa } from './richieste/Trattativa'
import {
  TrattativeDashboard,
  type EventoDOrigine,
  type TrattativaConPersona,
} from './TrattativeDashboard'

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
 * Gli eventi su cui si può agire adesso: gli arretrati e quelli di oggi. Le
 * voci future restano in agenda — qui servirebbero solo a far sembrare la
 * giornata più piena di com'è.
 *
 * **Quelli di tutti, senza distinzione di tipo.** Prima gli appuntamenti si
 * vedevano tutti e le cose da fare solo le proprie, con l'idea che un task
 * fosse un promemoria personale. Ma le due metà della regola producevano un
 * elenco che nessuno poteva leggere per quello che era: guardandolo non si
 * sapeva se «niente di arretrato» volesse dire che il club è in pari o solo
 * che l'arretrato è di un collega. In segreteria si copre il turno di chi non
 * c'è, e per farlo bisogna poter vedere cosa è rimasto indietro a chiunque.
 *
 * Il prezzo è che ogni riga deve dire **di chi è**, e dirlo sempre: il tag
 * dell'assegnatario in ImpegniDashboard porta il nome per esteso, o «Non
 * assegnato» dove non c'è nessuno. Senza quello un elenco di tutti si legge
 * come una lista di cose proprie, ed è il modo di presentarsi in due alla
 * stessa telefonata.
 *
 * Email e WhatsApp non compaiono: si registrano già chiusi (vedi
 * TIPI_SOLO_REGISTRATI in lib/agenda.ts), quindi non sono mai «da fare».
 */
async function impegniDelGiorno() {
  const supabase = createSupabaseServiceClient()
  const oggi = oggiRoma()

  const COLONNE_TASK =
    'id, titolo, tipo, data, ora, durata_minuti, stato, note, assegnato_a, esito_tipo, esito, esito_da, esito_il, entita, entita_id'

  const [{ data: righe }, { data: prenotati }] = await Promise.all([
    supabase
      .from('task')
      .select(COLONNE_TASK)
      .eq('stato', 'aperto')
      // `lte` e non `eq`: un impegno di martedì rimasto aperto è esattamente
      // quello che non deve sparire per il fatto di essere passato.
      .lte('data', oggi),
    // Le richieste del settore core ancora da gestire: sono voci d'agenda per
    // conto loro (vedi voceDaContatto).
    //
    // `assegnato_a` è quello della trattativa, scritto dal trigger
    // assegna_eventi_della_trattativa — prendere in carico la trattativa vuol
    // dire prendersi anche il suo appuntamento, ed è la ragione per cui la
    // colonna è scritta e non derivata: la trattativa si riassegna, e di
    // questa riga serve sapere **a chi era**.
    conColonneNuove<Record<string, any>>(
      'id, azione, data_scelta, ora_scelta, nome, cognome, email, cellulare, attivita_label, messaggio, gestito, gestito_da, gestito_il, assegnato_a, note, note_da, note_il, esito_tipo, esito, esito_da, esito_il, persona_id, appuntamento_annullato_il',
      COLONNE_ASSEGNAZIONE_RICHIESTA,
      (colonne) =>
        supabase
          .from('form_contatti')
          .select(colonne)
          .in('attivita', ATTIVITA_IN_AGENDA)
          .eq('gestito', false)
          // Scadute o di oggi, **e anche quelle senza un'ora**: chi ha
          // scritto un messaggio senza prenotare non ha una `data_scelta`, e
          // il filtro sulla sola data lo lasciava fuori. Era lavoro invisibile
          // — visibile in Eventi Core e non in dashboard — e per giunta
          // proprio il tipo che si dimentica più facilmente, perché nessuno
          // gli ha dato un orario. In elenco si colloca nel giorno in cui è
          // arrivato (vedi voceDaContatto), che è da quando aspetta.
          //
          // Le prenotazioni future restano fuori: la sezione dice «scaduti o
          // da gestire oggi», e riempirla di appuntamenti di giovedì
          // significherebbe far sembrare la giornata più piena di com'è.
          .or(`data_scelta.lte.${oggi},data_scelta.is.null`)
    ),
  ])

  const righeTask = new Map<string, Record<string, any>>()
  for (const riga of righe ?? []) {
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

  // I dati della **gestione semplice** delle richieste dal sito: la nota
  // dell'operatore e le firme.
  //
  // Non stanno in VoceAgenda e non ci possono stare: là `note` è il messaggio
  // che ha scritto la persona (vedi voceDaContatto), che è un'altra cosa
  // dalla nota di chi la lavora. Passarle a parte, indicizzate sulla chiave
  // della voce, evita di dare due significati allo stesso campo — che è il
  // modo di mostrare a un operatore il testo del cliente dentro la casella
  // dove deve scrivere lui.
  const gestioni: Record<string, GestioneSemplicePerVoce> = {}
  for (const r of prenotati ?? []) {
    gestioni[`contatto-${r.id}`] = {
      nota: (r.note as string) ?? null,
      gestitoDa: (r.gestito_da as string) ?? null,
      gestitoIl: (r.gestito_il as string) ?? null,
      notaDa: (r.note_da as string) ?? null,
      notaIl: (r.note_il as string) ?? null,
    }
  }

  // La trattativa aperta del contatto di ogni voce, per poterla chiudere da
  // qui: si telefona, la persona dice sì, e in quel minuto si sanno entrambe
  // le cose — com'è andata la telefonata e com'è finita la trattativa.
  //
  // Per persona e non per evento: una persona ha al massimo una trattativa
  // aperta (vedi trova_o_crea_opportunita), e solo le aperte interessano —
  // da qui si chiude, e una già chiusa non ha niente da chiudere.
  const idPersoneVoci = [
    ...new Set(tutte.slice(0, IMPEGNI_IN_ELENCO).map((v) => v.personaId).filter(Boolean)),
  ] as string[]

  const { data: trattativeAperte } = idPersoneVoci.length
    ? await supabase
        .from('opportunita')
        .select('id, persona_id, stato, assegnato_a, motivo_perso, motivo_annullato')
        .in('persona_id', idPersoneVoci)
        .in('stato', ['nuovo', 'in_gestione'])
    : { data: [] as Record<string, any>[] }

  const trattative: Record<string, DatiTrattativa> = {}
  for (const t of trattativeAperte ?? []) {
    trattative[t.persona_id as string] = {
      id: t.id as string,
      stato: t.stato,
      assegnato_a: (t.assegnato_a as string) ?? null,
      motivo_perso: (t.motivo_perso as string) ?? null,
      motivo_annullato: (t.motivo_annullato as string) ?? null,
    }
  }

  return {
    voci: tutte.slice(0, IMPEGNI_IN_ELENCO),
    totaleAperti: tutte.length,
    arretrati,
    gestioni,
    trattative,
  }
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
  //
  // `origine` serve alla targhetta della provenienza: su una trattativa nata
  // al banco è l'unico posto in cui quel fatto è scritto, se poi la richiesta
  // agganciata non c'è (vedi lib/provenienza.ts).
  const { data } = await supabase
    .from('opportunita')
    .select(
      'id, stato, assegnato_a, motivo_perso, motivo_annullato, persona_id, creato_il, origine'
    )
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
  const trattativaIds = scelte.map((t) => t.id as string)

  const [{ data: persone, error: errorePersone }, { data: richieste, error: erroreRichieste }] =
    await Promise.all([
      // Solo le colonne che `persone` ha davvero: `ultima_richiesta` sta sulla
      // vista persone_con_richieste, e chiederla qui faceva fallire la lettura
      // — con l'errore ignorato, ogni trattativa finiva intestata a «Senza
      // nome».
      personaIds.length
        ? supabase.from('persone').select('id, nome, cognome, email, cellulare').in('id', personaIds)
        : Promise.resolve({ data: [] as Record<string, any>[], error: null }),
      // L'evento che ha aperto la trattativa, con tutto quello che serve a
      // **chiuderlo da qui**: era il passaggio che costava una pagina — si
      // leggeva la trattativa in dashboard e si andava in Club e Family per
      // segnare la telefonata fatta.
      //
      // Agganciate per `opportunita_id`, non per persona: è il collegamento
      // che il trigger scrive (vedi collega_persona_a_contatto), e legarle
      // alla persona vorrebbe dire mostrare su una trattativa nuova la
      // richiesta di una chiusa l'anno prima.
      trattativaIds.length
        ? conColonneNuove<Record<string, any>>(
            'id, created_at, opportunita_id, origine, azione, data_scelta, ora_scelta, attivita_label, messaggio, gestito, gestito_da, gestito_il, assegnato_a, note, note_da, note_il, esito_tipo, esito, esito_da, esito_il',
            COLONNE_ASSEGNAZIONE_RICHIESTA,
            (colonne) =>
              supabase
                .from('form_contatti')
                .select(colonne)
                .in('opportunita_id', trattativaIds)
                // Crescente: scrivendo nella mappa vince l'ultima letta, cioè
                // la più recente — quella che si sta per lavorare.
                .order('created_at', { ascending: true })
          )
        : Promise.resolve({ data: [] as Record<string, any>[], error: null }),
    ])

  // Un errore qui non svuota la pagina — le trattative si vedono comunque —
  // ma senza i nomi non si capisce di chi siano: va detto nei log invece di
  // lasciare un elenco di «Senza nome» che sembra un problema dei dati.
  if (errorePersone) {
    console.error('Nomi delle trattative non letti:', errorePersone.message)
  }
  // Senza le richieste le righe restano lavorabili — nome, stato, presa in
  // carico — ma perdono provenienza, tipo di evento e pannello di chiusura:
  // un elenco che sembra impoverito senza motivo, se non lo si scrive.
  if (erroreRichieste) {
    console.error('Eventi d’origine delle trattative non letti:', erroreRichieste.message)
  }

  const perId = new Map((persone ?? []).map((p) => [p.id as string, p]))

  // L'ultima richiesta di ogni trattativa, e quante ne ha in tutto: più di
  // una vuol dire che è un ritorno, e presentarsi come al primo contatto a
  // chi ha già scritto tre volte è il modo di perderlo.
  const eventoPerTrattativa = new Map<string, EventoDOrigine>()
  const quantePerTrattativa = new Map<string, number>()
  for (const r of richieste ?? []) {
    const idTrattativa = r.opportunita_id as string
    quantePerTrattativa.set(idTrattativa, (quantePerTrattativa.get(idTrattativa) ?? 0) + 1)
    const tipo = tipoDaAzione(r.azione as string | null)
    eventoPerTrattativa.set(idTrattativa, {
      richiestaId: r.id as string,
      tipo,
      // Solo lo slot prenotato dal sito, non il giorno d'arrivo: una data
      // accanto a «Messaggio» si legge come un appuntamento che non esiste.
      data: r.data_scelta ? String(r.data_scelta).slice(0, 10) : null,
      ora: normalizzaOra(r.ora_scelta as string | null),
      durataMinuti: DURATA_PREDEFINITA[tipo],
      attivita: (r.attivita_label as string) ?? null,
      messaggio: (r.messaggio as string) ?? null,
      // Riempito dopo il giro: il conto si sa solo a elenco finito.
      quante: 1,
      origine: (r.origine as string) ?? null,
      gestito: !!r.gestito,
      gestitoDa: (r.gestito_da as string) ?? null,
      gestitoIl: (r.gestito_il as string) ?? null,
      // Di chi è il lavoro, distinto da chi l'ha chiuso (`esitoDa` /
      // `gestitoDa`): un appuntamento in carico a Carola può essere stato
      // tenuto da Marco, perché quel giorno al banco c'era lui.
      assegnatoA: (r.assegnato_a as string) ?? null,
      nota: (r.note as string) ?? null,
      notaDa: (r.note_da as string) ?? null,
      notaIl: (r.note_il as string) ?? null,
      esitoTipo: eEsitoValido(r.esito_tipo as string | null) ? r.esito_tipo : null,
      esito: (r.esito as string) ?? null,
      esitoDa: (r.esito_da as string) ?? null,
      esitoIl: (r.esito_il as string) ?? null,
    })
  }
  for (const [idTrattativa, evento] of eventoPerTrattativa) {
    evento.quante = quantePerTrattativa.get(idTrattativa) ?? 1
  }

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
      origine: (t.origine as string) ?? null,
      nome: (p?.nome as string) ?? null,
      cognome: (p?.cognome as string) ?? null,
      email: (p?.email as string) ?? null,
      cellulare: (p?.cellulare as string) ?? null,
      // Null sulle trattative nate da un evento in agenda: là non c'è nessuna
      // richiesta dietro, e quegli eventi si lavorano nella seconda sezione.
      evento: eventoPerTrattativa.get(t.id as string) ?? null,
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
      vedeAgenda ? impegniDelGiorno() : Promise.resolve(null),
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

  // Quante cose chiedono qualcosa **adesso**, una per sezione: è il numero
  // accanto al titolo, perché aprendo la pagina la prima domanda è «quante ne
  // ho da fare», non «quante ce ne sono in tutto».
  const libereDaPrendere = trattative?.libere ?? 0
  const eventiDaFare = impegni?.totaleAperti ?? 0

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">CRM Ronchiverdi</p>
        <h1>{nomeUtente ? `Ciao ${nomeUtente.split(' ')[0]}` : 'Dashboard'}</h1>
        <p className="muted">
          Cosa c&apos;è da prendere in carico e cosa scade oggi. Si lavora da qui, senza cambiare
          pagina.
        </p>
      </div>

      {/* La legenda: le sezioni di questa pagina hanno perimetri diversi —
          le trattative sono **tue**, gli eventi sono di **tutti** — e quella
          differenza non si vede guardando. */}
      <GuidaDashboard />

      {/* ─────────────────────────────────────────────────────────────────
          1. Le trattative che non ha in mano nessuno.

          Prima erano il terzo blocco di una sezione intitolata «Le tue
          trattative», sotto quattro riquadri di numeri: la cosa più urgente
          della pagina — una trattativa che nessuno segue è la sola che
          rischia di non essere chiamata da nessuno — stava dove si arriva
          scorrendo. Ora è la prima sezione, e ha un titolo che dice il
          gesto invece dell'insieme.
          ───────────────────────────────────────────────────────────────── */}
      {mieTrattative && (
        <section className="riepilogo-sezione">
          <div className="riepilogo-testa">
            <h2 className="riepilogo-titolo">Trattative da prendere in carico</h2>
            <p className="riepilogo-sottotitolo muted">Eventi Core</p>
            {libereDaPrendere > 0 ? (
              <span className="badge badge-warn badge-punto">
                {libereDaPrendere} {libereDaPrendere === 1 ? 'libera' : 'libere'}
              </span>
            ) : (
              <span className="badge badge-punto">nessuna</span>
            )}
          </div>

          {mieTrattative.libere.length > 0 ? (
            <div className="card card-azione">
              {/* Prendere in carico richiede il diritto commerciale: senza,
                  l'elenco si vede — è lavoro del club, non un segreto — ma i
                  comandi non compaiono (vedi puoAssegnare in
                  lib/pipeline.ts). */}
              <TrattativeDashboard
                trattative={mieTrattative.libere}
                io={email}
                sonoCommerciale={sonoCommerciale}
                possoRiassegnare={possoRiassegnare}
                commerciali={commerciali}
                operatori={operatori}
                puoCancellare={possoCancellare}
                nomiStaff={nomiStaff}
              />
              {mieTrattative.libereTotale > mieTrattative.libere.length && (
                <Link
                  className="btn btn-ghost btn-sm card-coda"
                  href="/dashboard/richieste/richieste-club?stato=nuovo"
                >
                  Vedi tutte quelle libere ({mieTrattative.libereTotale})
                </Link>
              )}
            </div>
          ) : (
            <div className="card">
              {/* Un elenco vuoto centrato in grigio si legge come un errore:
                  qui è una buona notizia, e va detto come tale. */}
              <div className="vuoto-buono">
                <span className="vuoto-glifo" aria-hidden="true">
                  ✓
                </span>
                <p className="vuoto-titolo">Nessuna trattativa libera</p>
                <p className="vuoto-nota">Sono tutte in mano a qualcuno.</p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────
          2. Gli eventi che scadono oggi, e quelli che sono già scaduti.

          Il titolo dice arretrati **e** oggi perché l'elenco è quello: una
          sezione intitolata «Impegni di oggi» che contiene tre voci di
          martedì scorso fa credere che il pannello sbagli le date, e
          l'arretrato è proprio la parte che non deve passare inosservata.
          ───────────────────────────────────────────────────────────────── */}
      {impegni && (
        <section className="riepilogo-sezione">
          <div className="riepilogo-testa">
            <h2 className="riepilogo-titolo">Eventi scaduti o da gestire oggi</h2>
            <p className="riepilogo-sottotitolo muted">
              Di tutto il club: ogni riga dice a chi è in carico
            </p>
            {/* Gli arretrati staccati dal totale: «12 voci aperte» non dice
                che tre sono di ieri, ed è quello che conta. */}
            {impegni.arretrati > 0 ? (
              <span className="badge badge-ko badge-punto">
                {impegni.arretrati} {impegni.arretrati === 1 ? 'arretrato' : 'arretrati'}
              </span>
            ) : eventiDaFare > 0 ? (
              <span className="badge badge-punto">{eventiDaFare} da fare</span>
            ) : (
              <span className="badge badge-punto">nessuno</span>
            )}
          </div>

          {impegni.voci.length > 0 ? (
            <div className={`card${impegni.arretrati > 0 ? ' card-azione' : ''}`}>
              {/* La legenda dei colori: la banda rossa e quella blu vanno
                  capite al primo sguardo, e una riga qui costa meno di un
                  badge per riga. */}
              <p className="card-nota muted">
                Sono gli eventi di <strong>tutti</strong>: guarda il tag di chi ce l&apos;ha in
                carico prima di lavorare una riga. Banda rossa: arretrato. Banda blu: è di oggi.
                Apri una riga per chiamare, chiudere con l&apos;esito o spostarla.
              </p>

              <EventiElenco
                voci={impegni.voci}
                gestioni={impegni.gestioni}
                trattative={impegni.trattative}
                oggi={oggi}
                io={email}
                operatori={operatori}
                puoCancellare={possoCancellare}
                sonoCommerciale={sonoCommerciale}
                possoRiassegnare={possoRiassegnare}
                nomiStaff={nomiStaff}
              />

              {/* Il link porta all'agenda già filtrata sulle proprie: è la
                  continuazione di questo elenco, non un'altra pagina da
                  ri-filtrare a mano. */}
              <Link
                className="btn btn-ghost btn-sm card-coda"
                href="/dashboard/agenda?vista=lista&solo=mie"
              >
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
                  Niente di arretrato e niente per oggi.{' '}
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

      {/* ─────────────────────────────────────────────────────────────────
          3. Il proprio portafoglio: quelle che segui tu, e i numeri.

          Sta dopo le due code di lavoro e non prima: i riquadri sono una
          fotografia — si guardano — mentre sopra c'è roba da fare. Aprendo
          la pagina la prima cosa sotto gli occhi deve essere quella che
          chiede qualcosa.
          ───────────────────────────────────────────────────────────────── */}
      {trattative && (
        <section className="riepilogo-sezione">
          <div className="riepilogo-testa">
            <h2 className="riepilogo-titolo">Le trattative che segui tu</h2>
            <p className="riepilogo-sottotitolo muted">Il tuo lavoro in corso, e come va</p>
            {trattative.mie.in_gestione > 0 && (
              <span className="badge badge-info badge-punto">
                {trattative.mie.in_gestione} in gestione
              </span>
            )}
          </div>

          {mieTrattative && mieTrattative.mie.length > 0 && (
            <div className="card">
              <TrattativeDashboard
                trattative={mieTrattative.mie}
                io={email}
                sonoCommerciale={sonoCommerciale}
                possoRiassegnare={possoRiassegnare}
                commerciali={commerciali}
                operatori={operatori}
                puoCancellare={possoCancellare}
                nomiStaff={nomiStaff}
              />
              {mieTrattative.mieTotale > mieTrattative.mie.length && (
                <Link
                  className="btn btn-ghost btn-sm card-coda"
                  href="/dashboard/richieste/richieste-club?mostra=tutte&mie=1"
                >
                  Vedi tutte le tue ({mieTrattative.mieTotale})
                </Link>
              )}
            </div>
          )}

          {mieTrattative && mieTrattative.mie.length === 0 && (
            <div className="card">
              <div className="vuoto-buono">
                <span className="vuoto-glifo" aria-hidden="true">
                  ✓
                </span>
                <p className="vuoto-titolo">Non ne hai nessuna in mano</p>
                <p className="vuoto-nota">Le tue chiuse restano nei numeri qui sotto.</p>
              </div>
            </div>
          )}

          <div className="griglia-stat griglia-stat-coda">
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
                  <span className="stat-nota">{valore === 0 ? '—' : nota}</span>
                </Link>
              )
            })}
          </div>

          {/* Gli stessi quattro numeri, ma di tutto il club: serve a sapere se
              sei tu a essere carico o è carico il club. In fila con il
              pallino del proprio stato, gli stessi colori dei riquadri qui
              sopra e delle righe qui sotto. */}
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
              Apri Eventi Core →
            </Link>
          </div>
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
