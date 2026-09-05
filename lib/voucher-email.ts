import { inviaEmail, type EsitoEmail } from '@/lib/email'
import { dataRoma, formattaCodice, nomeCompleto, type Voucher } from '@/lib/voucher'

// I testi delle email al socio, in un file solo: sono comunicazioni
// condivise con Chiron (i testi reciproci sono concordati fra le parti) e
// devono potersi rileggere tutti insieme, senza cercarli dentro le azioni.
//
// Server-only: importa lib/email, che legge la chiave SendGrid.

// Recapiti del centro medico: variabili d'ambiente e non costanti nel
// codice, perché un cambio di numero non deve richiedere un deploy — e
// perché il partner è sostituibile, che è il principio dell'intera
// procedura.
const PARTNER_NOME = process.env.PARTNER_MEDICO_NOME ?? 'Chiron'
const PARTNER_TELEFONO = process.env.PARTNER_MEDICO_TELEFONO ?? ''
const PARTNER_EMAIL = process.env.PARTNER_MEDICO_EMAIL ?? ''

// La casella dove il socio manda il certificato: unica modalità accettata,
// per chiunque, anche per chi la visita l'ha fatta con un medico suo.
const CASELLA_CERTIFICATI = process.env.EMAIL_CERTIFICATI ?? 'certificatimedici@ronchiverdi.it'

const ORO = '#8b6c14'
const INCHIOSTRO = '#1c1c18'
const CARTA = '#f7f6f2'

function esc(testo: string): string {
  return testo
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Il guscio grafico, uguale per tutte le email del voucher: tabella e stili
// in linea perché è l'unica cosa che i client di posta rendono allo stesso
// modo — Outlook non applica un <style> nel <head>.
function guscio(titolo: string, corpo: string): string {
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(titolo)}</title></head>
<body style="margin:0;padding:24px 12px;background:${CARTA};font-family:'Jost',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INCHIOSTRO};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;background:#ffffff;border:1px solid rgba(0,0,0,0.12);border-radius:14px;">
<tr><td style="padding:32px 36px 8px 36px;">
<p style="margin:0 0 26px 0;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:${ORO};">Ronchiverdi Sport Club</p>
${corpo}
</td></tr>
<tr><td style="padding:8px 36px 30px 36px;">
<p style="margin:26px 0 0 0;padding-top:18px;border-top:1px solid rgba(0,0,0,0.1);font-size:12px;line-height:1.7;color:rgba(0,0,0,0.55);">
Ronchiverdi Sport Club &middot; Corso Moncalieri 466, Torino<br>
Messaggio automatico: per assistenza rispondi a questa email.
</p>
</td></tr></table>
</td></tr></table>
</body></html>`
}

function paragrafo(testo: string): string {
  return `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.7;color:${INCHIOSTRO};">${testo}</p>`
}

function recapitiPartnerHtml(): string {
  const righe = [
    PARTNER_TELEFONO ? `Telefono: <strong>${esc(PARTNER_TELEFONO)}</strong>` : null,
    PARTNER_EMAIL ? `Email: <strong>${esc(PARTNER_EMAIL)}</strong>` : null,
  ].filter(Boolean)
  if (!righe.length) return ''
  return `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.8;color:${INCHIOSTRO};">${esc(PARTNER_NOME)}<br>${righe.join('<br>')}</p>`
}

function recapitiPartnerTesto(): string {
  return [
    PARTNER_NOME,
    PARTNER_TELEFONO ? `Telefono: ${PARTNER_TELEFONO}` : null,
    PARTNER_EMAIL ? `Email: ${PARTNER_EMAIL}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

// ─────────────────────────────────────────── 1. email di assegnazione

export function emailAssegnazione(voucher: Voucher): { oggetto: string; html: string; testo: string } {
  const codice = formattaCodice(voucher.codice)
  const scadenza = dataRoma(voucher.valido_fino)

  const html = guscio(
    'Il tuo voucher per la visita medica',
    [
      `<h1 style="margin:0 0 18px 0;font-family:'Cormorant Garamond',Georgia,serif;font-weight:400;font-size:30px;line-height:1.2;color:${INCHIOSTRO};">La visita medica è inclusa nel tuo abbonamento</h1>`,
      paragrafo(`Ciao ${esc(voucher.nome)},`),
      paragrafo(
        `con il tuo abbonamento hai diritto alla <strong>visita medico&#8209;sportiva in omaggio</strong> presso ${esc(PARTNER_NOME)}. Ecco il codice da comunicare al momento della prenotazione.`
      ),
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px 0;"><tr><td align="center" style="background:rgba(232,212,106,0.16);border:1px solid rgba(200,170,60,0.55);border-radius:12px;padding:22px 16px;">
<p style="margin:0 0 8px 0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${ORO};">Il tuo codice</p>
<p style="margin:0;font-size:34px;letter-spacing:0.14em;font-weight:600;color:${INCHIOSTRO};">${esc(codice)}</p>
<p style="margin:10px 0 0 0;font-size:13px;color:rgba(0,0,0,0.7);">Intestato a ${esc(nomeCompleto(voucher))} &middot; valido fino al ${esc(scadenza)}</p>
</td></tr></table>`,
      `<p style="margin:0 0 10px 0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:${ORO};">Come prenotare</p>`,
      paragrafo(
        `Chiama ${esc(PARTNER_NOME)} e comunica il codice: la prenotazione si fa <strong>al telefono</strong>, non serve nessun portale.`
      ),
      recapitiPartnerHtml(),
      `<p style="margin:0 0 10px 0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:${ORO};">Condizioni</p>`,
      `<ul style="margin:0 0 16px 0;padding-left:20px;font-size:15px;line-height:1.8;color:${INCHIOSTRO};">
<li>Il codice vale <strong>una sola volta</strong> e si consuma al momento della prenotazione.</li>
<li>È valido fino al <strong>${esc(scadenza)}</strong>.</li>
<li>In caso di mancata presentazione all'appuntamento il codice <strong>non viene riemesso</strong>: se non puoi esserci, disdici per tempo con ${esc(PARTNER_NOME)}.</li>
<li>Riceverai una nostra email nel momento esatto in cui il codice viene utilizzato.</li>
</ul>`,
      `<p style="margin:0 0 10px 0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:${ORO};">Dopo la visita</p>`,
      paragrafo(
        `Inviaci il certificato <strong>in allegato via email</strong> a <strong>${esc(CASELLA_CERTIFICATI)}</strong>. È l'unica modalità di consegna, e vale anche se la visita l'hai fatta con un medico tuo. Se hai solo il cartaceo, passa in reception: lo fotografiamo e lo inviamo insieme a te.`
      ),
      paragrafo('A presto,<br>Ronchiverdi Sport Club'),
    ].join('')
  )

  const testo = `Ciao ${voucher.nome},

con il tuo abbonamento hai diritto alla visita medico-sportiva in omaggio presso ${PARTNER_NOME}.

IL TUO CODICE: ${codice}
Intestato a ${nomeCompleto(voucher)} - valido fino al ${scadenza}

COME PRENOTARE
Chiama ${PARTNER_NOME} e comunica il codice: la prenotazione si fa al telefono, non serve nessun portale.
${recapitiPartnerTesto()}

CONDIZIONI
- Il codice vale una sola volta e si consuma al momento della prenotazione.
- E' valido fino al ${scadenza}.
- In caso di mancata presentazione il codice non viene riemesso: se non puoi esserci, disdici per tempo.
- Riceverai una nostra email nel momento esatto in cui il codice viene utilizzato.

DOPO LA VISITA
Inviaci il certificato in allegato via email a ${CASELLA_CERTIFICATI}. E' l'unica modalita' di consegna, e vale anche se la visita l'hai fatta con un medico tuo. Se hai solo il cartaceo, passa in reception.

A presto,
Ronchiverdi Sport Club`

  return { oggetto: 'Il tuo voucher per la visita medica inclusa', html, testo }
}

// ────────────────────────────────────── 2. email "voucher utilizzato"

// Parte alla bruciatura, non a fine giornata: è la traccia che rende
// impossibile un uso all'insaputa del socio, e serve solo se arriva subito.
export function emailUtilizzato(voucher: Voucher, quando: string): { oggetto: string; html: string; testo: string } {
  const codice = formattaCodice(voucher.codice)

  const html = guscio(
    'Voucher utilizzato',
    [
      `<h1 style="margin:0 0 18px 0;font-family:'Cormorant Garamond',Georgia,serif;font-weight:400;font-size:30px;line-height:1.2;color:${INCHIOSTRO};">Il tuo voucher è stato utilizzato</h1>`,
      paragrafo(`Ciao ${esc(voucher.nome)},`),
      paragrafo(
        `il codice <strong>${esc(codice)}</strong> è stato utilizzato da ${esc(PARTNER_NOME)} il <strong>${esc(quando)}</strong> per prenotare la tua visita medico&#8209;sportiva. Da questo momento il codice non è più spendibile.`
      ),
      paragrafo(
        `Riceverai da ${esc(PARTNER_NOME)} la conferma scritta con giorno e ora dell'appuntamento. In caso di mancata presentazione il voucher non viene riemesso.`
      ),
      paragrafo(
        `<strong>Non hai prenotato tu?</strong> Rispondi a questa email: controlliamo subito.`
      ),
      paragrafo(
        `Dopo la visita, inviaci il certificato in allegato a <strong>${esc(CASELLA_CERTIFICATI)}</strong>.`
      ),
      paragrafo('Ronchiverdi Sport Club'),
    ].join('')
  )

  const testo = `Ciao ${voucher.nome},

il codice ${codice} e' stato utilizzato da ${PARTNER_NOME} il ${quando} per prenotare la tua visita medico-sportiva. Da questo momento il codice non e' piu' spendibile.

Riceverai da ${PARTNER_NOME} la conferma scritta con giorno e ora dell'appuntamento. In caso di mancata presentazione il voucher non viene riemesso.

Non hai prenotato tu? Rispondi a questa email: controlliamo subito.

Dopo la visita, inviaci il certificato in allegato a ${CASELLA_CERTIFICATI}.

Ronchiverdi Sport Club`

  return { oggetto: 'Il tuo voucher per la visita medica è stato utilizzato', html, testo }
}

// ───────────────────────────────────────────────────────── spedizione

export async function inviaEmailAssegnazione(voucher: Voucher): Promise<EsitoEmail> {
  const { oggetto, html, testo } = emailAssegnazione(voucher)
  return inviaEmail({ a: voucher.email, oggetto, html, testo })
}

export async function inviaEmailUtilizzato(voucher: Voucher, quando: string): Promise<EsitoEmail> {
  const { oggetto, html, testo } = emailUtilizzato(voucher, quando)
  return inviaEmail({ a: voucher.email, oggetto, html, testo })
}
