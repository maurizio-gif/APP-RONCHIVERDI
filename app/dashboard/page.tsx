import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getNomeUtente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { eCommerciale, puoAmministrare, puoCancellare, puoRiassegnare } from '@/lib/auth/permessi'
import { SEZIONI, soloAccessoEsterno } from '@/lib/auth/sezioni'
import { ATTIVITA_IN_AGENDA, COLONNE_RICHIESTA, canaleDiRichiesta } from '@/lib/richieste'
import {
  STATI,
  eChiusa,
  type StatoTrattativa,
} from '@/lib/pipeline'
import {
  DURATA_PREDEFINITA,
  eEsitoValido,
  giornoPiu,
  normalizzaOra,
  oggiRoma,
  ordinaVoci,
  tipoDaAzione,
  voceDaContatto,
  voceDaTask,
  type VoceAgenda,
} from '@/lib/agenda'
import { contattiDelleVoci } from '@/lib/eventi-server'
import { nomePersona } from '@/lib/persone'
import { mappaNomiStaff, ordinaPerCognome, type RigaStaff } from '@/lib/staff'
import { COLONNE_ASSEGNAZIONE_RICHIESTA, COLONNE_NOTA_VINTA, conColonneNuove } from '@/lib/migrazioni'
import { AzioniVeloci } from './AzioniVeloci'
import type { EventoCollegato } from './richieste/EventiTrattativa'
import type { Richiesta } from './richieste/RigaRichiesta'
import type { DatiTrattativa } from './richieste/Trattativa'
import type { EventoDOrigine, TrattativaConPersona } from './TrattativeDashboard'
import { ElencoLead } from './ElencoLead'

export const dynamic = 'force-dynamic'

/** Quanti impegni mostrare in elenco prima di rimandare all'agenda. */
const IMPEGNI_IN_ELENCO = 12

/** Quante trattative elencare per blocco prima di rimandare alla sezione. */
const TRATTATIVE_IN_ELENCO = 12

/** Le schede dei lead, sul modello di Passion: un elenco solo, filtrato. */
const VISTE_LEAD = [
  { chiave: 'libere', testo: 'Da prendere in carico' },
  { chiave: 'mie', testo: 'Assegnate a te' },
  { chiave: 'in_gestione', testo: 'In gestione' },
  { chiave: 'vinte', testo: 'Vinte' },
  { chiave: 'perse', testo: 'Perse' },
] as const
type VistaLead = (typeof VISTE_LEAD)[number]['chiave']

/** Le schede delle azioni (gli eventi d'agenda): quando, e di chi. */
const QUANDO_TASK = [
  { chiave: 'arretrati', testo: 'Arretrati' },
  { chiave: 'oggi', testo: 'Oggi' },
  { chiave: 'prossimi', testo: 'Prossimi 14 giorni' },
] as const
type QuandoTask = (typeof QUANDO_TASK)[number]['chiave']
type ChiTask = 'tutti' | 'miei'
const GIORNI_PROSSIMI = 14

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
  // sarebbero otto round trip per una tabella che sta in una pagina. Senza
  // filtro (l'intera opportunita) va paginata con .range(): PostgREST
  // tronca comunque una select a 1000 righe, e la tabella le ha già
  // superate — vedi il bug del resoconto serale (lib/report-direzionale.ts).
  const righe: { stato: string; assegnato_a: string | null }[] = []
  for (let da = 0; ; da += 1000) {
    const { data } = await supabase.from('opportunita').select('stato, assegnato_a').range(da, da + 999)
    righe.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }

  const vuoto = () => Object.fromEntries(STATI.map((x) => [x, 0])) as Record<StatoTrattativa, number>
  const mie = vuoto()
  const club = vuoto()
  // «Da prendere in carico» sono quelle di nessuno, non quelle in stato
  // `nuovo`: chiunque abbia il diritto commerciale può prendersele, quindi
  // per chi guarda sono lavoro disponibile, non lavoro di altri.
  let libere = 0

  for (const riga of righe) {
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
async function impegniDelGiorno(email: string | null, quando: QuandoTask, chi: ChiTask) {
  const supabase = createSupabaseServiceClient()
  const oggi = oggiRoma()
  // «Prossimi» guarda due settimane avanti: oltre, è agenda e non lavoro.
  const fino = giornoPiu(oggi, GIORNI_PROSSIMI)

  const COLONNE_TASK =
    'id, titolo, tipo, data, ora, durata_minuti, stato, note, assegnato_a, esito_tipo, esito, esito_da, esito_il, entita, entita_id'

  const [{ data: righe }, { data: prenotati }] = await Promise.all([
    supabase
      .from('task')
      .select(COLONNE_TASK)
      .eq('stato', 'aperto')
      // `lte` e non `eq`: un impegno di martedì rimasto aperto è esattamente
      // quello che non deve sparire per il fatto di essere passato.
      .lte('data', fino),
    // Le richieste del settore core ancora da gestire: sono voci d'agenda per
    // conto loro (vedi voceDaContatto).
    //
    // `assegnato_a` è quello della trattativa, scritto dal trigger
    // assegna_eventi_della_trattativa — prendere in carico la trattativa vuol
    // dire prendersi anche il suo appuntamento, e passarla a un collega vuol
    // dire passargli anche quelli ancora da fare.
    //
    // Scritta e non derivata da `opportunita.assegnato_a` proprio per il caso
    // che la derivazione perderebbe: una riga **chiusa** deve continuare a
    // dire a chi era quando andava fatta, anche se la trattativa è passata di
    // mano tre volte da allora. Il trigger infatti non tocca le chiuse.
    // Le stesse colonne di Eventi Core (vedi COLONNE_RICHIESTA): l'elenco qui
    // apre lo stesso pannello, e un pannello a cui manca metà dei campi
    // mostrerebbe le stesse etichette con dentro dei vuoti.
    conColonneNuove<Record<string, any>>(
      COLONNE_RICHIESTA,
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
          .or(`data_scelta.lte.${fino},data_scelta.is.null`)
    ),
  ])

  const righeTask = new Map<string, Record<string, any>>()
  for (const riga of righe ?? []) {
    righeTask.set(riga.id as string, riga)
  }

  // I contatti agganciati: `task.entita_id` è un id, e un impegno senza il
  // nome di chi riguarda è metà informazione. Col contatto arrivano anche i
  // recapiti dell'espansione e il pulsante per la sua scheda.
  //
  // I due agganci, non solo il diretto: un richiamo programmato chiudendo una
  // richiesta è agganciato alla **richiesta**, e risolvere solo `persona`
  // lasciava quelle voci senza nome, senza recapiti e senza scheda — vedi
  // contattiDelleVoci.
  const contattiDiVoce = await contattiDelleVoci([...righeTask.values()])

  const voci: VoceAgenda[] = [
    ...[...righeTask.values()].map((riga) =>
      voceDaTask(riga, contattiDiVoce.get(String(riga.id)))
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
  // Gli appuntamenti annullati non sono lavoro: fuori, come in agenda.
  const valide = tutte.filter((v) => v.stato !== 'annullato')
  const diChi = chi === 'miei' ? valide.filter((v) => v.assegnatoA === email) : valide
  const conti: Record<QuandoTask, number> = {
    arretrati: diChi.filter((v) => v.data < oggi).length,
    oggi: diChi.filter((v) => v.data === oggi).length,
    prossimi: diChi.filter((v) => v.data > oggi).length,
  }
  const arretrati = conti.arretrati
  const scelte = diChi.filter((v) =>
    quando === 'arretrati' ? v.data < oggi : quando === 'oggi' ? v.data === oggi : v.data > oggi
  )

  // I dati della **gestione semplice** delle richieste dal sito: la nota
  // dell'operatore e le firme.
  //
  // Non stanno in VoceAgenda e non ci possono stare: là `note` è il messaggio
  // che ha scritto la persona (vedi voceDaContatto), che è un'altra cosa
  // dalla nota di chi la lavora. Passarle a parte, indicizzate sulla chiave
  // della voce, evita di dare due significati allo stesso campo — che è il
  // modo di mostrare a un operatore il testo del cliente dentro la casella
  // dove deve scrivere lui.
  return {
    voci: scelte.slice(0, IMPEGNI_IN_ELENCO),
    totaleScelte: scelte.length,
    conti,
    arretrati,
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
async function trattativeDaLavorare(email: string | null, vista: VistaLead) {
  const supabase = createSupabaseServiceClient()

  // Solo le aperte: una vinta o persa non è lavoro, è storia — si consulta
  // dalla sezione, filtrando per stato.
  //
  // `origine` serve alla targhetta della provenienza: su una trattativa nata
  // al banco è l'unico posto in cui quel fatto è scritto, se poi la richiesta
  // agganciata non c'è (vedi lib/provenienza.ts).
  let query = supabase
    .from('opportunita')
    .select(
      'id, stato, assegnato_a, motivo_perso, motivo_annullato, persona_id, creato_il, origine'
    )
  if (vista === 'libere') query = query.in('stato', ['nuovo', 'in_gestione']).is('assegnato_a', null)
  else if (vista === 'mie') query = query.in('stato', ['nuovo', 'in_gestione']).eq('assegnato_a', email ?? '')
  else if (vista === 'in_gestione') query = query.eq('stato', 'in_gestione')
  else if (vista === 'vinte') query = query.eq('stato', 'vinto')
  else if (vista === 'perse') query = query.eq('stato', 'perso')
  const { data } = await query
    .order(vista === 'vinte' || vista === 'perse' ? 'chiuso_il' : 'creato_il', { ascending: false })
    .limit(TRATTATIVE_IN_ELENCO)

  const scelte = data ?? []
  const personaIds = [...new Set(scelte.map((t) => t.persona_id).filter(Boolean))] as string[]
  const trattativaIds = scelte.map((t) => t.id as string)

  const [
    { data: persone, error: errorePersone },
    { data: richieste, error: erroreRichieste },
    { data: tourInSede },
  ] = await Promise.all([
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
      // Il tour in sede che il guest register crea da solo per chi si
      // registra senza prenotare un orario (vedi api/lead.ts sul sito): la
      // richiesta che ha aperto la trattativa resta un «messaggio» — è
      // proprio così che è arrivata — ma la tile non deve farla sembrare
      // priva di un appuntamento quando quell'appuntamento esiste già,
      // creato in automatico.
      personaIds.length
        ? supabase
            .from('task')
            .select('entita_id, data, ora, stato')
            .eq('entita', 'persona')
            .in('entita_id', personaIds)
            .eq('tipo', 'appuntamento_in_sede')
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

  // Un tour per persona: se ce n'è più di uno (un altro giorno, un'altra
  // registrazione) vince quello ancora aperto, che è il lavoro vero — un
  // tour già fatto non direbbe niente su cosa fare adesso.
  const tourInSedePerPersona = new Map<string, { data: string; ora: string | null }>()
  for (const t of tourInSede ?? []) {
    const personaId = t.entita_id as string
    const gia = tourInSedePerPersona.get(personaId)
    if (gia && t.stato !== 'aperto') continue
    tourInSedePerPersona.set(personaId, {
      data: String(t.data).slice(0, 10),
      ora: normalizzaOra(t.ora as string | null),
    })
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
      // Il tour in sede creato in automatico dal guest register, quando la
      // registrazione era senza orario scelto: la tile lo dice, anche se
      // l'evento che ha aperto la trattativa resta un «messaggio».
      tourInSede: (t.persona_id && tourInSedePerPersona.get(t.persona_id as string)) || null,
    }
  }

  return scelte.map(conPersona)
}

type Parametri = { lead?: string; quando?: string; chi?: string; q?: string }

/**
 * I contatti che corrispondono alla ricerca: nome e cognome (anche insieme,
 * in qualsiasi ordine), email o cellulare.
 */
async function cercaContatti(testo: string) {
  const parole = testo
    .toLowerCase()
    .replace(/[%,()*]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (parole.length === 0) return []
  const cifre = testo.replace(/\D/g, '')
  const perTelefono = cifre.length >= 3 && cifre.length === testo.replace(/[\s+]/g, '').length
  // Ogni parola deve stare in nome, cognome o email: un .or() per parola, in AND.
  let query = createSupabaseServiceClient().from('persone').select('id, nome, cognome, email, cellulare')
  if (perTelefono) query = query.ilike('cellulare', `%${cifre.slice(-9)}%`)
  else
    for (const w of parole.slice(0, 4))
      query = query.or(`nome.ilike.%${w}%,cognome.ilike.%${w}%,email.ilike.%${w}%`)
  const { data } = await query.limit(100)
  return (data ?? []).slice(0, 20)
}

export default async function RiepilogoPage({ searchParams }: { searchParams: Parametri }) {
  const email = emailCorrente()

  const [sezioniConsentite, amministra, sonoCommerciale, possoRiassegnare, possoCancellare] =
    await Promise.all([
      getSezioniConsentite(email),
      puoAmministrare(email),
      eCommerciale(email),
      puoRiassegnare(email),
      puoCancellare(email),
    ])

  // Un account di un partner esterno non vede il Riepilogo: lo si manda sulla
  // sua pagina. Il controllo sta qui e non solo nel menu: /dashboard resta un
  // indirizzo digitabile.
  if (soloAccessoEsterno(sezioniConsentite)) {
    const suaSezione = SEZIONI.find((s) => sezioniConsentite.includes(s.chiave))
    if (suaSezione) redirect(suaSezione.href)
  }

  const vedeTrattative = sezioniConsentite.includes('richieste-club')
  const vedeAgenda = sezioniConsentite.includes('agenda')

  const quando: QuandoTask = QUANDO_TASK.some((v) => v.chiave === searchParams.quando)
    ? (searchParams.quando as QuandoTask)
    : 'oggi'
  const chi: ChiTask = searchParams.chi === 'miei' ? 'miei' : 'tutti'
  const cerca = (searchParams.q ?? '').trim().slice(0, 80)
  const trovati = cerca ? await cercaContatti(cerca) : null

  // I conti servono prima dell'elenco: senza una scheda scelta si apre su
  // quelle da prendere, se ce ne sono, altrimenti sulle proprie.
  const trattative = vedeTrattative ? await contatoriTrattative(email) : null
  const vistaLead: VistaLead = VISTE_LEAD.some((v) => v.chiave === searchParams.lead)
    ? (searchParams.lead as VistaLead)
    : trattative && trattative.libere === 0
      ? 'mie'
      : 'libere'

  const [nomeUtente, lead, impegni, nonInstradate, { data: staff }] = await Promise.all([
    getNomeUtente(email),
    vedeTrattative ? trattativeDaLavorare(email, vistaLead) : Promise.resolve(null),
    vedeAgenda ? impegniDelGiorno(email, quando, chi) : Promise.resolve(null),
    amministra
      ? richiesteNonInstradate()
      : Promise.resolve({ totale: 0, motivi: [] as [string, number][] }),
    createSupabaseServiceClient().from('staff_users').select('email, nome, cognome, commerciale'),
  ])

  const staffOrdinato = ordinaPerCognome((staff ?? []) as (RigaStaff & { commerciale?: boolean })[])
  const operatori = staffOrdinato.map((x) => x.email)
  const commerciali = staffOrdinato.filter((x) => x.commerciale).map((x) => x.email)
  const nomiStaff = mappaNomiStaff(staffOrdinato)
  const oggi = oggiRoma()
  const inArrivo = SEZIONI.filter((s) => s.inArrivo && sezioniConsentite.includes(s.chiave))

  const contiLead: Record<VistaLead, number> | null = trattative && {
    libere: trattative.libere,
    mie: trattative.mie.nuovo + trattative.mie.in_gestione,
    in_gestione: trattative.club.in_gestione,
    vinte: trattative.club.vinto,
    perse: trattative.club.perso,
  }

  // I link delle schede tengono la scelta dell'altra sezione.
  const link = (p: Parametri) => {
    const q = new URLSearchParams()
    const tutti = { lead: vistaLead, quando, chi, ...p }
    if (tutti.lead) q.set('lead', tutti.lead)
    if (tutti.quando) q.set('quando', tutti.quando)
    if (tutti.chi === 'miei') q.set('chi', 'miei')
    return `/dashboard?${q.toString()}`
  }

  const filtroLead: Record<VistaLead, string> = {
    libere: 'stato=nuovo',
    mie: 'mostra=tutte&mie=1',
    in_gestione: 'stato=in_gestione',
    vinte: 'stato=vinto',
    perse: 'stato=perso',
  }

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">CRM Ronchiverdi</p>
        <h1>{nomeUtente ? `Ciao ${nomeUtente.split(' ')[0]}` : 'Dashboard'}</h1>
      </div>

      <form className="agenda-cerca" action="/dashboard">
        <input
          type="search"
          name="q"
          defaultValue={cerca}
          placeholder="Cerca un contatto: nome e cognome, email o cellulare"
        />
        <button className="btn btn-ghost btn-sm" type="submit">
          Cerca
        </button>
        {cerca && (
          <Link className="link" href="/dashboard">
            Chiudi
          </Link>
        )}
      </form>

      {trovati && (
        <section className="riepilogo-sezione">
          <div className="card">
            {trovati.length === 0 ? (
              <p className="muted">Nessun contatto per «{cerca}».</p>
            ) : (
              <ul className="lead-elenco">
                {trovati.map((p) => (
                  <li key={p.id as string} className="lead-riga">
                    <div className="lead-testo">
                      <div className="azione-titolo">
                        <span className="azione-nome">{nomePersona(p) || 'Senza nome'}</span>
                        {p.cellulare && (
                          <a className="azione-tel" href={`tel:${p.cellulare}`}>
                            {p.cellulare}
                          </a>
                        )}
                        {p.email && <span className="muted azione-chi">{p.email as string}</span>}
                      </div>
                    </div>
                    <Link className="btn btn-ghost btn-sm" href={`/dashboard/persone/${p.id}`} target="_blank">
                      Apri scheda ↗
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {lead && contiLead && (
        <section className="riepilogo-sezione">
          <div className="riepilogo-testa">
            <h2 className="riepilogo-titolo">Lead</h2>
            {contiLead.libere > 0 && (
              <span className="badge badge-warn badge-punto">
                {contiLead.libere} da prendere in carico
              </span>
            )}
          </div>

          <div className="filtro-gruppo">
            {VISTE_LEAD.map((v) => (
              <Scheda
                key={v.chiave}
                href={link({ lead: v.chiave })}
                attiva={v.chiave === vistaLead}
                quante={contiLead[v.chiave]}
              >
                {v.testo}
              </Scheda>
            ))}
          </div>

          <div className="card">
            {lead.length > 0 ? (
              <ElencoLead
                lead={lead}
                io={email}
                commerciali={commerciali}
                nomiStaff={nomiStaff}
                sonoCommerciale={sonoCommerciale}
                possoRiassegnare={possoRiassegnare}
              />
            ) : (
              <p className="muted">Nessun lead qui.</p>
            )}
            {contiLead[vistaLead] > lead.length && (
              <Link
                className="btn btn-ghost btn-sm card-coda"
                href={`/dashboard/richieste/richieste-club?${filtroLead[vistaLead]}`}
              >
                Vedi tutti ({contiLead[vistaLead]})
              </Link>
            )}
          </div>
        </section>
      )}

      {impegni && (
        <section className="riepilogo-sezione">
          <div className="riepilogo-testa">
            <h2 className="riepilogo-titolo">Azioni</h2>
            {impegni.arretrati > 0 && (
              <span className="badge badge-ko badge-punto">
                {impegni.arretrati} {impegni.arretrati === 1 ? 'arretrato' : 'arretrati'}
              </span>
            )}
          </div>

          <div className="filtro-gruppo">
            {QUANDO_TASK.map((v) => (
              <Scheda
                key={v.chiave}
                href={link({ quando: v.chiave })}
                attiva={v.chiave === quando}
                quante={impegni.conti[v.chiave]}
              >
                {v.testo}
              </Scheda>
            ))}
            <span className="filtro-separatore" aria-hidden="true" />
            <Scheda href={link({ chi: 'tutti' })} attiva={chi === 'tutti'}>
              Di tutti
            </Scheda>
            <Scheda href={link({ chi: 'miei' })} attiva={chi === 'miei'}>
              Le mie
            </Scheda>
          </div>

          <div className="card">
            {impegni.voci.length > 0 ? (
              <AzioniVeloci
                voci={impegni.voci}
                oggi={oggi}
                nomiStaff={nomiStaff}
                mostraChi={chi === 'tutti'}
              />
            ) : (
              <p className="muted">Nessuna azione qui.</p>
            )}
            <Link
              className="btn btn-ghost btn-sm card-coda"
              href={`/dashboard/agenda?quando=${quando}${chi === 'miei' ? '&chi=mie' : ''}`}
            >
              {impegni.totaleScelte > impegni.voci.length
                ? `Vedi tutti in agenda (${impegni.totaleScelte})`
                : 'Apri l’agenda'}
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

/** Una scheda di filtro: lo stesso chip dell'agenda, con il conto se c'è. */
function Scheda({
  href,
  attiva,
  quante,
  children,
}: {
  href: string
  attiva: boolean
  quante?: number
  children: React.ReactNode
}) {
  return (
    <Link
      className={`chip${attiva ? ' is-attivo' : ''}${quante === 0 ? ' is-zero' : ''}`}
      aria-current={attiva ? 'true' : undefined}
      href={href}
      scroll={false}
    >
      {attiva && (
        <span className="chip-spunta" aria-hidden="true">
          ✓
        </span>
      )}
      {children}
      {quante != null && <span className="chip-conteggio">{quante}</span>}
    </Link>
  )
}
