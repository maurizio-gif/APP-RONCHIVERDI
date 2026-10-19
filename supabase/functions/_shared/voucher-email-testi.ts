// I testi delle email al socio sul voucher della visita medica, in un file
// solo: sono comunicazioni condivise con Chiron (i testi reciproci sono
// concordati fra le parti) e devono potersi rileggere tutti insieme.
//
// Questo file lo usano due runtime: il pannello Next.js (lib/voucher-email.ts,
// per «Rimanda email» e per la notifica di utilizzo) e la edge function
// Supabase voucher-automatico (Deno). Per questo non importa nulla e legge le
// variabili d'ambiente da chi le offre: un solo testo, nessuna copia da
// tenere allineata.

function leggiEnv(chiave: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any
  if (g.Deno?.env?.get) return g.Deno.env.get(chiave)
  return g.process?.env?.[chiave]
}

// Recapiti del centro medico: variabili d'ambiente e non costanti nel
// codice, perché il partner è sostituibile, che è il principio dell'intera
// procedura. I default sono i recapiti in vigore: `||` e non `??`, così una
// variabile lasciata vuota non cancella il numero dall'email.
const PARTNER_NOME = leggiEnv('PARTNER_MEDICO_NOME') || 'Chiron'
const PARTNER_TELEFONO = leggiEnv('PARTNER_MEDICO_TELEFONO') || '011 088 2015'
const PARTNER_EMAIL = leggiEnv('PARTNER_MEDICO_EMAIL') ?? ''
const PARTNER_PRENOTAZIONE_URL =
  leggiEnv('PARTNER_MEDICO_PRENOTAZIONE_URL') ||
  'https://app.tuotempo.com/mop/index.php?dbName=tt_giponext_1946&areaTitle=Ronchi%20Verdi'

// Regola del partner sugli spostamenti, citata in entrambe le email.
const LIMITE_SPOSTAMENTO = 'fino alle ore 16.00 del giorno precedente alla visita'

// La casella dove il socio manda il certificato: unica modalità accettata,
// per chiunque, anche per chi la visita l'ha fatta con un medico suo.
const CASELLA_CERTIFICATI = leggiEnv('EMAIL_CERTIFICATI') || 'certificatimedici@ronchiverdi.it'

// L'informativa sul tracciamento, in fondo a ogni email del voucher: le
// email partono con pixel di apertura e link riscritti (lib/voucher-email.ts,
// edge function voucher-automatico), e le Linee guida del Garante sui
// tracking pixel (provv. 284 del 17 aprile 2026, §4) li ammettono solo se il
// destinatario lo sa prima, qualunque sia lo scopo dell'email. Senza
// consenso perché rientrano nella deroga dei messaggi di servizio di cui
// conta l'effettiva presa visione (§5): per questo la frase dice anche che i
// dati non servono ad altro, ed è un impegno da rispettare.
const INFORMATIVA_PRIVACY_URL = leggiEnv('INFORMATIVA_PRIVACY_URL') || 'https://www.ronchiverdi.it/privacy'
const NOTA_TRACCIAMENTO =
  "Per avere conferma che questa comunicazione ti sia arrivata, registriamo l'apertura dell'email (con un'immagine invisibile) e i clic sui link. Usiamo questi dati solo per questo scopo."

// Quello che serve del voucher per scrivere l'email.
export type VoucherEmail = { codice: string; nome: string; cognome: string; valido_fino: string }

export type ContenutoEmail = { oggetto: string; html: string; testo: string }

// Copie delle funzioni di lib/voucher.ts: qui non si importa, vedi sopra.
function formattaCodice(codice: string): string {
  return codice.replace(/(\d{4})(?=\d)/g, '$1 ')
}

function nomeCompleto(voucher: Pick<VoucherEmail, 'nome' | 'cognome'>): string {
  return `${voucher.nome} ${voucher.cognome}`.trim()
}

const FORMATO_DATA = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Europe/Rome',
})

function dataRoma(iso: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso)
  return FORMATO_DATA.format(d)
}

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
<p style="margin:10px 0 0 0;font-size:11px;line-height:1.6;color:rgba(0,0,0,0.5);">
${esc(NOTA_TRACCIAMENTO)} <a href="${esc(INFORMATIVA_PRIVACY_URL)}" style="color:rgba(0,0,0,0.6);">Informativa privacy</a>
</p>
</td></tr></table>
</td></tr></table>
</body></html>`
}

// La stessa nota in fondo alla versione testuale.
function piedeTesto(): string {
  return `\n\n--\n${NOTA_TRACCIAMENTO}\nInformativa privacy: ${INFORMATIVA_PRIVACY_URL}`
}

function paragrafo(testo: string): string {
  return `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.7;color:${INCHIOSTRO};">${testo}</p>`
}

// Il numero cliccabile dal telefono: tel: vuole le sole cifre.
function telHref(numero: string): string {
  return `tel:+39${numero.replace(/\D/g, '')}`
}

function recapitiPartnerHtml(): string {
  const righe = [
    PARTNER_TELEFONO
      ? `Telefono: <a href="${telHref(PARTNER_TELEFONO)}" style="color:${INCHIOSTRO};font-weight:600;text-decoration:none;">${esc(PARTNER_TELEFONO)}</a>`
      : null,
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

// Il pulsante della prenotazione online: tabella e non <a> stilizzato da
// solo, perché Outlook ignora padding e sfondo sui link.
function pulsantePrenotazione(etichetta: string): string {
  if (!PARTNER_PRENOTAZIONE_URL) return ''
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px 0;"><tr><td style="background:${INCHIOSTRO};border-radius:999px;">
<a href="${esc(PARTNER_PRENOTAZIONE_URL)}" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#ffffff;text-decoration:none;">${esc(etichetta)}</a>
</td></tr></table>`
}

// ─────────────────────────────────────────── 1. email di assegnazione

export function emailAssegnazione(voucher: VoucherEmail): ContenutoEmail {
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
      paragrafo(`Puoi prenotare <strong>online</strong> oppure <strong>al telefono</strong>.`),
      `<p style="margin:0 0 8px 0;font-size:15px;line-height:1.7;color:${INCHIOSTRO};"><strong>Online</strong></p>`,
      `<ol style="margin:0 0 14px 0;padding-left:20px;font-size:15px;line-height:1.8;color:${INCHIOSTRO};">
<li style="margin-bottom:6px;">Apri la pagina di prenotazione dal pulsante qui sotto.</li>
<li style="margin-bottom:6px;">Registrati con i tuoi dati. Riceverai un <strong>SMS con un codice di verifica</strong>: inseriscilo dove richiesto per confermare il tuo numero di telefono. <em>Quel codice serve solo alla registrazione: non è il codice del voucher.</em></li>
<li style="margin-bottom:6px;">Scegli la visita, il giorno e l'ora che preferisci.</li>
<li style="margin-bottom:6px;">Nella pagina di riepilogo, prima di confermare, scorri fino a <strong>«Note per questo appuntamento»</strong>, tocca <strong>«Inserisci una nota»</strong> e scrivi il codice del voucher: <strong>${esc(codice)}</strong>.</li>
<li>Premi <strong>«Prenota»</strong>.</li>
</ol>`,
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;"><tr><td style="background:rgba(232,212,106,0.16);border-left:3px solid ${ORO};border-radius:6px;padding:12px 14px;font-size:14px;line-height:1.6;color:${INCHIOSTRO};">
<strong>Attenzione:</strong> il codice del voucher va scritto <strong>solo nel campo «Note»</strong>, alla fine.
</td></tr></table>`,
      pulsantePrenotazione('Prenota online'),
      `<p style="margin:0 0 8px 0;font-size:15px;line-height:1.7;color:${INCHIOSTRO};"><strong>Al telefono</strong></p>`,
      paragrafo(`Chiama ${esc(PARTNER_NOME)} e comunica il tuo codice all'operatore.`),
      recapitiPartnerHtml(),
      `<p style="margin:0 0 10px 0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:${ORO};">Condizioni</p>`,
      `<ul style="margin:0 0 16px 0;padding-left:20px;font-size:15px;line-height:1.8;color:${INCHIOSTRO};">
<li>Il codice vale <strong>una sola volta</strong> e si consuma al momento della prenotazione.</li>
<li>È valido fino al <strong>${esc(scadenza)}</strong>.</li>
<li>L'appuntamento si può spostare <strong>${esc(LIMITE_SPOSTAMENTO)}</strong>.</li>
<li>In caso di mancata presentazione all'appuntamento il codice <strong>non viene riemesso</strong>: se non puoi esserci, sposta o disdici entro quel termine.</li>
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
Puoi prenotare online oppure al telefono.

Online: ${PARTNER_PRENOTAZIONE_URL}
1. Apri la pagina di prenotazione.
2. Registrati con i tuoi dati. Riceverai un SMS con un codice di verifica: inseriscilo dove richiesto per confermare il tuo numero di telefono. Quel codice serve solo alla registrazione: non e' il codice del voucher.
3. Scegli la visita, il giorno e l'ora che preferisci.
4. Nella pagina di riepilogo, prima di confermare, scorri fino a "Note per questo appuntamento", tocca "Inserisci una nota" e scrivi il codice del voucher: ${codice}.
5. Premi "Prenota".

ATTENZIONE: il codice del voucher va scritto solo nel campo "Note", alla fine.

Al telefono: chiama ${PARTNER_NOME} e comunica il tuo codice all'operatore.
${recapitiPartnerTesto()}

CONDIZIONI
- Il codice vale una sola volta e si consuma al momento della prenotazione.
- E' valido fino al ${scadenza}.
- L'appuntamento si puo' spostare ${LIMITE_SPOSTAMENTO}.
- In caso di mancata presentazione il codice non viene riemesso: se non puoi esserci, sposta o disdici entro quel termine.
- Riceverai una nostra email nel momento esatto in cui il codice viene utilizzato.

DOPO LA VISITA
Inviaci il certificato in allegato via email a ${CASELLA_CERTIFICATI}. E' l'unica modalita' di consegna, e vale anche se la visita l'hai fatta con un medico tuo. Se hai solo il cartaceo, passa in reception.

A presto,
Ronchiverdi Sport Club${piedeTesto()}`

  return { oggetto: 'Il tuo voucher per la visita medica inclusa', html, testo }
}

// ────────────────────────────────────── 2. email "voucher utilizzato"

// Parte alla bruciatura, non a fine giornata: è la traccia che rende
// impossibile un uso all'insaputa del socio, e serve solo se arriva subito.
export function emailUtilizzato(voucher: VoucherEmail, quando: string): ContenutoEmail {
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
        `L'appuntamento si può spostare <strong>${esc(LIMITE_SPOSTAMENTO)}</strong>, online o al telefono; in caso di mancata presentazione il voucher non viene riemesso.`
      ),
      pulsantePrenotazione('Gestisci la prenotazione'),
      recapitiPartnerHtml(),
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

L'appuntamento si puo' spostare ${LIMITE_SPOSTAMENTO}, online o al telefono; in caso di mancata presentazione il voucher non viene riemesso.
Online: ${PARTNER_PRENOTAZIONE_URL}
${recapitiPartnerTesto()}

Non hai prenotato tu? Rispondi a questa email: controlliamo subito.

Dopo la visita, inviaci il certificato in allegato a ${CASELLA_CERTIFICATI}.

Ronchiverdi Sport Club${piedeTesto()}`

  return { oggetto: 'Il tuo voucher per la visita medica è stato utilizzato', html, testo }
}
