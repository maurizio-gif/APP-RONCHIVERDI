// Edge function: il codice della visita medica a chi ha comprato prima del
// 1° novembre 2026.
//
// Lavora sulla lista `voucher_recupero` (scripts/sql/2026-11-10-voucher-
// recupero-pre-novembre.sql), già verificata e con le esclusioni decise: qui
// non si sceglie chi riceve il codice, si spedisce a chi è `da_inviare`. A
// ogni chiamata prende un lotto (voucher_recupero_prendi), emette il voucher
// collegato alla vendita della visita, manda l'email di assegnazione di sempre
// con una premessa che spiega perché il codice arriva adesso, e segna l'esito
// sulla riga. La chiama pg_cron ogni 10 minuti (job `voucher-recupero`) solo a
// interruttore `voucher_recupero` acceso; il controllo è ripetuto qui. A lista
// finita la function spegne l'interruttore da sola.
//
// Autenticazione come voucher-automatico: header `x-cron-token`, verificato
// nel database (verifica_token_cron). Si pubblica con verify_jwt = false.
//
// Parametri:
//   ?lotto=N        quante righe per chiamata (default 25, massimo 50);
//   ?prova=1        riepilogo della lista e prossime righe in coda, senza
//                   emettere né inviare nulla, anche a interruttore spento;
//   ?anteprima=EMAIL  manda a EMAIL l'email com'è, con un codice finto
//                   (0000 0000) e un nome d'esempio: nessun voucher, nessun
//                   tracking. Funziona anche a interruttore spento.
//
// Il socio senza email valida riceve il voucher senza invio (`senza_email`):
// il CRM lo mostra «Manca email» e la segreteria lo spedisce da lì. Un'email
// che SendGrid rifiuta lascia il voucher valido con l'errore salvato
// (`errore`), e il pulsante «Reinvia email» del CRM.
//
// L'invio (SendGrid, tracking, esito sul voucher) è lo stesso di
// voucher-automatico, copiato qui per non toccare una function in produzione.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.114.0'
import { emailAssegnazione, premessaRecuperoPreNovembre } from '../_shared/voucher-email-testi.ts'

const CHIAVE_AUTOMAZIONE = 'voucher_recupero'
const EMESSO_DA = 'Recupero pre-novembre'
const LOTTO_DEFAULT = 25
const LOTTO_MASSIMO = 50
const MESI_VALIDITA = 12
const CIFRE_CODICE = 8
const TENTATIVI_CODICE = 5
// Una pausa fra un invio e l'altro: SendGrid non ne ha bisogno, ma 25 email
// in fila dallo stesso mittente si leggono meglio come posta di servizio.
const PAUSA_MS = 300

const COLONNE =
  'id, codice, tipo, nome, cognome, email, telefono, note, stato, emesso_da, created_at, valido_fino, email_inviata_il, email_invii, email_errore'

// Lo stesso «tipo» delle email di assegnazione del pannello e dell'automatico:
// così «Reinvia email» del CRM ritrova questa email e la rimanda identica,
// premessa compresa.
const AUTOMAZIONE = 'Voucher: codice assegnato'

const MITTENTE_EMAIL = Deno.env.get('SENDGRID_FROM_EMAIL') || 'digital@ronchiverdi.it'
const MITTENTE_NOME = Deno.env.get('SENDGRID_FROM_NAME') || 'Ronchiverdi Sport Club'
const RISPOSTE_A = Deno.env.get('EMAIL_REPLY_TO') || 'info@ronchiverdi.it'

type Supabase = SupabaseClient

type Voucher = {
  id: string
  codice: string
  nome: string
  cognome: string
  email: string
  valido_fino: string
  email_invii: number
  email_errore: string | null
}

type Riga = {
  id: string
  riga_file: number | null
  abbonamento_id: string
  persona_id: string | null
  data_vendita: string
  nome: string
  cognome: string
  email: string
  telefono: string | null
  dettaglio: string | null
}

type Esito = { riga: number | null; stato: string; dettaglio?: string }

type EsitoInvio = { ok: true; messageId: string | null } | { ok: false; errore: string }

function rispondi(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}

const attendi = (ms: number) => new Promise((r) => setTimeout(r, ms))

function generaCodice(): string {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return String(buffer[0] % 10 ** CIFRE_CODICE).padStart(CIFRE_CODICE, '0')
}

function dataScadenza(): string {
  const scadenza = new Date()
  scadenza.setMonth(scadenza.getMonth() + MESI_VALIDITA)
  return scadenza.toISOString().slice(0, 10)
}

const emailValida = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

function contenuto(voucher: Voucher) {
  return emailAssegnazione(voucher, { premessa: premessaRecuperoPreNovembre() })
}

async function inviaEmail(
  a: string,
  testo: { oggetto: string; html: string; testo: string },
  voucherId: string | null
): Promise<EsitoInvio> {
  const chiave = Deno.env.get('SENDGRID_API_KEY')
  if (!chiave) return { ok: false, errore: 'Invio email non configurato (SENDGRID_API_KEY mancante).' }
  try {
    const risposta = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chiave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: a }] }],
        from: { email: MITTENTE_EMAIL, name: MITTENTE_NOME },
        reply_to: { email: RISPOSTE_A },
        subject: testo.oggetto,
        tracking_settings: {
          open_tracking: { enable: true },
          click_tracking: { enable: true, enable_text: false },
        },
        custom_args: voucherId
          ? { app: 'crm-ronchiverdi', automazione: AUTOMAZIONE, voucher_id: voucherId }
          : { app: 'crm-ronchiverdi', automazione: 'Voucher: anteprima recupero' },
        content: [
          { type: 'text/plain', value: testo.testo },
          { type: 'text/html', value: testo.html },
        ],
      }),
    })
    if (risposta.status === 202) return { ok: true, messageId: risposta.headers.get('x-message-id') }
    const dettaglio = (await risposta.text()).slice(0, 500)
    return { ok: false, errore: `SendGrid ha risposto ${risposta.status}: ${dettaglio || 'nessun dettaglio'}` }
  } catch (_e) {
    return { ok: false, errore: 'Servizio di invio email non raggiungibile.' }
  }
}

// Email, tracking ed esito sul voucher, come spedisciVoucher di
// voucher-automatico.
async function spedisciVoucher(supabase: Supabase, voucher: Voucher): Promise<EsitoInvio> {
  const testo = contenuto(voucher)
  const esitoEmail = await inviaEmail(voucher.email, testo, voucher.id)

  const { error: errTracking } = await supabase.from('email_inviate').insert({
    automazione: AUTOMAZIONE,
    mittente: MITTENTE_EMAIL,
    mittente_nome: MITTENTE_NOME,
    rispondi_a: RISPOSTE_A,
    destinatario: voucher.email,
    oggetto: testo.oggetto,
    corpo_html: testo.html,
    corpo_testo: testo.testo,
    provider_message_id: esitoEmail.ok ? esitoEmail.messageId : null,
    esito: esitoEmail.ok ? 'inviata' : 'errore',
    errore: esitoEmail.ok ? null : esitoEmail.errore,
    tracciata: true,
    voucher_id: voucher.id,
    inviata_da: 'automatico',
  })
  if (errTracking) console.error('Email inviata ma non registrata nel tracking:', errTracking.message)
  await supabase
    .from('voucher')
    .update(
      esitoEmail.ok
        ? { email_inviata_il: new Date().toISOString(), email_invii: voucher.email_invii + 1, email_errore: null }
        : { email_errore: esitoEmail.errore }
    )
    .eq('id', voucher.id)
  return esitoEmail
}

async function chiudiRiga(
  supabase: Supabase,
  riga: Riga,
  campi: { stato: string; motivo?: string | null; dettaglio?: string | null; voucher_id?: string | null }
) {
  const { error } = await supabase
    .from('voucher_recupero')
    .update({ ...campi, elaborato_il: new Date().toISOString() })
    .eq('id', riga.id)
  if (error) console.error('Esito non salvato sulla riga', riga.riga_file, error.message)
}

// Il voucher della riga: quello già nato da un giro interrotto, se c'è
// (l'indice unico su abbonamento_id ne garantisce uno solo), o uno nuovo.
async function voucherDellaRiga(
  supabase: Supabase,
  riga: Riga,
  email: string
): Promise<{ voucher: Voucher; nuovo: boolean } | { errore: string }> {
  const { data: esistente } = await supabase
    .from('voucher')
    .select(COLONNE)
    .eq('abbonamento_id', riga.abbonamento_id)
    .maybeSingle()
  if (esistente) return { voucher: esistente as Voucher, nuovo: false }

  const venduta = new Date(riga.data_vendita).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })
  const note = [`VISITA MEDICA venduta il ${venduta}`, 'recupero pre-novembre', riga.dettaglio]
    .filter(Boolean)
    .join(' · ')

  let ultimoErrore = ''
  for (let tentativo = 0; tentativo < TENTATIVI_CODICE; tentativo++) {
    const { data, error } = await supabase
      .from('voucher')
      .insert({
        codice: generaCodice(),
        tipo: 'visita_medica',
        nome: riga.nome,
        cognome: riga.cognome,
        email,
        telefono: riga.telefono,
        note,
        valido_fino: dataScadenza(),
        emesso_da: EMESSO_DA,
        abbonamento_id: riga.abbonamento_id,
      })
      .select(COLONNE)
      .single()
    if (!error) return { voucher: data as Voucher, nuovo: true }
    ultimoErrore = error.message
    // Collisione sulla vendita: un'altra chiamata l'ha appena emesso.
    if (error.message.includes('voucher_abbonamento_unico')) {
      const { data: riletto } = await supabase.from('voucher').select(COLONNE).eq('abbonamento_id', riga.abbonamento_id).maybeSingle()
      if (riletto) return { voucher: riletto as Voucher, nuovo: false }
    }
    if (error.code !== '23505') break
  }
  return { errore: ultimoErrore || 'Voucher non creato.' }
}

async function elabora(supabase: Supabase, riga: Riga): Promise<Esito> {
  if (!riga.nome || !riga.cognome) {
    await chiudiRiga(supabase, riga, { stato: 'escluso', motivo: 'dati_mancanti', dettaglio: 'Nome o cognome mancante.' })
    return { riga: riga.riga_file, stato: 'escluso', dettaglio: 'dati_mancanti' }
  }

  // Ricontrollo all'ultimo momento: fra il caricamento e l'invio il socio può
  // aver ricevuto il codice automatico di un rinnovo, o uno dato a mano.
  // Due ricerche: per nome (anche i voucher dati a mano, senza vendita) e per
  // persona (i codici automatici, collegati a una sua vendita). Quello di
  // questa stessa vendita non conta: è un giro interrotto da riprendere.
  const protetto = (t: string) => t.replace(/[\\%_]/g, '\\$&')
  const [perNome, perPersona] = await Promise.all([
    supabase
      .from('voucher')
      .select('id, abbonamento_id')
      .neq('stato', 'annullato')
      .ilike('nome', protetto(riga.nome))
      .ilike('cognome', protetto(riga.cognome))
      .limit(5),
    riga.persona_id
      ? supabase
          .from('voucher')
          .select('id, abbonamento_id, abbonamenti!inner(persona_id)')
          .neq('stato', 'annullato')
          .eq('abbonamenti.persona_id', riga.persona_id)
          .limit(5)
      : Promise.resolve({ data: [] }),
  ])
  const altro = [...(perNome.data ?? []), ...(perPersona.data ?? [])].find(
    (v: { abbonamento_id: string | null }) => v.abbonamento_id !== riga.abbonamento_id
  ) as { id: string } | undefined
  if (altro) {
    await chiudiRiga(supabase, riga, {
      stato: 'escluso',
      motivo: 'voucher_gia_presente',
      dettaglio: 'Voucher emesso dopo il caricamento della lista.',
      voucher_id: altro.id,
    })
    return { riga: riga.riga_file, stato: 'escluso', dettaglio: 'voucher_gia_presente' }
  }

  const email = riga.email.trim().toLowerCase()
  const senzaEmail = !emailValida(email)
  const esito = await voucherDellaRiga(supabase, riga, senzaEmail ? '' : email)
  if ('errore' in esito) {
    console.error('Voucher non emesso per la riga', riga.riga_file, esito.errore)
    // Non torna in coda da sola, o un errore fisso si ripeterebbe a ogni giro:
    // `errore` senza voucher_id, da rimettere `da_inviare` a mano.
    await chiudiRiga(supabase, riga, { stato: 'errore', dettaglio: `Voucher non creato: ${esito.errore}` })
    return { riga: riga.riga_file, stato: 'errore', dettaglio: esito.errore }
  }

  const { voucher, nuovo } = esito

  if (senzaEmail || !emailValida(voucher.email)) {
    await chiudiRiga(supabase, riga, { stato: 'senza_email', voucher_id: voucher.id })
    if (nuovo) await registraAudit(supabase, voucher, riga, false, true)
    return { riga: riga.riga_file, stato: 'senza_email' }
  }

  // Un voucher ripreso da un giro interrotto che l'email l'ha già avuta non
  // la riceve due volte.
  if (!nuovo && voucher.email_invii > 0) {
    await chiudiRiga(supabase, riga, { stato: 'inviato', voucher_id: voucher.id })
    return { riga: riga.riga_file, stato: 'inviato', dettaglio: 'già spedito' }
  }

  const esitoEmail = await spedisciVoucher(supabase, voucher)
  await chiudiRiga(supabase, riga, {
    stato: esitoEmail.ok ? 'inviato' : 'errore',
    voucher_id: voucher.id,
    dettaglio: esitoEmail.ok ? riga.dettaglio : `Email non partita: ${esitoEmail.errore}`,
  })
  if (nuovo) await registraAudit(supabase, voucher, riga, esitoEmail.ok, false)
  return esitoEmail.ok
    ? { riga: riga.riga_file, stato: 'inviato' }
    : { riga: riga.riga_file, stato: 'errore', dettaglio: esitoEmail.errore }
}

async function registraAudit(supabase: Supabase, voucher: Voucher, riga: Riga, inviata: boolean, senzaEmail: boolean) {
  await supabase.from('audit_log').insert({
    email: null,
    azione: 'voucher_emesso',
    entita: 'voucher',
    entita_id: voucher.id,
    dettagli: {
      destinatario: senzaEmail ? null : voucher.email,
      email_inviata: inviata,
      senza_email: senzaEmail,
      automatico: CHIAVE_AUTOMAZIONE,
      abbonamento_id: riga.abbonamento_id,
      riga_file: riga.riga_file,
    },
  })
}

async function riepilogo(supabase: Supabase) {
  const { data } = await supabase.from('voucher_recupero').select('stato, motivo')
  const conteggi: Record<string, number> = {}
  for (const r of (data ?? []) as { stato: string; motivo: string | null }[]) {
    const chiave = r.motivo ? `${r.stato}:${r.motivo}` : r.stato
    conteggi[chiave] = (conteggi[chiave] ?? 0) + 1
  }
  return conteggi
}

Deno.serve(async (req: Request) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const token = req.headers.get('x-cron-token') ?? ''
  const { data: autorizzato } = await supabase.rpc('verifica_token_cron', { p_token: token })
  if (autorizzato !== true) return rispondi({ ok: false, errore: 'Non autorizzato' }, 401)

  const parametri = new URL(req.url).searchParams

  const anteprima = (parametri.get('anteprima') ?? '').trim().toLowerCase()
  if (anteprima) {
    if (!emailValida(anteprima)) return rispondi({ ok: false, errore: 'Indirizzo di anteprima non valido.' }, 400)
    const finto: Voucher = {
      id: 'anteprima',
      codice: '00000000',
      nome: 'Mario',
      cognome: 'Rossi',
      email: anteprima,
      valido_fino: dataScadenza(),
      email_invii: 0,
      email_errore: null,
    }
    const testo = contenuto(finto)
    const esito = await inviaEmail(anteprima, { ...testo, oggetto: `[ANTEPRIMA] ${testo.oggetto}` }, null)
    return rispondi({ ok: esito.ok, anteprima, errore: esito.ok ? undefined : esito.errore })
  }

  if (parametri.get('prova') === '1') {
    const { data: prossime } = await supabase
      .from('voucher_recupero')
      .select('riga_file, nome, cognome, email')
      .eq('stato', 'da_inviare')
      .order('riga_file', { ascending: true })
      .limit(LOTTO_DEFAULT)
    return rispondi({
      ok: true,
      prova: true,
      sendgrid_configurato: !!Deno.env.get('SENDGRID_API_KEY'),
      riepilogo: await riepilogo(supabase),
      prossime,
    })
  }

  const { data: stato } = await supabase
    .from('automazioni')
    .select('attiva')
    .eq('chiave', CHIAVE_AUTOMAZIONE)
    .maybeSingle()
  if (!stato?.attiva) return rispondi({ ok: true, attiva: false, motivo: 'automazione spenta' })

  if (!Deno.env.get('SENDGRID_API_KEY')) {
    // Senza chiave ogni email fallirebbe: meglio non toccare la lista.
    return rispondi({ ok: false, errore: 'SENDGRID_API_KEY mancante: nessun voucher emesso.' }, 500)
  }

  const lotto = Math.min(Math.max(Number(parametri.get('lotto')) || LOTTO_DEFAULT, 1), LOTTO_MASSIMO)
  const { data: righe, error } = await supabase.rpc('voucher_recupero_prendi', { p_quanti: lotto })
  if (error) {
    console.error('Lotto non preso:', error.message)
    return rispondi({ ok: false, errore: error.message }, 500)
  }

  const esiti: Esito[] = []
  for (const riga of (righe ?? []) as Riga[]) {
    try {
      esiti.push(await elabora(supabase, riga))
    } catch (e) {
      // Un imprevisto su una riga non ferma il lotto: la riga resta
      // `in_corso` e torna in coda dopo 15 minuti.
      console.error('Riga', riga.riga_file, 'non elaborata:', e)
      esiti.push({ riga: riga.riga_file, stato: 'in_corso', dettaglio: String(e) })
    }
    await attendi(PAUSA_MS)
  }

  // Lista finita: si spegne l'interruttore, e il job smette di chiamare.
  const { count } = await supabase
    .from('voucher_recupero')
    .select('id', { count: 'exact', head: true })
    .in('stato', ['da_inviare', 'in_corso'])
  if (count === 0) {
    await supabase
      .from('automazioni')
      .update({ attiva: false, aggiornato_il: new Date().toISOString() })
      .eq('chiave', CHIAVE_AUTOMAZIONE)
  }

  return rispondi({ ok: true, lotto, elaborate: esiti.length, rimaste: count, esiti })
})
