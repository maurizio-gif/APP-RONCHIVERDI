import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'

// Invio email transazionali via SendGrid.
//
// Server-only: la chiave API sta in SENDGRID_API_KEY, che non è NEXT_PUBLIC_
// e non deve mai finire nel bundle del browser. Importare solo da Server
// Action, Server Component o Route Handler.
//
// Perché fetch e non @sendgrid/mail: serve una sola chiamata HTTP, e la
// libreria ufficiale porterebbe una dipendenza (con il suo aggiornamento da
// seguire) per fare esattamente questo POST. Su Vercel gira dentro la
// funzione della Server Action, senza servizi in mezzo.
//
// Ogni invio, riuscito o no, finisce in `email_inviate` con il testo
// integrale e l'X-Message-Id di SendGrid: è il tracking email e la base
// della prova di invio (scripts/sql/2026-10-16-tracking-email.sql).

const ENDPOINT = 'https://api.sendgrid.com/v3/mail/send'

// Mittente verificato su SendGrid (Sender Authentication): un indirizzo non
// verificato fa rifiutare la chiamata con 403, non arriva "in spam".
// Cambiare questo default senza verificare prima il nuovo indirizzo su
// SendGrid ferma tutti gli invii.
const MITTENTE_EMAIL = process.env.SENDGRID_FROM_EMAIL ?? 'digital@ronchiverdi.it'
const MITTENTE_NOME = process.env.SENDGRID_FROM_NAME ?? 'Ronchiverdi Sport Club'

// Dove il socio risponde se ha bisogno di qualcosa. E' una variabile a parte
// dal mittente proprio perche' le due caselle non devono per forza coincidere:
// il mittente lo decide SendGrid (dev'essere verificato), la casella delle
// risposte la decide il Club (dev'essere presidiata). Il socio scrive a
// info@; quando i certificati avranno la loro casella, qui va quella — le
// risposte a un voucher ("non ho prenotato io") sono la comunicazione piu'
// urgente del flusso e non devono restare sepolte fra le altre.
const RISPOSTE_A = process.env.EMAIL_REPLY_TO ?? 'info@ronchiverdi.it'

// Il segno con cui il webhook degli eventi riconosce le email del CRM fra
// quelle dell'account SendGrid (vedi supabase/functions/email-eventi).
export const APP_EMAIL = 'crm-ronchiverdi'

export type EsitoEmail = { ok: true; emailId?: string } | { ok: false; errore: string; emailId?: string }

export type Messaggio = {
  a: string
  // In copia conoscenza, visibile a tutti i destinatari (non ccn): usata dai
  // report automatici che devono raggiungere anche chi segue il progetto,
  // non solo il destinatario principale.
  cc?: string[]
  oggetto: string
  html: string
  // Il corpo testuale non è un di più: senza, alcuni filtri antispam
  // penalizzano il messaggio e i client che non caricano HTML mostrano una
  // pagina vuota.
  testo: string
  // Che cosa è, in parole: è il «tipo» nel tracking («Voucher: codice
  // assegnato», «Resoconto direzionale»…).
  automazione: string
  // Tracciamento di aperture e click (pixel e link riscritti da SendGrid):
  // solo per le comunicazioni ai soci, mai per le email d'accesso — il
  // click tracking riscriverebbe anche i loro link.
  traccia?: boolean
  // A chi e a cosa si riferisce, per ritrovarla nella scheda del socio e
  // nella sezione da cui è partita. Il socio, se manca, lo trova il database
  // dal voucher o dall'indirizzo.
  personaId?: string | null
  voucherId?: string | null
  // L'operatore che l'ha fatta partire, o «automatico».
  inviataDa?: string | null
}

// Non lancia mai: chi chiama decide cosa fare di un invio fallito (di solito
// salvare l'errore accanto al voucher e lasciare che la segreteria rimandi),
// perché il voucher esiste comunque e non va perso per colpa dell'email.
export async function inviaEmail(m: Messaggio): Promise<EsitoEmail> {
  const chiave = process.env.SENDGRID_API_KEY
  if (!chiave) {
    console.error('SENDGRID_API_KEY mancante: email non inviata a', m.a)
    const errore = 'Invio email non configurato (SENDGRID_API_KEY mancante).'
    return { ok: false, errore, emailId: await registra(m, { messageId: null, errore }) }
  }

  const riferimenti: Record<string, string> = { app: APP_EMAIL, automazione: m.automazione.slice(0, 200) }
  if (m.voucherId) riferimenti.voucher_id = m.voucherId

  try {
    const risposta = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${chiave}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          { to: [{ email: m.a }], ...(m.cc?.length ? { cc: m.cc.map((email) => ({ email })) } : {}) },
        ],
        from: { email: MITTENTE_EMAIL, name: MITTENTE_NOME },
        ...(RISPOSTE_A ? { reply_to: { email: RISPOSTE_A } } : {}),
        subject: m.oggetto,
        // Esplicito in entrambi i sensi: senza, varrebbe l'impostazione
        // dell'account SendGrid, che si può cambiare da lì senza saperlo.
        // I link del solo testo non si riscrivono: diventerebbero illeggibili.
        tracking_settings: {
          open_tracking: { enable: !!m.traccia },
          click_tracking: { enable: !!m.traccia, enable_text: false },
        },
        // Tornano in ogni evento del webhook: dicono che l'email è del CRM
        // e a quale voucher appartiene.
        custom_args: riferimenti,
        content: [
          // L'ordine conta per la specifica MIME: prima il testo, poi l'HTML.
          { type: 'text/plain', value: m.testo },
          { type: 'text/html', value: m.html },
        ],
      }),
    })

    // 202 è il successo di SendGrid, con corpo vuoto. Su errore il corpo
    // contiene l'elenco dei problemi: si tiene, perché "invio fallito" senza
    // motivo non aiuta nessuno a rimediare.
    if (risposta.status === 202) {
      // L'X-Message-Id è la chiave con cui SendGrid riporta gli eventi.
      const messageId = risposta.headers.get('x-message-id')
      return { ok: true, emailId: await registra(m, { messageId, errore: null }) }
    }

    const dettaglio = (await risposta.text()).slice(0, 500)
    console.error('SendGrid ha rifiutato l’invio:', risposta.status, dettaglio)
    const errore = `SendGrid ha risposto ${risposta.status}: ${dettaglio || 'nessun dettaglio'}`
    return { ok: false, errore, emailId: await registra(m, { messageId: null, errore }) }
  } catch (e) {
    console.error('SendGrid non raggiungibile:', e)
    const errore = 'Servizio di invio email non raggiungibile.'
    return { ok: false, errore, emailId: await registra(m, { messageId: null, errore }) }
  }
}

// La registrazione non deve mai far fallire l'invio che è già partito: se il
// database non risponde resta una riga in meno nel tracking, non un'email
// persa.
async function registra(
  m: Messaggio,
  invio: { messageId: string | null; errore: string | null }
): Promise<string | undefined> {
  try {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase
      .from('email_inviate')
      .insert({
        automazione: m.automazione,
        mittente: MITTENTE_EMAIL,
        mittente_nome: MITTENTE_NOME,
        rispondi_a: RISPOSTE_A || null,
        destinatario: m.a,
        cc: m.cc?.length ? m.cc : null,
        oggetto: m.oggetto,
        corpo_html: m.html,
        corpo_testo: m.testo,
        provider_message_id: invio.messageId,
        esito: invio.errore ? 'errore' : 'inviata',
        errore: invio.errore,
        tracciata: !!m.traccia,
        persona_id: m.personaId ?? null,
        voucher_id: m.voucherId ?? null,
        inviata_da: m.inviataDa ?? null,
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  } catch (e) {
    console.error('Email inviata ma non registrata nel tracking:', e)
    return undefined
  }
}
