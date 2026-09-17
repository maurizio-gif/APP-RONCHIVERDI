import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { ATTIVITA_IN_AGENDA, COLONNE_RICHIESTA } from '@/lib/richieste'
import { euro, type StatoTrattativa } from '@/lib/pipeline'
import { provenienzaDiOrigine, type ChiaveProvenienza } from '@/lib/provenienza'
import {
  CLASSE_TIPO,
  ETICHETTE_TIPO_BREVI,
  TIPI,
  dataBreve,
  eTipoValido,
  giornoPiu,
  oggiRoma,
  ordinaVoci,
  primoDelMese,
  tipoDaAzione,
  voceDaContatto,
  voceDaTask,
  type TipoVoce,
  type VoceAgenda,
} from '@/lib/agenda'
import { contattiDelleVoci } from '@/lib/eventi-server'
import { durataLavorativa, msLavorativi } from '@/lib/orarioLavorativo'
import { mappaNomiStaff, nomeDiEmail, ordinaPerCognome, type RigaStaff } from '@/lib/staff'
import {
  COLONNE_ASSEGNAZIONE_RICHIESTA,
  COLONNE_NOTA_VINTA,
  conColonneNuove,
} from '@/lib/migrazioni'
import { IconaNuovaScheda } from '@/components/IconaNuovaScheda'

export const dynamic = 'force-dynamic'

// Core Manager: il lavoro del settore core visto dalla responsabile.
//
// Non è un secondo Riepilogo. Il Riepilogo risponde a «cosa devo fare io»; qui
// la domanda è **«come è distribuito il lavoro fra le persone»**, ed è una
// domanda che nessuna pagina del pannello poteva rispondere: le trattative si
// vedevano una per una, gli eventi per giornata, e per sapere se una collega
// aveva in mano il triplo delle altre bisognava contare a mano.
//
// Quattro numeri, e sono quattro squilibri diversi:
//
//   1. **quante opportunità ha ciascuno adesso** — lo squilibrio di carico. È
//      quello che si vede a occhio in fondo al mese, quando una persona non
//      chiude più niente perché ha trenta pratiche aperte;
//   2. **quanto ci mette a prenderle in carico** — lo squilibrio di reattività.
//      Un lead richiamato dopo tre giorni è un lead perso, e la media per
//      persona dice se è un problema di carico o di abitudine;
//   3. **quanti eventi ha assegnati e quanti ne ha eseguiti** — le due
//      colonne separate perché sono due fatti diversi: chi esegue molto più
//      di quanto ha assegnato sta coprendo i turni di qualcun altro, e chi ha
//      assegnato molto più di quanto esegue sta accumulando arretrato;
//   4. **cosa ha chiuso, e per quanto** — il risultato. Senza il valore le
//      vinte si contano e non si pesano, e tre abbonamenti Flex non sono un
//      Club Full.
//
// I numeri sono **per periodo**, tranne le opportunità aperte: quelle sono una
// fotografia di adesso, perché «quante ne hai in mano» non ha un periodo.

/** I periodi offerti. `oggi` è il primo perché è la domanda di fine giornata. */
const PERIODI = [
  { chiave: 'oggi', etichetta: 'Oggi' },
  { chiave: '7', etichetta: 'Ultimi 7 giorni' },
  { chiave: '30', etichetta: 'Ultimi 30 giorni' },
  { chiave: 'mese', etichetta: 'Questo mese' },
] as const

type ChiavePeriodo = (typeof PERIODI)[number]['chiave']

function eiPeriodoValido(v: string | undefined): v is ChiavePeriodo {
  return !!v && PERIODI.some((p) => p.chiave === v)
}

/** Il primo giorno del periodo, compreso. L'ultimo è sempre oggi. */
function inizioDi(periodo: ChiavePeriodo, oggi: string): string {
  if (periodo === 'oggi') return oggi
  if (periodo === 'mese') return primoDelMese(oggi)
  return giornoPiu(oggi, -(Number(periodo) - 1))
}

/** Una riga della tabella: tutto quello che si sa di una persona. */
type RigaConsulente = {
  email: string
  aperte: number
  /**
   * Millisecondi **di apertura** fra l'arrivo del lead e la presa in carico.
   * Non sull'orologio: vedi lib/orarioLavorativo.ts.
   */
  attesePresa: number[]
  /**
   * Millisecondi **di apertura** fra l'arrivo di un messaggio dal sito e la
   * sua chiusura. Solo messaggi, non appuntamenti: vedi il commento sopra
   * `tempoGestioneMessaggio`.
   */
  tempiGestioneMessaggi: number[]
  eventiAssegnati: number
  vinte: number
  valore: number
  perse: number
}

function rigaVuota(email: string): RigaConsulente {
  return {
    email,
    aperte: 0,
    attesePresa: [],
    tempiGestioneMessaggi: [],
    eventiAssegnati: 0,
    vinte: 0,
    valore: 0,
    perse: 0,
  }
}

/** Quanti eventi eseguiti, per tipo — appuntamento, telefonata, task, email, whatsapp, messaggio. */
type ConteggioTipi = Record<TipoVoce, number>

function conteggiTipiVuoti(): ConteggioTipi {
  return {
    appuntamento_in_sede: 0,
    appuntamento_telefonico: 0,
    task: 0,
    email: 0,
    whatsapp: 0,
    messaggio: 0,
  }
}

/**
 * Gli eventi eseguiti da una persona, divisi per come sono nati: quelli che
 * si è scritta da sé (un task agganciato direttamente al contatto, senza
 * nessuna richiesta dietro — vedi ENTITA_COLLEGAMENTO in lib/eventi.ts) e
 * quelli arrivati dal sito o dal banco (una richiesta, o un evento nato per
 * seguirne una). La distinzione conta perché sono due lavori diversi: il
 * primo è iniziativa propria, il secondo è rispondere a chi ha scritto.
 */
type RigaEventiPerTipo = {
  email: string
  autonomi: ConteggioTipi
  daSito: ConteggioTipi
}

function rigaEventiPerTipoVuota(email: string): RigaEventiPerTipo {
  return { email, autonomi: conteggiTipiVuoti(), daSito: conteggiTipiVuoti() }
}

function totaleConteggi(c: ConteggioTipi): number {
  return TIPI.reduce((a, t) => a + c[t], 0)
}

function media(valori: number[]): number | null {
  if (valori.length === 0) return null
  return valori.reduce((a, b) => a + b, 0) / valori.length
}

// ─────────────────────────────────────────── cosa dicono le note

/**
 * Sotto quanti caratteri una nota conta come «scritta di fretta»: «ok»,
 * «fatto», «va bene» ci finiscono dentro, «non risponde» no. Non è un
 * giudizio sulla persona — una nota corta può bastare — ma su tante righe
 * dice se si sta scrivendo per davvero o solo per sbloccare il pulsante.
 */
const SOGLIA_NOTA_BREVE = 10

/**
 * Le parole troppo comuni per dire qualcosa da sole: senza filtrarle, la
 * lista delle parole più frequenti sarebbe "non", "che", "per" — vero di
 * ogni nota scritta in italiano, non di questo mese in particolare.
 */
const PAROLE_VUOTE = new Set([
  'alle','anche','avere','buono','cerca','chiama','chiede','chiesto','coi',
  'colui','come','comunque','cosa','così','detto','deve','devo',
  'dice','dopo','erano','essere','fare','fatto','giorni','grazie','hanno',
  'invece','loro','manca','mancato','mentre','mesi','molto','nessuno',
  'niente','nostro','ogni','oggi','oppure','ottima','ottimo','ovviamente',
  'perché','però','poco','prima','probabilmente','proprio','provato',
  'quando','quanto','quella','quelle','quelli','quello','questa','queste',
  'questi','questo','quindi','risponde','risposto','sarebbe','sembra',
  'sempre','senza','stata','stati','stato','tanto','tempo','tramite',
  'tutti','tutto','vediamo','vengono','viene','volta','volte',
])

/**
 * Le parole significative di un testo: minuscole, senza punteggiatura,
 * abbastanza lunghe da non essere articoli o preposizioni sfuggiti al
 * filtro, e non fra le parole vuote qui sopra.
 */
function paroleSignificative(testo: string): string[] {
  return testo
    .toLowerCase()
    .replace(/[^a-zàáâãäåèéêëìíîïòóôõöùúûüç0-9'\s]/gi, ' ')
    .split(/\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 4 && !PAROLE_VUOTE.has(p))
}

/** Le parole più frequenti in un elenco di testi, con quante volte compaiono. */
function paroleFrequenti(testi: string[], quante: number): { parola: string; volte: number }[] {
  const conteggi = new Map<string, number>()
  for (const testo of testi) {
    for (const parola of paroleSignificative(testo)) {
      conteggi.set(parola, (conteggi.get(parola) ?? 0) + 1)
    }
  }
  return [...conteggi.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, quante)
    .map(([parola, volte]) => ({ parola, volte }))
}

/** Il lunedì della settimana di un giorno, per raggruppare un periodo lungo. */
function inizioSettimana(giorno: string): string {
  const d = new Date(`${giorno}T00:00:00Z`)
  const giornoSettimana = d.getUTCDay()
  const offset = giornoSettimana === 0 ? 6 : giornoSettimana - 1
  return giornoPiu(giorno, -offset)
}

/**
 * Gli eventi scaduti: aperti, di un giorno passato, di chiunque nel settore
 * core. Non è filtrato per periodo — un arretrato di tre settimane fa resta
 * un arretrato oggi — ed è il motivo per cui questa sezione sta separata
 * dalla tabella «Per consulente», che invece segue il periodo scelto.
 *
 * Ogni riga porta il nominativo di chi riguarda e a chi è in carico: è
 * l'unico modo per la responsabile di sapere se un arretrato è di qualcuno
 * che sta affogando o di qualcuno che se l'è dimenticato.
 */
async function eventiScaduti(): Promise<VoceAgenda[]> {
  const supabase = createSupabaseServiceClient()
  const oggi = oggiRoma()

  const [{ data: righeTask }, { data: richieste }] = await Promise.all([
    supabase
      .from('task')
      .select(
        'id, titolo, tipo, data, ora, durata_minuti, stato, note, assegnato_a, entita, entita_id'
      )
      .eq('stato', 'aperto')
      .lt('data', oggi),
    conColonneNuove<Record<string, any>>(
      COLONNE_RICHIESTA,
      COLONNE_ASSEGNAZIONE_RICHIESTA,
      (colonne) =>
        supabase
          .from('form_contatti')
          .select(colonne)
          .in('attivita', ATTIVITA_IN_AGENDA)
          .eq('gestito', false)
          .or(`data_scelta.lt.${oggi},and(data_scelta.is.null,created_at.lt.${oggi})`)
    ),
  ])

  // Il contatto di ogni voce, dai due agganci: l'id di una persona sulle voci
  // scritte in agenda, l'id della richiesta sui seguiti programmati chiudendo
  // una richiesta (vedi contattiDelleVoci). Serve il nominativo in tabella, e
  // serve il link alla sua scheda: da un arretrato la prima cosa che si vuole
  // è sapere chi è.
  const contattiDiVoce = await contattiDelleVoci((righeTask ?? []) as Record<string, any>[])

  const voci: VoceAgenda[] = [
    ...(righeTask ?? []).map((riga) => voceDaTask(riga, contattiDiVoce.get(String(riga.id)))),
    ...(richieste ?? []).map(voceDaContatto).filter((v): v is VoceAgenda => v !== null),
  ]

  const perGiorno = new Map<string, VoceAgenda[]>()
  for (const v of [...voci].sort((a, b) => a.data.localeCompare(b.data))) {
    perGiorno.set(v.data, [...(perGiorno.get(v.data) ?? []), v])
  }
  return [...perGiorno.keys()].flatMap((g) => ordinaVoci(perGiorno.get(g)!))
}

export default async function CoreManagerPage({
  searchParams,
}: {
  searchParams: { periodo?: string }
}) {
  if (!(await utenteHaSezione('core-manager'))) {
    redirect('/dashboard')
  }

  const io = emailCorrente()
  const oggi = oggiRoma()
  // Il mese è il default, non oggi: la tabella «Per consulente» serve a
  // vedere come si distribuisce il lavoro, ed è una domanda che su un solo
  // giorno ha quasi sempre numeri troppo piccoli per dire qualcosa — la
  // reattività dei messaggi in particolare si legge su decine di casi, non
  // su tre o quattro.
  const periodo: ChiavePeriodo = eiPeriodoValido(searchParams.periodo)
    ? searchParams.periodo
    : 'mese'
  const inizio = inizioDi(periodo, oggi)

  // Il confine superiore è il giorno **dopo** oggi: le colonne sono timestamp,
  // e un `lte` sulla data secca taglierebbe via tutto quello che è successo
  // dopo la mezzanotte — cioè l'intera giornata di oggi.
  const dopoFine = giornoPiu(oggi, 1)

  const supabase = createSupabaseServiceClient()
  const [
    { data: opportunita },
    { data: chiuse },
    { data: task },
    { data: richieste },
    { data: staff },
    scaduti,
  ] = await Promise.all([
    // La fotografia di adesso: chi ha in mano quante trattative aperte.
    // Senza periodo, perché «quante ne hai in mano» non ne ha uno.
    supabase
      .from('opportunita')
      .select('assegnato_a, assegnato_il, creato_il, stato, origine')
      .in('stato', ['nuovo', 'in_gestione']),
    // Le chiuse del periodo, col valore. Per `chiuso_il` e non per
    // `creato_il`: il risultato appartiene al giorno in cui si è chiuso, non a
    // quello in cui il lead è arrivato — altrimenti una vinta di oggi su un
    // lead di marzo non comparirebbe da nessuna parte.
    conColonneNuove<Record<string, any>>(
      'assegnato_a, stato, chiuso_il, valore_euro, origine, motivo_perso',
      COLONNE_NOTA_VINTA,
      (colonne) =>
        supabase
          .from('opportunita')
          .select(colonne)
          .in('stato', ['vinto', 'perso'])
          .gte('chiuso_il', inizio)
          .lt('chiuso_il', dopoFine)
    ),
    // Gli eventi d'agenda del periodo, per data: è il giorno in cui l'impegno
    // cade, che è quello che conta per dire «quanti eventi hai avuto».
    supabase
      .from('task')
      .select('assegnato_a, esito_da, stato, data, tipo, entita, esito, esito_tipo')
      .gte('data', inizio)
      .lte('data', oggi),
    // Le richieste del settore core sono eventi anche loro: chi le lavora fa
    // lo stesso lavoro di chi chiude un task, e contare solo i task
    // sottostimerebbe proprio chi sta al banco a smaltire i messaggi.
    conColonneNuove<Record<string, any>>(
      'assegnato_a, esito_da, gestito_da, gestito, gestito_il, created_at, data_scelta, azione, esito, esito_tipo',
      ['assegnato_a'],
      (colonne) =>
        supabase
          .from('form_contatti')
          .select(colonne)
          .in('attivita', ATTIVITA_IN_AGENDA)
          .or(
            `and(data_scelta.gte.${inizio},data_scelta.lt.${dopoFine}),` +
              `and(data_scelta.is.null,created_at.gte.${inizio},created_at.lt.${dopoFine})`
          )
    ),
    supabase.from('staff_users').select('email, nome, cognome, commerciale'),
    eventiScaduti(),
  ])

  const staffOrdinato = ordinaPerCognome(
    (staff ?? []) as (RigaStaff & { commerciale?: boolean })[]
  )
  const nomiStaff = mappaNomiStaff(staffOrdinato)

  // Si parte dai commerciali, tutti, anche quelli a zero: una tabella che
  // elenca solo chi ha lavorato non permette di vedere chi non ha lavorato —
  // che è metà della domanda di questa pagina.
  const righe = new Map<string, RigaConsulente>()
  for (const s of staffOrdinato.filter((s) => s.commerciale)) {
    righe.set(s.email, rigaVuota(s.email))
  }
  function riga(email: string | null): RigaConsulente | null {
    if (!email) return null
    if (!righe.has(email)) righe.set(email, rigaVuota(email))
    return righe.get(email)!
  }

  const righeEventiPerTipo = new Map<string, RigaEventiPerTipo>()
  for (const s of staffOrdinato.filter((s) => s.commerciale)) {
    righeEventiPerTipo.set(s.email, rigaEventiPerTipoVuota(s.email))
  }
  function rigaEventiTipo(email: string | null): RigaEventiPerTipo | null {
    if (!email) return null
    if (!righeEventiPerTipo.has(email)) righeEventiPerTipo.set(email, rigaEventiPerTipoVuota(email))
    return righeEventiPerTipo.get(email)!
  }

  // Cosa dicono le note: quanto sono profonde (per consulente e nel tempo) e
  // cosa dicono davvero — le obiezioni ricorrenti nelle perse, cosa funziona
  // negli eventi riusciti. Nessuna IA: solo lunghezza e parole più frequenti,
  // ma dette su tutte le note del periodo invece che lette una per una dicono
  // già la sensazione generale.
  const qualitaNote = new Map<string, { lunghezze: number[]; brevi: number }>()
  const perSettimana = new Map<string, number[]>()
  const testiObiezioni: string[] = []
  const testiFunziona: string[] = []
  function notaQualita(email: string | null) {
    if (!email) return null
    if (!qualitaNote.has(email)) qualitaNote.set(email, { lunghezze: [], brevi: 0 })
    return qualitaNote.get(email)!
  }
  function registraNota(email: string | null, testo: unknown, giorno: string | null) {
    const nota = typeof testo === 'string' ? testo.trim() : ''
    if (!nota) return
    const chi = notaQualita(email)
    if (chi) {
      chi.lunghezze.push(nota.length)
      if (nota.length <= SOGLIA_NOTA_BREVE) chi.brevi += 1
    }
    if (giorno) {
      const settimana = inizioSettimana(giorno)
      if (!perSettimana.has(settimana)) perSettimana.set(settimana, [])
      perSettimana.get(settimana)!.push(nota.length)
    }
  }

  // Lo spaccato per canale di acquisizione: non solo da dove arrivano le
  // vinte e le perse, ma tutto il quadro — anche quante sono aperte adesso.
  // Un canale che porta molte trattative ma le chiude poco si vede solo
  // mettendo aperte e chiuse fianco a fianco, non guardando le chiuse da
  // sole.
  const perProvenienza = new Map<
    ChiaveProvenienza,
    { etichetta: string; aperte: number; vinte: number; perse: number; valore: number }
  >()
  function rigaProvenienza(chiave: ChiaveProvenienza, etichetta: string) {
    if (!perProvenienza.has(chiave)) {
      perProvenienza.set(chiave, { etichetta, aperte: 0, vinte: 0, perse: 0, valore: 0 })
    }
    return perProvenienza.get(chiave)!
  }

  // 1 e 2: il carico di adesso e la reattività.
  let libere = 0
  for (const o of opportunita ?? []) {
    const provenienzaAperta = provenienzaDiOrigine(o.origine as string | null)
    rigaProvenienza(provenienzaAperta.chiave, provenienzaAperta.etichetta).aperte += 1

    const chi = riga(o.assegnato_a as string | null)
    if (!chi) {
      libere += 1
      continue
    }
    chi.aperte += 1
    // Quanto ha aspettato prima di essere presa: solo quelle prese **nel
    // periodo**, o la media resterebbe la stessa per sempre — una media su
    // tutta la storia non dice se questa settimana si è risposto in fretta.
    //
    // Contate in **ore di apertura** e non sull'orologio (vedi
    // lib/orarioLavorativo.ts): un lead arrivato venerdì alle 20:50 e preso
    // sabato alle 8:05 sull'orologio fa 11 ore, e sembra una dimenticanza —
    // mentre è stata la prima cosa fatta all'apertura, cioè 15 minuti.
    if (o.assegnato_il && o.creato_il) {
      const giornoPresa = (o.assegnato_il as string).slice(0, 10)
      if (giornoPresa >= inizio && giornoPresa <= oggi) {
        const ms = msLavorativi(o.creato_il as string, o.assegnato_il as string)
        if (ms !== null) chi.attesePresa.push(ms)
      }
    }
  }

  // 3: gli eventi assegnati (il carico) e, divisi per tipo e provenienza,
  // quelli eseguiti. Un task agganciato direttamente al contatto
  // (entita = 'persona') non ha nessuna richiesta dietro: se l'ha scritto la
  // segreteria, è iniziativa sua. Uno agganciato a una richiesta
  // (entita = 'form_contatti'), e le richieste stesse, sono invece cose
  // arrivate dal sito o dal banco — la segreteria le sta lavorando, non le
  // ha inventate.
  let eventiSenzaAssegnatario = 0
  for (const t of task ?? []) {
    const assegnato = riga(t.assegnato_a as string | null)
    if (assegnato) assegnato.eventiAssegnati += 1
    else eventiSenzaAssegnatario += 1

    const eseguito = rigaEventiTipo(t.esito_da as string | null)
    if (eseguito) {
      const tipo: TipoVoce = eTipoValido(t.tipo) ? t.tipo : 'task'
      const conteggi = t.entita === 'persona' ? eseguito.autonomi : eseguito.daSito
      conteggi[tipo] += 1
    }

    registraNota(t.esito_da as string | null, t.esito, t.data as string | null)
    if (t.esito_tipo === 'eseguita' && typeof t.esito === 'string' && t.esito.trim()) {
      testiFunziona.push(t.esito)
    }
  }
  for (const r of richieste ?? []) {
    const assegnato = riga(r.assegnato_a as string | null)
    if (assegnato) assegnato.eventiAssegnati += 1
    else eventiSenzaAssegnatario += 1
    // `esito_da` sugli appuntamenti, `gestito_da` sui messaggi: sono le due
    // firme delle due chiusure (vedi chiudiConEsito e salvaGestione).
    const eseguitoEmail = (r.esito_da as string) ?? (r.gestito_da as string) ?? null
    const eseguito = riga(eseguitoEmail)

    // Una richiesta dal sito o dal banco, quindi sempre «da sito»: non
    // esiste una richiesta scritta in autonomia dalla segreteria, per
    // definizione arriva da fuori.
    if (r.gestito) {
      const eseguitoTipi = rigaEventiTipo(eseguitoEmail)
      if (eseguitoTipi) eseguitoTipi.daSito[tipoDaAzione(r.azione as string | null)] += 1
    }

    // Il tempo di gestione, solo sui messaggi. Un appuntamento in sede si
    // rispetta all'ora fissata anche se la nota si scrive dopo — cronometrare
    // da quando arriva a quando si scrive la nota misurerebbe il ritardo
    // della scrivania, non quello della persona che aspetta una risposta.
    // Un messaggio invece non ha nessun altro orologio: da quando arriva a
    // quando viene gestito è **tutto** il tempo che la persona aspetta.
    if (
      eseguito &&
      r.gestito &&
      r.gestito_il &&
      r.created_at &&
      tipoDaAzione(r.azione as string | null) === 'messaggio'
    ) {
      const giornoGestione = (r.gestito_il as string).slice(0, 10)
      if (giornoGestione >= inizio && giornoGestione <= oggi) {
        const ms = msLavorativi(r.created_at as string, r.gestito_il as string)
        if (ms !== null) eseguito.tempiGestioneMessaggi.push(ms)
      }
    }

    registraNota(
      eseguitoEmail,
      r.esito,
      r.gestito_il ? (r.gestito_il as string).slice(0, 10) : null
    )
    if (r.esito_tipo === 'eseguita' && typeof r.esito === 'string' && r.esito.trim()) {
      testiFunziona.push(r.esito)
    }
  }

  // 4: il risultato del periodo.
  let vinteTotali = 0
  let valoreTotale = 0
  let perseTotali = 0
  let vinteSenzaValore = 0

  for (const o of chiuse ?? []) {
    const chi = riga(o.assegnato_a as string | null)
    const stato = o.stato as StatoTrattativa
    const provenienza = provenienzaDiOrigine(o.origine as string | null)
    const daProvenienza = rigaProvenienza(provenienza.chiave, provenienza.etichetta)
    if (stato === 'vinto') {
      vinteTotali += 1
      const v = o.valore_euro != null ? Number(o.valore_euro) : null
      if (v === null) vinteSenzaValore += 1
      else valoreTotale += v
      if (chi) {
        chi.vinte += 1
        if (v !== null) chi.valore += v
      }
      daProvenienza.vinte += 1
      if (v !== null) daProvenienza.valore += v
    } else {
      perseTotali += 1
      if (chi) chi.perse += 1
      daProvenienza.perse += 1
      if (typeof o.motivo_perso === 'string' && o.motivo_perso.trim()) {
        testiObiezioni.push(o.motivo_perso)
      }
    }

    const notaChiusura = stato === 'vinto' ? o.motivo_vinto : o.motivo_perso
    registraNota(
      o.assegnato_a as string | null,
      notaChiusura,
      o.chiuso_il ? (o.chiuso_il as string).slice(0, 10) : null
    )
  }
  // Ordinate per quante ne ha portate, non alfabeticamente: la prima riga
  // deve essere il canale che pesa di più, non "Agenda" perché comincia
  // prima di "Sito" nell'alfabeto.
  const provenienze = [...perProvenienza.values()].sort(
    (a, b) =>
      b.aperte + b.vinte + b.perse - (a.aperte + a.vinte + a.perse)
  )

  const elenco = [...righe.values()].sort((a, b) => b.aperte - a.aperte || b.vinte - a.vinte)
  const apertePiuAlte = Math.max(1, ...elenco.map((r) => r.aperte))
  const totaleAperte = elenco.reduce((a, r) => a + r.aperte, 0) + libere
  const nessunEventoEseguito = [...righeEventiPerTipo.values()].every(
    (e) => totaleConteggi(e.autonomi) + totaleConteggi(e.daSito) === 0
  )

  // Le parole più frequenti, dalle perse (le obiezioni) e dagli eventi
  // riusciti (cosa funziona): dodici bastano a dare il senso senza
  // trasformare la pagina in un elenco di parole.
  const obiezioniFrequenti = paroleFrequenti(testiObiezioni, 12)
  const funzionaFrequenti = paroleFrequenti(testiFunziona, 12)

  // L'andamento settimanale della lunghezza delle note, in ordine
  // cronologico: dice se si sta scrivendo sempre meno (o sempre di più) mano
  // a mano che il periodo passa, cosa che una sola media non direbbe.
  const settimaneNote = [...perSettimana.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([settimana, lunghezze]) => ({
      settimana,
      media: media(lunghezze),
      conteggio: lunghezze.length,
    }))

  function link(p: ChiavePeriodo): string {
    return `/dashboard/core-manager?periodo=${p}`
  }

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Core</p>
        <h1>Core Manager</h1>
        <p className="muted">
          Come è distribuito il lavoro del settore core fra le persone: carico, reattività, eventi
          fatti e trattative chiuse col loro valore. Serve a vedere gli squilibri — non a giudicare
          una riga, ma a capire se qualcuno è sommerso e qualcun altro è fermo.
        </p>
      </div>

      {/* Il pulsante che porta al report giornaliero, in evidenza e non
          dentro una riga di testo: è la pagina che la responsabile apre ogni
          giorno, non un rimando occasionale da queste statistiche. */}
      <Link href="/dashboard/core-manager/report" className="btn btn-grande report-cta">
        Report giornaliero per consulente
      </Link>

      {/* Il periodo vale per tutto tranne le opportunità aperte, che sono una
          fotografia di adesso. Detto qui e ripetuto in testa alla tabella
          giusta, perché un numero col periodo sbagliato in testa è peggio di
          un numero senza periodo. */}
      <div className="filtri">
        <div className="filtri-testa">
          <span className="filtri-titolo">Periodo</span>
        </div>
        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
            <legend>Chiusure ed eventi</legend>
            {PERIODI.map((p) => (
              <Link
                key={p.chiave}
                className={`chip${periodo === p.chiave ? ' is-attivo' : ''}`}
                aria-current={periodo === p.chiave ? 'true' : undefined}
                href={link(p.chiave)}
              >
                {periodo === p.chiave && (
                  <span className="chip-spunta" aria-hidden="true">
                    ✓
                  </span>
                )}
                {p.etichetta}
              </Link>
            ))}
          </fieldset>
        </div>
      </div>

      {scaduti.length > 0 && (
        <div className="card card-avviso">
          <div className="card-head">
            <h3 className="card-titolo">Eventi scaduti da gestire</h3>
            <span className="badge badge-warn badge-punto">{scaduti.length}</span>
          </div>
          <p className="card-nota muted">
            Aperti e di un giorno passato, di chiunque nel settore: non seguono il periodo scelto
            sopra, perché un arretrato resta un arretrato finché non viene chiuso.
          </p>
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Nominativo</th>
                  <th>Tipo</th>
                  <th>Scaduto il</th>
                  <th>Assegnatario</th>
                </tr>
              </thead>
              <tbody>
                {scaduti.map((v) => (
                  <tr key={v.chiave}>
                    {/* Il nominativo porta alla sua scheda, dove ci sono le
                        altre richieste e le note di chi l'ha già chiamato:
                        qui l'evento non si apre — si guarda chi è in
                        arretrato — e per sapere di chi si tratta si doveva
                        cercarlo a mano in anagrafica. Lo stesso gesto che
                        l'espansione offre col pulsante «Scheda contatto» in
                        agenda, in dashboard e in Eventi Core. */}
                    <td>
                      {v.personaId ? (
                        <Link
                          href={`/dashboard/persone/${v.personaId}`}
                          target="_blank"
                          rel="noopener"
                          className="link-nuova-scheda"
                        >
                          {v.persona || v.titolo}
                          <IconaNuovaScheda />
                        </Link>
                      ) : (
                        v.persona || v.titolo
                      )}
                    </td>
                    <td>
                      <span className={`badge-tipo ${CLASSE_TIPO[v.tipo]}`}>
                        {ETICHETTE_TIPO_BREVI[v.tipo]}
                      </span>
                    </td>
                    <td>{dataBreve(v.data)}</td>
                    <td>
                      <span
                        className={`tag-assegnato${v.assegnatoA ? ' e-altrui' : ' e-nessuno'}`}
                      >
                        {v.assegnatoA ? nomeDiEmail(v.assegnatoA, nomiStaff) : 'Non assegnato'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="griglia-stat">
        <div className={`stat stat-gestione${totaleAperte > 0 ? '' : ' is-vuoto'}`}>
          <span className="stat-testa">
            <span className="stat-label">Opportunità aperte</span>
          </span>
          <span className="stat-valore">{totaleAperte}</span>
          <span className="stat-nota">Adesso, in tutto il settore</span>
        </div>

        <div className={`stat stat-nuovo${libere > 0 ? ' is-azione' : ' is-vuoto'}`}>
          <span className="stat-testa">
            <span className="stat-label">
              {libere > 0 && <span className="stat-punto" aria-hidden="true" />}
              Senza titolare
            </span>
          </span>
          <span className="stat-valore">{libere}</span>
          <span className="stat-nota">
            {libere > 0 ? 'Non le segue nessuno: sono di chi se le prende' : 'Tutte in mano a qualcuno'}
          </span>
        </div>

        <div className={`stat stat-vinto${vinteTotali > 0 ? '' : ' is-vuoto'}`}>
          <span className="stat-testa">
            <span className="stat-label">Vinte nel periodo</span>
          </span>
          <span className="stat-valore">{vinteTotali}</span>
          <span className="stat-nota">
            {euro(valoreTotale) ?? '—'}
            {vinteSenzaValore > 0 && ` · ${vinteSenzaValore} senza valore registrato`}
          </span>
        </div>

        <div className={`stat stat-perso${perseTotali > 0 ? '' : ' is-vuoto'}`}>
          <span className="stat-testa">
            <span className="stat-label">Perse nel periodo</span>
          </span>
          <span className="stat-valore">{perseTotali}</span>
          <span className="stat-nota">Chiuse col motivo registrato</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Per consulente</h2>
          <span className="muted">
            {PERIODI.find((p) => p.chiave === periodo)?.etichetta.toLowerCase()}, tranne le aperte
          </span>
        </div>

        <p className="card-nota muted">
          <strong>Aperte</strong> è una fotografia di adesso. <strong>Presa in carico</strong> è la
          media fra l&apos;arrivo del lead e il momento in cui qualcuno se l&apos;è preso, sulle
          prese nel periodo, contata sulle <strong>ore di apertura</strong> — 7:00–21:00 dal
          lunedì al venerdì, 8:00–19:00 sabato, domenica e festivi. Le ore in cui il club è
          chiuso non si contano: un lead arrivato venerdì a tarda sera e preso sabato
          all&apos;apertura è «15 minuti», non «11 ore». <strong>Gestione messaggi</strong> è la
          stessa media, ma dall&apos;arrivo del messaggio alla sua chiusura, e solo sui messaggi:
          un appuntamento in sede si rispetta all&apos;ora fissata anche se la nota si scrive dopo,
          quindi cronometrarlo misurerebbe il ritardo della nota, non quello della risposta.{' '}
          <strong>Eventi assegnati</strong> è il carico di adesso; quanti e di che tipo ne ha
          eseguiti ciascuno è nella tabella «Eventi eseguiti» qui sotto.
        </p>

        {elenco.length === 0 ? (
          <p className="vuoto">
            Nessun commerciale configurato: il diritto si assegna da{' '}
            <Link className="link" href="/dashboard/utenti">
              Gestione utenti
            </Link>
            .
          </p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Consulente</th>
                  <th>Aperte</th>
                  <th>
                    Presa in carico
                    <span className="th-nota">ore di apertura</span>
                  </th>
                  <th>
                    Gestione messaggi
                    <span className="th-nota">ore di apertura</span>
                  </th>
                  <th>Eventi assegnati</th>
                  <th>Vinte</th>
                  <th>Valore</th>
                  <th>Perse</th>
                </tr>
              </thead>
              <tbody>
                {elenco.map((r) => {
                  const mediaPresa = media(r.attesePresa)
                  const mediaGestioneMessaggi = media(r.tempiGestioneMessaggi)
                  return (
                    <tr key={r.email} className={r.email === io ? 'is-mia' : undefined}>
                      <td>
                        {nomeDiEmail(r.email, nomiStaff)}
                        {r.email === io && <span className="muted"> (tu)</span>}
                      </td>
                      {/* Il carico con una barra dietro il numero: in una
                          colonna di cifre lo squilibrio si vede contando, con
                          la barra si vede guardando — ed è il motivo per cui
                          questa pagina esiste. */}
                      <td>
                        <span className="carico">
                          <span
                            className="carico-barra"
                            style={{ width: `${(r.aperte / apertePiuAlte) * 100}%` }}
                            aria-hidden="true"
                          />
                          <span className="carico-numero">{r.aperte}</span>
                        </span>
                      </td>
                      <td>
                        {durataLavorativa(mediaPresa)}
                        {r.attesePresa.length > 0 && (
                          <span className="muted"> ({r.attesePresa.length})</span>
                        )}
                      </td>
                      <td>
                        {durataLavorativa(mediaGestioneMessaggi)}
                        {r.tempiGestioneMessaggi.length > 0 && (
                          <span className="muted"> ({r.tempiGestioneMessaggi.length})</span>
                        )}
                      </td>
                      <td>{r.eventiAssegnati}</td>
                      <td>{r.vinte}</td>
                      <td className="cella-valore">{r.valore > 0 ? euro(r.valore) : '—'}</td>
                      <td>{r.perse}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th>Totale</th>
                  <th>{elenco.reduce((a, r) => a + r.aperte, 0)}</th>
                  <th>{durataLavorativa(media(elenco.flatMap((r) => r.attesePresa)))}</th>
                  <th>{durataLavorativa(media(elenco.flatMap((r) => r.tempiGestioneMessaggi)))}</th>
                  <th>{elenco.reduce((a, r) => a + r.eventiAssegnati, 0)}</th>
                  <th>{elenco.reduce((a, r) => a + r.vinte, 0)}</th>
                  <th className="cella-valore">
                    {euro(elenco.reduce((a, r) => a + r.valore, 0)) ?? '—'}
                  </th>
                  <th>{elenco.reduce((a, r) => a + r.perse, 0)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Quello che la tabella non attribuisce a nessuno, invece di
            lasciarlo fuori in silenzio: un totale che non torna fa dubitare
            di tutta la pagina. */}
        {(libere > 0 || eventiSenzaAssegnatario > 0) && (
          <p className="card-nota muted">
            Fuori dalla tabella perché non sono di nessuno: {libere}{' '}
            {libere === 1 ? 'opportunità' : 'opportunità'} senza titolare e {eventiSenzaAssegnatario}{' '}
            {eventiSenzaAssegnatario === 1 ? 'evento' : 'eventi'} senza assegnatario — quelli
            arrivati dal sito e non ancora presi in carico.
          </p>
        )}
      </div>

      {/* Quanti eventi ha eseguito ciascuno, e di che tipo — non il totale,
          che da solo non dice se è stato al telefono tutto il giorno o ha
          fatto dieci visite in sede. E divisi per come sono nati: un task
          scritto da sé (nessuna richiesta dietro, vedi ENTITA_COLLEGAMENTO in
          lib/eventi.ts) è iniziativa della persona; uno agganciato a una
          richiesta, o la richiesta stessa, è lavoro arrivato dal sito o dal
          banco — due cose diverse da vedere separate, non sommate in un
          numero solo. */}
      <div className="card">
        <div className="card-head">
          <h2>Eventi eseguiti</h2>
          <span className="muted">
            {PERIODI.find((p) => p.chiave === periodo)?.etichetta.toLowerCase()}, per tipo e
            provenienza
          </span>
        </div>

        {elenco.length === 0 ? (
          <p className="vuoto">Nessun commerciale configurato.</p>
        ) : nessunEventoEseguito ? (
          <p className="vuoto">Nessun evento eseguito nel periodo.</p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Consulente</th>
                  <th>Provenienza</th>
                  {TIPI.map((tipo) => (
                    <th key={tipo}>{ETICHETTE_TIPO_BREVI[tipo]}</th>
                  ))}
                  <th>Totale</th>
                </tr>
              </thead>
              <tbody>
                {elenco.flatMap((r) => {
                  const eventi = righeEventiPerTipo.get(r.email) ?? rigaEventiPerTipoVuota(r.email)
                  const gruppi: { chiave: string; etichetta: string; conteggi: ConteggioTipi }[] = [
                    { chiave: 'autonomi', etichetta: 'Autonomi', conteggi: eventi.autonomi },
                    { chiave: 'sito', etichetta: 'Sito e Guest Register', conteggi: eventi.daSito },
                  ]
                  // Solo le righe con qualcosa dentro: un consulente senza
                  // eventi autonomi nel periodo non deve occupare una riga di
                  // zeri identica per tutti.
                  return gruppi
                    .filter((g) => totaleConteggi(g.conteggi) > 0)
                    .map((g) => (
                      <tr key={`${r.email}-${g.chiave}`} className={r.email === io ? 'is-mia' : undefined}>
                        <td>
                          {nomeDiEmail(r.email, nomiStaff)}
                          {r.email === io && <span className="muted"> (tu)</span>}
                        </td>
                        <td className="muted">{g.etichetta}</td>
                        {TIPI.map((tipo) => (
                          <td key={tipo}>{g.conteggi[tipo] || '—'}</td>
                        ))}
                        <td>
                          <strong>{totaleConteggi(g.conteggi)}</strong>
                        </td>
                      </tr>
                    ))
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th>Totale</th>
                  <th />
                  {TIPI.map((tipo) => (
                    <th key={tipo}>
                      {[...righeEventiPerTipo.values()].reduce(
                        (a, e) => a + e.autonomi[tipo] + e.daSito[tipo],
                        0
                      )}
                    </th>
                  ))}
                  <th>
                    {[...righeEventiPerTipo.values()].reduce(
                      (a, e) => a + totaleConteggi(e.autonomi) + totaleConteggi(e.daSito),
                      0
                    )}
                  </th>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Il quadro completo per canale di acquisizione: non solo dove
          arrivano le vinte e le perse, ma anche quante ne ha aperte adesso.
          Un canale che porta molte trattative ma le chiude poco si vede solo
          mettendo le aperte accanto alle chiuse — guardare solo vinte e
          perse lo farebbe sembrare un canale piccolo, quando è solo lento a
          chiudere. È una domanda sui canali, non sulle persone: su otto
          righe per consulente non si vedrebbe. */}
      {provenienze.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Per provenienza</h2>
            <span className="muted">
              {PERIODI.find((p) => p.chiave === periodo)?.etichetta.toLowerCase()}, tranne le aperte
            </span>
          </div>

          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Provenienza</th>
                  <th>
                    Aperte
                    <span className="th-nota">adesso, non nel periodo</span>
                  </th>
                  <th>Vinte</th>
                  <th>Perse</th>
                  <th>
                    Tasso di successo
                    <span className="th-nota">vinte su vinte + perse</span>
                  </th>
                  <th>Valore</th>
                </tr>
              </thead>
              <tbody>
                {provenienze.map((p) => {
                  const chiuseProvenienza = p.vinte + p.perse
                  const tasso =
                    chiuseProvenienza > 0 ? Math.round((p.vinte / chiuseProvenienza) * 100) : null
                  return (
                    <tr key={p.etichetta}>
                      <td>{p.etichetta}</td>
                      <td>{p.aperte}</td>
                      <td>{p.vinte}</td>
                      <td>{p.perse}</td>
                      <td>{tasso !== null ? `${tasso}%` : '—'}</td>
                      <td className="cella-valore">{p.valore > 0 ? euro(p.valore) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th>Totale</th>
                  <th>{provenienze.reduce((a, p) => a + p.aperte, 0)}</th>
                  <th>{provenienze.reduce((a, p) => a + p.vinte, 0)}</th>
                  <th>{provenienze.reduce((a, p) => a + p.perse, 0)}</th>
                  <th>
                    {(() => {
                      const vinte = provenienze.reduce((a, p) => a + p.vinte, 0)
                      const totale = vinte + provenienze.reduce((a, p) => a + p.perse, 0)
                      return totale > 0 ? `${Math.round((vinte / totale) * 100)}%` : '—'
                    })()}
                  </th>
                  <th className="cella-valore">
                    {euro(provenienze.reduce((a, p) => a + p.valore, 0)) ?? '—'}
                  </th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {vinteSenzaValore > 0 && (
        <div className="card card-avviso">
          <div className="card-head">
            <h3 className="card-titolo">Vinte senza valore</h3>
            <span className="badge badge-warn badge-punto">{vinteSenzaValore} nel periodo</span>
          </div>
          <p className="card-nota muted">
            Il valore del contratto è obbligatorio da quando esiste il campo: queste sono chiusure
            precedenti, e restano senza — non si inventa a posteriori a quanto fu venduto. La
            colonna «Valore» le esclude, quindi il totale è più basso del vero fino a quando
            queste escono dal periodo.
          </p>
        </div>
      )}

      {/* Cosa dicono le note, non solo quante sono. Nessuna IA: la lunghezza
          e le parole più frequenti, su tutte le note del periodo — nota,
          esito, motivo di vinta o di persa — danno già la sensazione di come
          si sta scrivendo e di cosa si sta sentendo al telefono, senza dover
          rileggerle una per una. */}
      <div className="card">
        <div className="card-head">
          <h2>Qualità delle note</h2>
          <span className="muted">
            {PERIODI.find((p) => p.chiave === periodo)?.etichetta.toLowerCase()}
          </span>
        </div>

        <p className="card-nota muted">
          Ogni nota scritta chiudendo un evento o una trattativa, per consulente. <strong>Note
          brevi</strong> sono quelle sotto i {SOGLIA_NOTA_BREVE} caratteri — «ok», «fatto» — non un
          giudizio, ma un segnale se sono tante: fra un mese una nota così non dice più niente a
          nessuno.
        </p>

        {[...qualitaNote.values()].every((q) => q.lunghezze.length === 0) ? (
          <p className="vuoto">Nessuna nota scritta nel periodo.</p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Consulente</th>
                  <th>Note scritte</th>
                  <th>
                    Lunghezza media
                    <span className="th-nota">caratteri</span>
                  </th>
                  <th>Note brevi</th>
                </tr>
              </thead>
              <tbody>
                {elenco
                  .map((r) => ({ r, q: qualitaNote.get(r.email) }))
                  .filter(({ q }) => q && q.lunghezze.length > 0)
                  .map(({ r, q }) => {
                    const lunghezzaMedia = media(q!.lunghezze)
                    const quotaBrevi = Math.round((q!.brevi / q!.lunghezze.length) * 100)
                    return (
                      <tr key={r.email} className={r.email === io ? 'is-mia' : undefined}>
                        <td>
                          {nomeDiEmail(r.email, nomiStaff)}
                          {r.email === io && <span className="muted"> (tu)</span>}
                        </td>
                        <td>{q!.lunghezze.length}</td>
                        <td>{lunghezzaMedia !== null ? Math.round(lunghezzaMedia) : '—'}</td>
                        <td>
                          {q!.brevi} <span className="muted">({quotaBrevi}%)</span>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* L'andamento nel tempo: una sola media per tutto il periodo non dice
          se si sta scrivendo sempre meno mano a mano che passano i giorni.
          Solo con più di una settimana nel periodo — su "Oggi" ci sarebbe
          una riga sola, che non è un andamento. */}
      {settimaneNote.length > 1 && (
        <div className="card">
          <div className="card-head">
            <h2>Andamento delle note</h2>
            <span className="muted">lunghezza media, per settimana</span>
          </div>
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Settimana del</th>
                  <th>Note</th>
                  <th>
                    Lunghezza media
                    <span className="th-nota">caratteri</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {settimaneNote.map((s) => (
                  <tr key={s.settimana}>
                    <td>{dataBreve(s.settimana)}</td>
                    <td>{s.conteggio}</td>
                    <td>{s.media !== null ? Math.round(s.media) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Le parole più frequenti: non sostituiscono la lettura delle note,
          ma su un mese intero dicono in un colpo d'occhio quali obiezioni
          tornano e cosa funziona, invece di doverle scorrere una per una. */}
      {(obiezioniFrequenti.length > 0 || funzionaFrequenti.length > 0) && (
        <div className="card">
          <div className="card-head">
            <h2>Cosa dicono le note</h2>
            <span className="muted">
              {PERIODI.find((p) => p.chiave === periodo)?.etichetta.toLowerCase()}
            </span>
          </div>

          <div className="form-row">
            <div className="field" style={{ flexBasis: '48%' }}>
              <p className="filtri-titolo muted">
                Obiezioni ricorrenti <span className="muted">— dalle perse</span>
              </p>
              {obiezioniFrequenti.length === 0 ? (
                <p className="vuoto">Nessun motivo di persa registrato nel periodo.</p>
              ) : (
                <div className="agenda-nav">
                  {obiezioniFrequenti.map((p) => (
                    <span className="tag" key={p.parola}>
                      {p.parola} ({p.volte})
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="field" style={{ flexBasis: '48%' }}>
              <p className="filtri-titolo muted">
                Cosa funziona <span className="muted">— dagli eventi riusciti</span>
              </p>
              {funzionaFrequenti.length === 0 ? (
                <p className="vuoto">Nessun evento eseguito con nota nel periodo.</p>
              ) : (
                <div className="agenda-nav">
                  {funzionaFrequenti.map((p) => (
                    <span className="tag" key={p.parola}>
                      {p.parola} ({p.volte})
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <p className="card-nota muted">
            Solo conteggio di parole, senza intelligenza artificiale: le parole troppo comuni
            (articoli, «fatto», «detto»…) sono già escluse, ma una parola frequente può comunque
            venire da un caso solo ripetuto tante volte nella stessa nota — resta un indizio da
            controllare, non una statistica definitiva.
          </p>
        </div>
      )}
    </>
  )
}
