'use server'

import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { rigaStaffCorrente } from '@/lib/auth/staff-server'
import { nomePersona } from '@/lib/persone'
import { canaleDiRichiesta } from '@/lib/richieste'

// Il lavoro appena arrivato che nessuno ha ancora in mano, per l'avviso che
// compare su qualunque pagina del pannello (vedi AvvisoOpportunita).
//
// Perché serve un avviso e non basta il riquadro in dashboard: una richiesta
// che arriva alle 15 resta lì, e finché qualcuno non riapre la propria sezione
// nessuno se ne accorge. I numeri ci sono già; quello che mancava era che si
// facessero sentire.
//
// Due generi, perché sono due lavori diversi:
//
//  - **trattativa** — Club e Family. La richiesta crea una trattativa senza
//    titolare, e la cosa da fare è prendersela. Va a chi ha il diritto
//    commerciale: prendere in carico è suo (vedi puoAssegnare in
//    lib/pipeline.ts), e suonare a chi non può agire sarebbe rumore.
//
//  - **richiesta** — tutti gli altri canali (Young School, Summer Camp,
//    Chinesis, padel, Fitness Manager). Lì non esistono trattative: il
//    responsabile chiama e chiude, e la cosa da fare è la richiesta stessa.
//
// A ciascuno arriva quello delle **sue sezioni**, quelle sul suo profilo
// utente: chi ha solo il nuoto sente il nuoto, chi ha tutto sente tutto.
// Prima l'avviso esisteva per il solo Club e Family, e i responsabili dei
// corsi non ricevevano niente — le loro richieste aspettavano che aprissero
// la pagina.

/** Quante richieste al massimo si guardano indietro per l'avviso. */
const RICHIESTE_DA_GUARDARE = 50

/** Una trattativa senza titolare, come la mostra l'avviso. */
export type OpportunitaLibera = {
  id: string
  personaId: string
  nome: string
  email: string | null
  cellulare: string | null
  /** Quando è nata la trattativa. */
  quando: string
  /** Cosa ha chiesto, dall'ultima sua richiesta: è ciò che apre la telefonata. */
  attivita: string | null
  messaggio: string | null
}

/** Un avviso, qualunque ne sia la sorgente: la forma che l'avviso disegna. */
export type AvvisoLavoro = {
  /** Unica anche mescolando le sorgenti: gli id di tabelle diverse possono coincidere. */
  chiave: string
  /** Trattativa da prendersi, o richiesta da lavorare: cambiano il titolo e i pulsanti. */
  genere: 'trattativa' | 'richiesta'
  id: string
  personaId: string | null
  nome: string
  email: string | null
  cellulare: string | null
  /** Quando è arrivata: l'avviso non lo mostra, serve a metterle in ordine. */
  quando: string
  attivita: string | null
  messaggio: string | null
  /**
   * Di quale sezione è. Chi ha nove sezioni attive riceve avvisi di nove
   * origini diverse: senza dirlo, «Marco Rossi» in un riquadro non dice se
   * chiama per il nuoto o per l'abbonamento — e sono due telefonate diverse.
   */
  sezione: string
  /** Dove si va a lavorarla. */
  href: string
}

/**
 * Chi riceve l'avviso delle **trattative libere**: chi ha il diritto
 * commerciale e la sezione Club e Family.
 *
 * Il diritto commerciale è ciò che permette di prendere in carico (vedi
 * puoAssegnare in lib/pipeline.ts): suonare a chi non può agire sarebbe un
 * rumore e nient'altro. La sezione serve perché l'avviso porta lì.
 */
export async function puoRicevereAvvisoOpportunita(): Promise<boolean> {
  const riga = await rigaStaffCorrente(emailCorrente())
  return !!riga?.commerciale && (riga?.sezioni_consentite ?? []).includes('richieste-club')
}

/**
 * Chi riceve **qualche** avviso: chi può prendersi le trattative, o chi ha
 * almeno un canale di richieste fra le sue sezioni.
 *
 * Serve al layout per decidere se accendere il polling: a chi non riceverà
 * mai niente non si fa chiedere l'elenco ogni venti secondi.
 */
export async function puoRicevereAvvisi(): Promise<boolean> {
  const [trattative, sezioni] = await Promise.all([
    puoRicevereAvvisoOpportunita(),
    getSezioniConsentite(emailCorrente()),
  ])
  return trattative || sezioni.some((s) => s.startsWith('richieste-'))
}

export async function getOpportunitaLibere(): Promise<OpportunitaLibera[]> {
  if (!(await puoRicevereAvvisoOpportunita())) return []

  const supabase = createSupabaseServiceClient()

  // Senza titolare e ancora aperte: `nuovo` e `in_gestione` senza assegnatario
  // sono la stessa cosa per chi guarda — lavoro che nessuno ha in mano. Una
  // in gestione rimasta orfana (l'assegnatario è stato liberato) è anzi la
  // più urgente, perché qualcuno l'aveva già toccata.
  const { data, error } = await supabase
    .from('opportunita')
    .select('id, persona_id, creato_il')
    .is('assegnato_a', null)
    .in('stato', ['nuovo', 'in_gestione'])
    .order('creato_il', { ascending: false })
    .limit(20)

  if (error) {
    console.error('Trattative libere non lette:', error.message)
    return []
  }

  const righe = data ?? []
  if (righe.length === 0) return []

  const personaIds = [...new Set(righe.map((t) => t.persona_id as string))]

  const [{ data: persone, error: errorePersone }, { data: richieste }] = await Promise.all([
    supabase.from('persone').select('id, nome, cognome, email, cellulare').in('id', personaIds),
    // L'ultima richiesta di ciascuno: l'attività e la frase che ha scritto
    // sono quello che serve sapere prima di chiamare. In ordine crescente,
    // così scrivendo nella mappa vince l'ultima letta — la più recente.
    supabase
      .from('form_contatti')
      .select('persona_id, attivita_label, messaggio, created_at')
      .in('persona_id', personaIds)
      .order('created_at', { ascending: true }),
  ])

  if (errorePersone) {
    console.error('Nomi delle trattative libere non letti:', errorePersone.message)
  }

  const perPersona = new Map((persone ?? []).map((p) => [p.id as string, p]))
  const ultimaRichiesta = new Map<string, { attivita: string | null; messaggio: string | null }>()
  for (const r of richieste ?? []) {
    ultimaRichiesta.set(r.persona_id as string, {
      attivita: (r.attivita_label as string) ?? null,
      messaggio: (r.messaggio as string) ?? null,
    })
  }

  return righe.map((t) => {
    const persona = perPersona.get(t.persona_id as string)
    const richiesta = ultimaRichiesta.get(t.persona_id as string)
    return {
      id: t.id as string,
      personaId: t.persona_id as string,
      nome: persona ? nomePersona(persona) : 'Senza nome',
      email: (persona?.email as string) ?? null,
      cellulare: (persona?.cellulare as string) ?? null,
      quando: t.creato_il as string,
      attivita: richiesta?.attivita ?? null,
      messaggio: richiesta?.messaggio ?? null,
    }
  })
}

/**
 * Le richieste non ancora gestite dei canali che questa persona ha fra le
 * proprie sezioni — Club e Family escluso, che passa dalle trattative.
 *
 * Il filtro sui canali si fa qui in TypeScript e non nella query: quale
 * richiesta appartiene a quale canale lo decide `canaleDiRichiesta`
 * (lib/richieste.ts), che incrocia attività, settore e origine. Riscrivere
 * quella regola come una condizione SQL vorrebbe dire una seconda fonte di
 * verità dell'instradamento, che al primo corso aggiunto direbbe una cosa
 * diversa dalle pagine — e qualcuno riceverebbe gli avvisi di richieste che
 * poi, aprendo, non può vedere.
 */
async function getRichiesteDaGestire(): Promise<AvvisoLavoro[]> {
  const sezioni = await getSezioniConsentite(emailCorrente())
  if (sezioni.length === 0) return []

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('form_contatti')
    .select('id, created_at, origine, attivita, settore, attivita_label, messaggio, nome, cognome, email, cellulare, persona_id')
    .eq('gestito', false)
    .order('created_at', { ascending: false })
    .limit(RICHIESTE_DA_GUARDARE)

  if (error) {
    console.error('Richieste da gestire non lette:', error.message)
    return []
  }

  const avvisi: AvvisoLavoro[] = []
  for (const riga of data ?? []) {
    const canale = canaleDiRichiesta(riga)
    // Nessun canale: un'attività aggiunta sul sito e non ancora instradata.
    // Non è di nessuno, e non si avvisa nessuno — è la stessa scelta che fa
    // canaleDiRichiesta, e cambiarla qui vorrebbe dire suonare per una
    // richiesta che poi non si trova in nessuna pagina.
    if (!canale) continue
    if (!sezioni.includes(canale.chiave)) continue
    // Club e Family ha il suo avviso, che è la trattativa da prendersi: due
    // riquadri per la stessa richiesta sarebbero uno da chiudere ogni volta.
    if (canale.inAgenda) continue

    const nome = [riga.nome, riga.cognome].filter(Boolean).join(' ').trim()
    avvisi.push({
      chiave: `richiesta-${riga.id}`,
      genere: 'richiesta',
      id: riga.id as string,
      personaId: (riga.persona_id as string) ?? null,
      nome: nome || 'Senza nome',
      email: (riga.email as string) ?? null,
      cellulare: (riga.cellulare as string) ?? null,
      quando: riga.created_at as string,
      attivita: (riga.attivita_label as string) ?? null,
      messaggio: (riga.messaggio as string) ?? null,
      sezione: canale.label,
      href: `/dashboard/richieste/${canale.chiave}`,
    })
  }

  return avvisi
}

/**
 * Tutto il lavoro appena arrivato che riguarda chi sta guardando: le
 * trattative da prendersi e le richieste da gestire, in un elenco solo e dal
 * più recente.
 *
 * Un elenco solo e non due perché l'avviso è uno: chi ha nove sezioni non
 * deve trovarsi nove riquadri sovrapposti, ma una coda che scorre.
 */
export async function getAvvisiLavoro(): Promise<AvvisoLavoro[]> {
  const [trattative, richieste] = await Promise.all([
    getOpportunitaLibere(),
    getRichiesteDaGestire(),
  ])

  const daTrattative: AvvisoLavoro[] = trattative.map((t) => ({
    chiave: `trattativa-${t.id}`,
    genere: 'trattativa',
    id: t.id,
    personaId: t.personaId,
    nome: t.nome,
    email: t.email,
    cellulare: t.cellulare,
    quando: t.quando,
    attivita: t.attivita,
    messaggio: t.messaggio,
    sezione: 'Eventi Core',
    href: `/dashboard/persone/${t.personaId}`,
  }))

  return [...daTrattative, ...richieste].sort((a, b) => b.quando.localeCompare(a.quando))
}
