// Edge function: gli esiti delle email dal SendGrid Event Webhook.
//
// SendGrid manda qui, a gruppi, gli eventi di ogni email: presa in carico,
// consegna (con la risposta del server del destinatario), rinvio, rimbalzo,
// scarto, apertura, click, segnalazione di spam. Si salvano in
// `email_eventi` e si agganciano alle email del CRM (`email_inviate`) per
// X-Message-Id: la scheda del socio, il voucher, il tracking e la prova di
// invio li leggono da lì (scripts/sql/2026-10-16-tracking-email.sql).
//
// Firma: con il «Signed Event Webhook» attivo, SendGrid firma ogni invio
// (ECDSA P-256 su timestamp + corpo). Se il secret
// SENDGRID_EVENTI_CHIAVE_PUBBLICA è impostato, una firma non valida viene
// respinta con 401; senza chiave gli eventi si salvano lo stesso ma segnati
// `firmato = false`, e la prova di invio lo dice.
//
// Filtro: l'account SendGrid può servire anche altro. Si tengono solo gli
// eventi delle email del CRM, riconosciute dal custom arg `app` o
// dall'X-Message-Id già registrato.
//
// IP e user agent delle aperture si scartano prima di salvare: non servono
// alla prova e sono dati personali in più.
//
// Si pubblica con verify_jwt = false: SendGrid non ha un JWT di Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2.114.0'

const APP_EMAIL = 'crm-ronchiverdi'

const EVENTI = new Set([
  'processed',
  'delivered',
  'deferred',
  'bounce',
  'dropped',
  'open',
  'click',
  'spamreport',
  'unsubscribe',
  'group_unsubscribe',
  'group_resubscribe',
])

function base64(testo: string): Uint8Array {
  return Uint8Array.from(atob(testo), (c) => c.charCodeAt(0))
}

// SendGrid firma in DER (SEQUENCE di due INTEGER), WebCrypto vuole r||s
// grezzi da 32 byte ciascuno.
function derInRaw(der: Uint8Array): Uint8Array | null {
  let i = 0
  if (der[i++] !== 0x30) return null
  if (der[i] & 0x80) i += 1 + (der[i] & 0x7f)
  else i++
  const parti: Uint8Array[] = []
  for (let k = 0; k < 2; k++) {
    if (der[i++] !== 0x02) return null
    const lunghezza = der[i++]
    let intero = der.slice(i, i + lunghezza)
    i += lunghezza
    while (intero.length > 32 && intero[0] === 0) intero = intero.slice(1)
    if (intero.length > 32) return null
    const pieno = new Uint8Array(32)
    pieno.set(intero, 32 - intero.length)
    parti.push(pieno)
  }
  const raw = new Uint8Array(64)
  raw.set(parti[0], 0)
  raw.set(parti[1], 32)
  return raw
}

let chiaveImportata: CryptoKey | null = null

async function firmaValida(req: Request, corpo: string, chiave: string): Promise<boolean> {
  const firma = req.headers.get('x-twilio-email-event-webhook-signature')
  const ts = req.headers.get('x-twilio-email-event-webhook-timestamp')
  if (!firma || !ts) return false
  const raw = derInRaw(base64(firma))
  if (!raw) return false
  try {
    chiaveImportata ??= await crypto.subtle.importKey(
      'spki',
      base64(chiave),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      chiaveImportata,
      raw,
      new TextEncoder().encode(ts + corpo)
    )
  } catch {
    return false
  }
}

// Quello che serve leggere nella prova: motivo, risposta SMTP del server del
// destinatario, codice di stato, link cliccato.
function dettaglio(e: Record<string, unknown>): string | null {
  const parti = [e.type, e.reason, e.response, e.status, e.url]
    .filter((x) => x !== undefined && x !== null && String(x).trim() !== '')
    .map((x) => String(x).trim().slice(0, 300))
  return parti.length ? parti.join(' · ') : null
}

function rispondi(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return rispondi({ ok: false, errore: 'Solo POST' }, 405)

  const corpo = await req.text()
  const chiave = (Deno.env.get('SENDGRID_EVENTI_CHIAVE_PUBBLICA') ?? '').trim()
  let firmato = false
  if (chiave) {
    firmato = await firmaValida(req, corpo, chiave)
    if (!firmato) return new Response('Firma non valida', { status: 401 })
  }

  let eventi: Record<string, unknown>[]
  try {
    const letto = JSON.parse(corpo)
    eventi = Array.isArray(letto) ? letto : []
  } catch {
    return rispondi({ ok: false, errore: 'JSON non valido' }, 400)
  }

  const righe = eventi
    .filter((e) => e && EVENTI.has(String(e.event)) && e.sg_message_id && Number(e.timestamp))
    .slice(0, 1000)
    .map((e) => {
      // L'X-Message-Id salvato all'invio è la parte prima del primo punto.
      const msg = String(e.sg_message_id).split('.')[0]
      const { ip: _ip, useragent: _ua, ...resto } = e
      return {
        provider: 'sendgrid',
        provider_message_id: msg,
        evento_id: e.sg_event_id ? String(e.sg_event_id) : null,
        evento: String(e.event),
        momento: new Date(Number(e.timestamp) * 1000).toISOString(),
        destinatario: e.email ? String(e.email).toLowerCase().trim() : null,
        dettaglio: dettaglio(e),
        firmato,
        grezzo: resto,
        nostro: e.app === APP_EMAIL,
      }
    })

  if (righe.length === 0) return rispondi({ ok: true, scritti: 0, scartati: eventi.length })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  // Gli eventi senza il segno del CRM si tengono solo se l'X-Message-Id è
  // di un'email registrata (per esempio inviata prima del segno).
  const daControllare = [...new Set(righe.filter((r) => !r.nostro).map((r) => r.provider_message_id))]
  let conosciuti = new Set<string>()
  if (daControllare.length) {
    const { data, error } = await supabase
      .from('email_inviate')
      .select('provider_message_id')
      .in('provider_message_id', daControllare)
    if (error) return rispondi({ ok: false, errore: error.message }, 500)
    conosciuti = new Set((data ?? []).map((r: { provider_message_id: string }) => r.provider_message_id))
  }

  const tenute = righe
    .filter((r) => r.nostro || conosciuti.has(r.provider_message_id))
    .map(({ nostro: _n, ...r }) => r)

  if (tenute.length) {
    // SendGrid può rimandare lo stesso gruppo: l'unico su evento_id lo
    // rende innocuo.
    const { error } = await supabase
      .from('email_eventi')
      .upsert(tenute, { onConflict: 'evento_id', ignoreDuplicates: true })
    // Un errore del database risponde 500: SendGrid riprova più tardi.
    if (error) return rispondi({ ok: false, errore: error.message }, 500)
  }

  return rispondi({ ok: true, scritti: tenute.length, scartati: eventi.length - tenute.length, firmato })
})
