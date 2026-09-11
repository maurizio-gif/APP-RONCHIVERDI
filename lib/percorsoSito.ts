// Il percorso di chi ha scritto dal sito, come lo legge chi lavora la richiesta.
//
// I dati esistono già e arrivano tutti dal sito, senza nessuna sincronizzazione:
//
//   form_contatti   → la pagina da cui il form è partito (`pagina`), il
//                     pulsante che l'ha aperto (`cta`), gli interessi spuntati
//                     (`dettagli`) e la provenienza della campagna (utm_*);
//   sessioni        → una riga per visita, con atterraggio, sorgente,
//                     dispositivo e città;
//   sessioni_pagine → una riga per pagina vista, che rimessa in fila è il
//                     percorso vero e proprio.
//
// La chiave che lega le tre cose è `form_contatti.session_id`, scritto da
// /api/lead sul sito. Qui c'è solo la forma in cui il pannello li mostra: il
// caricamento sta in app/dashboard/percorso-actions.ts, che gira sul server.

export type PaginaVista = {
  pagina: string
  titolo: string | null
  visto_at: string
}

export type SessioneVisita = {
  session_id: string
  created_at: string
  ultimo_contatto: string
  pagine_viste: number
  landing_page: string | null
  referrer: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  dispositivo: string | null
  citta: string | null
  paese: string | null
}

export type Percorso = {
  /** Null quando la richiesta non ha un session_id, o quando quella sessione non è mai stata registrata. */
  sessione: SessioneVisita | null
  pagine: PaginaVista[]
  /** true se la visita ha più pagine di quelle riportate (vedi MAX_PAGINE). */
  troncato: boolean
}

/**
 * Quante pagine al massimo riportiamo.
 *
 * Non è un limite di prestazioni — una visita normale ne ha cinque — ma di
 * lettura: oltre la quarantina la lista smette di essere un percorso e diventa
 * un registro, e chi sta per telefonare non la guarda più.
 */
export const MAX_PAGINE = 40

const FUSO = 'Europe/Rome'

/** Solo l'ora di una pagina vista: il giorno è già nell'intestazione della richiesta. */
export function oraDi(iso: string): string {
  return new Date(iso).toLocaleTimeString('it-IT', {
    timeZone: FUSO,
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function dataOraDi(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    timeZone: FUSO,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Quanto è durata la visita, dalla prima pagina all'ultimo contatto.
 *
 * Sotto il minuto non scriviamo "0 min" ma "meno di un minuto": una visita
 * lampo e una visita di sessanta secondi vanno distinte, e uno zero secco si
 * legge come un dato mancante.
 */
export function durataDi(s: SessioneVisita): string | null {
  const inizio = new Date(s.created_at).getTime()
  const fine = new Date(s.ultimo_contatto).getTime()
  if (!Number.isFinite(inizio) || !Number.isFinite(fine) || fine < inizio) return null

  const minuti = Math.round((fine - inizio) / 60000)
  if (minuti < 1) return 'meno di un minuto'
  if (minuti < 60) return `${minuti} min`
  const ore = Math.floor(minuti / 60)
  const resto = minuti % 60
  return resto ? `${ore} h ${resto} min` : `${ore} h`
}

/** Il dominio del referrer, che è la parte che dice qualcosa: l'URL intero no. */
export function dominioDi(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Da dove è arrivata la visita, in una riga.
 *
 * Senza UTM restano due casi che vanno detti in parole e non lasciati vuoti:
 * chi è arrivato da un altro sito (e allora il dominio è l'informazione) e chi
 * ha digitato l'indirizzo o cliccato un segnalibro, che è il «diretto».
 */
export function provenienzaDi(s: SessioneVisita): string {
  const parti: string[] = []
  if (s.utm_source) {
    parti.push(s.utm_source)
    if (s.utm_medium) parti.push(s.utm_medium)
    if (s.utm_campaign) parti.push(`campagna ${s.utm_campaign}`)
    return parti.join(' · ')
  }
  const dominio = dominioDi(s.referrer)
  return dominio ? `da ${dominio}` : 'diretto'
}

/** Riga di sintesi della visita: pagine, durata, provenienza, dispositivo, città. */
export function sintesiDi(s: SessioneVisita, pagineCaricate: number): string {
  const pagine = Math.max(s.pagine_viste, pagineCaricate)
  const voci = [`${pagine} ${pagine === 1 ? 'pagina' : 'pagine'}`]

  const durata = durataDi(s)
  if (durata) voci.push(durata)

  voci.push(provenienzaDi(s))

  if (s.dispositivo) voci.push(s.dispositivo)
  const luogo = [s.citta, s.paese && s.paese !== 'IT' ? s.paese : null].filter(Boolean).join(', ')
  if (luogo) voci.push(luogo)

  return voci.join(' · ')
}

/**
 * Confronta due percorsi di pagina ignorando lo slash finale e la query.
 *
 * Serve a riconoscere, nell'elenco delle pagine viste, quella da cui è partito
 * il form: il sito scrive `location.pathname` nel lead e `pathname` nel
 * tracciamento, ma un `/attivita/tennis` e un `/attivita/tennis/` sono la
 * stessa pagina e devono marcarsi come tale.
 */
export function stessaPagina(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const pulisci = (v: string) => v.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/'
  return pulisci(a) === pulisci(b)
}

/** I campi di campagna che una richiesta porta con sé (form_contatti). */
export type ProvenienzaLead = {
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  first_utm_source: string | null
  first_utm_campaign: string | null
}

/**
 * La campagna che ha portato *questa* richiesta (last touch), in una riga.
 *
 * Vuota quando la persona è arrivata senza campagna: quel caso si racconta
 * altrove — con il referrer, o con il «diretto» — perché una riga
 * «Provenienza:» vuota è peggio di nessuna riga.
 */
export function provenienzaRichiesta(r: ProvenienzaLead): string {
  return [r.utm_source, r.utm_medium, r.utm_campaign && `campagna ${r.utm_campaign}`]
    .filter(Boolean)
    .join(' · ')
}

/** La campagna del primo arrivo sul sito: da mostrare solo se diversa dall'ultima. */
export function primoContattoDi(r: ProvenienzaLead): string {
  return [r.first_utm_source, r.first_utm_campaign && `campagna ${r.first_utm_campaign}`]
    .filter(Boolean)
    .join(' · ')
}
