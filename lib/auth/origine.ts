import { headers } from 'next/headers'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { inviaEmail } from '@/lib/email'
import { registraLog } from '@/lib/audit'

// Da dove arriva una richiesta di accesso: IP, paese, città e browser.
//
// Server-only: legge gli header della richiesta corrente, quindi si chiama
// solo da Server Action o Server Component.
//
// Gli header geografici li imposta Vercel (x-vercel-ip-*): in locale non ci
// sono e restano vuoti. L'IP è il primo di x-forwarded-for, cioè il client
// originale; gli altri sono i proxy attraversati.

export type Origine = {
  ip: string | null
  paese: string | null
  citta: string | null
  browser: string | null
}

// Quanti login passati si leggono per sapere da dove l'utente di solito
// entra, e quanto indietro. Novanta giorni coprono chi lavora a periodi.
const LOGIN_STORICI_MAX = 200
const GIORNI_STORICO = 90

// Chi riceve in copia l'avviso di accesso da un paese insolito, oltre
// all'utente: chi controlla gli accessi non deve dipendere dal fatto che
// l'utente legga la propria posta.
const AVVISO_CONTROLLO_A = process.env.ACCESSI_AVVISO_A ?? 'digital@ronchiverdi.it'

function decodifica(v: string | null): string | null {
  if (!v) return null
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

// "Chrome su macOS", non lo user agent intero: in tabella si deve leggere.
function browserLeggibile(ua: string | null): string | null {
  if (!ua) return null
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser sconosciuto'
  const sistema = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iOS/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null
  return sistema ? `${browser} su ${sistema}` : browser
}

export function origineRichiesta(): Origine {
  const h = headers()
  const forwarded = h.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() || h.get('x-real-ip') || null
  return {
    ip,
    paese: h.get('x-vercel-ip-country'),
    citta: decodifica(h.get('x-vercel-ip-city')),
    browser: browserLeggibile(h.get('user-agent')),
  }
}

// Le sole chiavi valorizzate, pronte da mettere in `dettagli` del registro.
export function dettagliOrigine(o: Origine): Record<string, string> {
  const d: Record<string, string> = {}
  if (o.ip) d.ip = o.ip
  if (o.paese) d.paese = o.paese
  if (o.citta) d.citta = o.citta
  if (o.browser) d.browser = o.browser
  return d
}

/**
 * Dopo un accesso riuscito: se l'utente entra da un paese o da un IP che non
 * ha mai usato negli ultimi 90 giorni, lo scrive nel registro (azioni
 * `login_nuovo_paese` / `login_nuovo_ip`) e, per un paese nuovo, gli manda
 * un'email di avviso.
 *
 * Non c'è avviso finché l'utente non ha almeno un accesso registrato con
 * origine: altrimenti il primo giro dopo l'attivazione segnalerebbe tutti.
 * L'IP nuovo da solo non manda email: da telefono o con la rete dell'ufficio
 * cambia di continuo e l'avviso diventerebbe rumore; resta nel registro, dove
 * Controllo operatori lo filtra.
 *
 * Non lancia mai: un controllo che non riesce non deve impedire l'accesso.
 */
export async function segnalaAccessoInusuale(email: string, origine: Origine): Promise<void> {
  try {
    if (!origine.ip && !origine.paese) return

    const dal = new Date()
    dal.setDate(dal.getDate() - GIORNI_STORICO)

    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase
      .from('audit_log')
      .select('dettagli')
      .eq('email', email.trim().toLowerCase())
      .eq('azione', 'login')
      .gte('created_at', dal.toISOString())
      .order('created_at', { ascending: false })
      .limit(LOGIN_STORICI_MAX)
    if (error) throw error

    const ipNoti = new Set<string>()
    const paesiNoti = new Set<string>()
    for (const riga of data ?? []) {
      const d = riga.dettagli as { ip?: string; paese?: string } | null
      if (d?.ip) ipNoti.add(d.ip)
      if (d?.paese) paesiNoti.add(d.paese)
    }

    // Nessun accesso precedente con origine: non c'è nulla con cui confrontare.
    if (ipNoti.size === 0 && paesiNoti.size === 0) return

    const paeseNuovo = !!origine.paese && !paesiNoti.has(origine.paese)
    const ipNuovo = !!origine.ip && !ipNoti.has(origine.ip)
    if (!paeseNuovo && !ipNuovo) return

    await registraLog(email, paeseNuovo ? 'login_nuovo_paese' : 'login_nuovo_ip', {
      dettagli: dettagliOrigine(origine),
    })

    if (paeseNuovo) await avvisaUtente(email, origine)
  } catch (e) {
    console.error('controllo accesso inusuale non riuscito:', e)
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function avvisaUtente(email: string, o: Origine): Promise<void> {
  const luogo = [o.citta, o.paese].filter(Boolean).join(', ') || 'luogo non rilevato'
  const quando = new Date().toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
  const righe = [
    `Account: ${email}`,
    `Quando: ${quando}`,
    `Da: ${luogo}`,
    ...(o.ip ? [`Indirizzo IP: ${o.ip}`] : []),
    ...(o.browser ? [`Dispositivo: ${o.browser}`] : []),
  ]

  await inviaEmail({
    a: email,
    cc: AVVISO_CONTROLLO_A && AVVISO_CONTROLLO_A !== email ? [AVVISO_CONTROLLO_A] : undefined,
    oggetto: 'Nuovo accesso al CRM Ronchiverdi da un luogo insolito',
    automazione: 'Avviso di accesso insolito',
    inviataDa: 'automatico',
    testo:
      `È stato effettuato un accesso al CRM Ronchiverdi con il tuo account da un paese ` +
      `da cui non entravi di solito.\n\n${righe.join('\n')}\n\n` +
      `Se sei stato tu, non devi fare nulla. Se non riconosci questo accesso, ` +
      `cambia subito la password e avvisa l'amministratore.`,
    html:
      `<p>È stato effettuato un accesso al CRM Ronchiverdi con il tuo account da un paese ` +
      `da cui non entravi di solito.</p><p>${righe.map(esc).join('<br>')}</p>` +
      `<p>Se sei stato tu, non devi fare nulla. Se non riconosci questo accesso, ` +
      `cambia subito la password e avvisa l'amministratore.</p>`,
  })
}
