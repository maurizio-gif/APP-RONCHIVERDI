// Classificazione granulare del traffico per la dashboard direzionale: non i
// bucket larghi di classificaCanaleTraffico() in lib/analytics.ts ("Social a
// pagamento" mette insieme Meta, TikTok, LinkedIn...) ma piattaforma +
// organico/a pagamento separati ("Meta organico", "Meta ADV", "Google ADV"...),
// per capire da quale canale specifico arrivano davvero i contatti.
//
// File a parte e non una modifica a classificaCanaleTraffico: quella funzione
// è condivisa con la stessa classificazione del Tennis Club Ambrosiano (vedi
// il commento in lib/analytics.ts) — cambiarla sposterebbe anche i numeri già
// pubblicati là.

import { ORIGINE_BANCO } from './provenienza'
import { dominioDi, type CoppiaUtm } from './analytics'

/** Alias osservati per le stesse piattaforme (Meta usa sia "facebook"/"fb" sia "instagram"/"ig"). */
const PIATTAFORME: Record<string, string> = {
  facebook: 'Meta',
  fb: 'Meta',
  instagram: 'Meta',
  ig: 'Meta',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  twitter: 'X (Twitter)',
  x: 'X (Twitter)',
  pinterest: 'Pinterest',
  snapchat: 'Snapchat',
  google: 'Google',
  bing: 'Bing',
  yahoo: 'Yahoo',
  duckduckgo: 'DuckDuckGo',
  ecosia: 'Ecosia',
}

/**
 * Le stesse piattaforme, ma per riconoscerle nel DOMINIO di un referrer
 * (`facebook.com`, `l.instagram.com`...) invece che in un utm_source esatto.
 * Chiavi diverse e non un riuso di PIATTAFORME: lì "x"/"fb"/"ig" sono valori
 * esatti di utm_source, qui diventerebbero un `.includes()` che scambia
 * qualunque dominio con una "x" o una "fb" dentro per social — un dominio
 * intero (host completo di uno di questi servizi) non dà quell'ambiguità.
 */
const PIATTAFORME_DOMINIO: Record<string, string> = {
  google: 'Google',
  bing: 'Bing',
  yahoo: 'Yahoo',
  duckduckgo: 'DuckDuckGo',
  ecosia: 'Ecosia',
  facebook: 'Meta',
  instagram: 'Meta',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  twitter: 'X (Twitter)',
  pinterest: 'Pinterest',
  snapchat: 'Snapchat',
}

function capitalizza(testo: string): string {
  return testo.charAt(0).toUpperCase() + testo.slice(1)
}

/** La piattaforma il cui dominio compare nell'host del referrer, se una la riconosce. */
function piattaformaDaReferrer(referrer: string): string | null {
  const host = dominioDi(referrer)
  for (const [frammento, piattaforma] of Object.entries(PIATTAFORME_DOMINIO)) {
    if (host.includes(frammento)) return piattaforma
  }
  return null
}

/**
 * Il canale granulare di una coppia UTM grezza (dalla RPC statistiche_richieste).
 * Chi è passato dal Guest Register resta a parte anche qui, prima di
 * guardare qualunque UTM — stessa ragione di perCanaleTraffico in
 * lib/analytics.ts: non ha una campagna, è stato fisicamente in sede.
 */
export function canaleGranulare(c: CoppiaUtm): string {
  if (c.origine === ORIGINE_BANCO) return 'Guest Register'

  const s = String(c.utm_source ?? '').trim().toLowerCase()
  const m = String(c.utm_medium ?? '').trim().toLowerCase()
  const ePagato = /cpc|ppc|paid|adwords/.test(m)

  if (s) {
    const piattaforma = PIATTAFORME[s] ?? capitalizza(s)
    if (m === 'email' || s === 'email') return 'Email marketing'
    if (m === 'referral') return 'Referral'
    return `${piattaforma} ${ePagato ? 'ADV' : 'organico'}`
  }

  if (m === 'email') return 'Email marketing'
  if (m === 'referral') return 'Referral'
  if (!m) {
    // Nessuna UTM: l'ultimo clic pubblicitario, quando c'è, dice comunque da
    // dove arriva — stessa logica di recupero di perCanaleTraffico. Un
    // referrer il cui dominio è un motore di ricerca o un social è quasi
    // sempre organico arrivato senza parametri (chi clicca un annuncio porta
    // quasi sempre un click id o una UTM): dirlo "Referral" lo confonderebbe
    // con un rimando da un sito qualunque.
    if (c.gclid) return 'Google ADV'
    if (c.fbclid) return 'Meta ADV'
    if (c.referrer) {
      const piattaforma = piattaformaDaReferrer(c.referrer)
      return piattaforma ? `${piattaforma} organico` : 'Referral'
    }
    return 'Traffico diretto'
  }

  return ePagato ? 'Altre campagne a pagamento' : 'Altro traffico organico'
}
