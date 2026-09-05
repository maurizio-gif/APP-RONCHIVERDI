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

export type EsitoEmail = { ok: true } | { ok: false; errore: string }

export type Messaggio = {
  a: string
  oggetto: string
  html: string
  // Il corpo testuale non è un di più: senza, alcuni filtri antispam
  // penalizzano il messaggio e i client che non caricano HTML mostrano una
  // pagina vuota.
  testo: string
}

// Non lancia mai: chi chiama decide cosa fare di un invio fallito (di solito
// salvare l'errore accanto al voucher e lasciare che la segreteria rimandi),
// perché il voucher esiste comunque e non va perso per colpa dell'email.
export async function inviaEmail({ a, oggetto, html, testo }: Messaggio): Promise<EsitoEmail> {
  const chiave = process.env.SENDGRID_API_KEY
  if (!chiave) {
    console.error('SENDGRID_API_KEY mancante: email non inviata a', a)
    return { ok: false, errore: 'Invio email non configurato (SENDGRID_API_KEY mancante).' }
  }

  try {
    const risposta = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${chiave}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: a }] }],
        from: { email: MITTENTE_EMAIL, name: MITTENTE_NOME },
        ...(RISPOSTE_A ? { reply_to: { email: RISPOSTE_A } } : {}),
        subject: oggetto,
        content: [
          // L'ordine conta per la specifica MIME: prima il testo, poi l'HTML.
          { type: 'text/plain', value: testo },
          { type: 'text/html', value: html },
        ],
      }),
    })

    // 202 è il successo di SendGrid, con corpo vuoto. Su errore il corpo
    // contiene l'elenco dei problemi: si tiene, perché "invio fallito" senza
    // motivo non aiuta nessuno a rimediare.
    if (risposta.status === 202) return { ok: true }

    const dettaglio = (await risposta.text()).slice(0, 500)
    console.error('SendGrid ha rifiutato l’invio:', risposta.status, dettaglio)
    return { ok: false, errore: `SendGrid ha risposto ${risposta.status}: ${dettaglio || 'nessun dettaglio'}` }
  } catch (e) {
    console.error('SendGrid non raggiungibile:', e)
    return { ok: false, errore: 'Servizio di invio email non raggiungibile.' }
  }
}
