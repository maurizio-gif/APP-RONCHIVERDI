// Edge function: il voucher della visita medica che parte da solo.
//
// Ogni nuova vendita di un prodotto con la sigla "(cer000)" nel nome riceve
// il codice per email, senza passare dalla segreteria. La chiama pg_cron ogni
// 15 minuti (job `voucher-automatico`, vedi
// scripts/sql/2026-10-16-automazioni-su-supabase.sql), e solo quando la riga
// voucher_cer000 di `automazioni` è accesa; il controllo è ripetuto anche
// qui, così una chiamata a mano non può scavalcare l'interruttore.
//
// Autenticazione: header `x-cron-token`, confrontato nel database con il
// segreto `cron_token` del Vault (funzione verifica_token_cron). Il JWT di
// Supabase non serve e la function si pubblica con verify_jwt = false.
//
// ?prova=1 elenca le vendite degli ultimi giorni che riceverebbero il codice,
// senza emettere né inviare nulla, anche a interruttore spento.
//
// Segreti della function (Dashboard → Edge Functions → Secrets):
// SENDGRID_API_KEY obbligatorio per l'invio; SENDGRID_FROM_EMAIL,
// SENDGRID_FROM_NAME, EMAIL_REPLY_TO e i recapiti PARTNER_MEDICO_* hanno
// gli stessi default del pannello. SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
// li fornisce Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2.114.0'
import { emailAssegnazione } from '../_shared/voucher-email-testi.ts'

const CHIAVE_AUTOMAZIONE = 'voucher_cer000'

// La sigla come la scrive il gestionale nel nome del prodotto, oggi
// «1.1 GOLD OVER 35 (cer000)». Il confronto ignora maiuscole e minuscole.
const SIGLA_PRODOTTO = '(cer000)'

// Quanto indietro guarda ogni giro, oltre al limite di `attiva_dal`: la
// sincronizzazione porta le vendite entro pochi minuti, e una finestra
// stretta evita che un abbonamento vecchio, ricomparso per una correzione
// nel gestionale, faccia partire un codice fuori tempo. È anche il tempo che
// la segreteria ha per aggiungere un'email mancante.
const GIORNI_FINESTRA = 7

// Un voucher già intestato alla stessa email in questo intervallo attorno
// alla vendita vuol dire che il socio l'ha già ricevuto: non se ne manda un
// secondo.
const GIORNI_VOUCHER_ESISTENTE = 60

// Tetto per giro: con una ventina di vendite al mese non si raggiunge mai,
// ma impedisce che un errore di filtro faccia partire centinaia di email.
const MASSIMO_PER_GIRO = 25

const MESI_VALIDITA = 12
const CIFRE_CODICE = 8
const TENTATIVI_CODICE = 5
const EMESSO_DA = 'Automatico (cer000)'
const GIORNO_MS = 24 * 60 * 60 * 1000

const COLONNE =
  'id, codice, tipo, nome, cognome, email, telefono, note, stato, emesso_da, created_at, valido_fino, email_inviata_il, email_invii, email_errore'

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

type Vendita = {
  id: string
  abbonamento: string | null
  variante: string | null
  data_vendita: string
  persone: { nome: string | null; cognome: string | null; email: string | null; cellulare: string | null } | null
}

type Candidato = {
  abbonamentoId: string
  prodotto: string
  dataVendita: string
  nome: string
  cognome: string
  email: string
  esito: 'da_emettere' | 'emesso' | 'gia_emesso' | 'voucher_esistente' | 'dati_mancanti' | 'errore'
  dettaglio?: string
}

function rispondi(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}

// Come generaCodice in lib/voucher.ts: crypto.getRandomValues, perché un
// codice che vale una visita non deve essere indovinabile.
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

function erroreDatiSocio(dati: { nome: string; cognome: string; email: string }): string | null {
  if (!dati.nome) return 'Il nome è obbligatorio.'
  if (!dati.cognome) return 'Il cognome è obbligatorio.'
  if (!dati.email) return 'L’email è obbligatoria: è lì che arriva il voucher.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dati.email)) return 'L’email non sembra valida.'
  return null
}

// La stessa chiamata di lib/email.ts del pannello: un POST a SendGrid, con
// lo stesso mittente verificato e la stessa casella per le risposte.
async function inviaEmail(a: string, contenuto: { oggetto: string; html: string; testo: string }, voucherId: string) {
  const chiave = Deno.env.get('SENDGRID_API_KEY')
  if (!chiave) return { ok: false as const, errore: 'Invio email non configurato (SENDGRID_API_KEY mancante).' }
  try {
    const risposta = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chiave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: a }] }],
        from: {
          email: Deno.env.get('SENDGRID_FROM_EMAIL') || 'digital@ronchiverdi.it',
          name: Deno.env.get('SENDGRID_FROM_NAME') || 'Ronchiverdi Sport Club',
        },
        reply_to: { email: Deno.env.get('EMAIL_REPLY_TO') || 'info@ronchiverdi.it' },
        subject: contenuto.oggetto,
        // Aperture e click tracciati come per le altre email del voucher
        // (lib/voucher-email.ts); i link del solo testo non si riscrivono.
        tracking_settings: {
          open_tracking: { enable: true },
          click_tracking: { enable: true, enable_text: false },
        },
        custom_args: { voucher_id: voucherId, email: 'assegnazione' },
        content: [
          { type: 'text/plain', value: contenuto.testo },
          { type: 'text/html', value: contenuto.html },
        ],
      }),
    })
    if (risposta.status === 202) return { ok: true as const }
    const dettaglio = (await risposta.text()).slice(0, 500)
    return { ok: false as const, errore: `SendGrid ha risposto ${risposta.status}: ${dettaglio || 'nessun dettaglio'}` }
  } catch (_e) {
    return { ok: false as const, errore: 'Servizio di invio email non raggiungibile.' }
  }
}

Deno.serve(async (req: Request) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const token = req.headers.get('x-cron-token') ?? ''
  const { data: autorizzato } = await supabase.rpc('verifica_token_cron', { p_token: token })
  if (autorizzato !== true) return rispondi({ ok: false, errore: 'Non autorizzato' }, 401)

  const prova = new URL(req.url).searchParams.get('prova') === '1'

  const { data: stato } = await supabase
    .from('automazioni')
    .select('attiva, attiva_dal')
    .eq('chiave', CHIAVE_AUTOMAZIONE)
    .maybeSingle()

  if (!prova && (!stato?.attiva || !stato.attiva_dal)) {
    return rispondi({ ok: true, attiva: false, motivo: 'automazione spenta' })
  }

  const finestra = new Date(Date.now() - GIORNI_FINESTRA * GIORNO_MS)
  const attivaDal = !prova && stato?.attiva_dal ? new Date(stato.attiva_dal) : null
  const dal = (attivaDal && attivaDal > finestra ? attivaDal : finestra).toISOString()

  const { data, error } = await supabase
    .from('abbonamenti')
    .select('id, abbonamento, variante, data_vendita, persone(nome, cognome, email, cellulare)')
    .ilike('abbonamento', `%${SIGLA_PRODOTTO}%`)
    .is('cancellato_il', null)
    .gte('data_vendita', dal)
    .order('data_vendita', { ascending: true })
    .limit(200)

  if (error) {
    console.error('Lettura abbonamenti non riuscita:', error.message)
    return rispondi({ ok: false, errore: error.message }, 500)
  }

  const vendite = (data ?? []) as unknown as Vendita[]
  const candidati: Candidato[] = []

  // Le vendite che hanno già il loro voucher escono subito: è il caso di
  // ogni giro dopo il primo, e non deve costare un tentativo d'emissione.
  const { data: gia } = vendite.length
    ? await supabase.from('voucher').select('abbonamento_id').in('abbonamento_id', vendite.map((v) => v.id))
    : { data: [] }
  const conVoucher = new Set((gia ?? []).map((r: { abbonamento_id: string }) => r.abbonamento_id))

  let emessiInQuestoGiro = 0

  for (const v of vendite) {
    const p = v.persone
    const candidato: Candidato = {
      abbonamentoId: v.id,
      prodotto: [v.abbonamento, v.variante].filter(Boolean).join(' · '),
      dataVendita: v.data_vendita,
      nome: (p?.nome ?? '').trim(),
      cognome: (p?.cognome ?? '').trim(),
      email: (p?.email ?? '').trim().toLowerCase(),
      esito: 'da_emettere',
    }
    candidati.push(candidato)

    if (conVoucher.has(v.id)) {
      candidato.esito = 'gia_emesso'
      continue
    }

    const datiMancanti = erroreDatiSocio(candidato)
    if (datiMancanti) {
      candidato.esito = 'dati_mancanti'
      candidato.dettaglio = datiMancanti
      continue
    }

    const { data: esistenti } = await supabase
      .from('voucher')
      .select('id')
      // ilike per ignorare le maiuscole di chi l'ha scritta a mano; `_` e
      // `%` negli indirizzi vanno protetti, o diventano jolly.
      .ilike('email', candidato.email.replace(/[\\%_]/g, '\\$&'))
      .neq('stato', 'annullato')
      .gte('created_at', new Date(new Date(v.data_vendita).getTime() - GIORNI_VOUCHER_ESISTENTE * GIORNO_MS).toISOString())
      .limit(1)
    if (esistenti && esistenti.length > 0) {
      candidato.esito = 'voucher_esistente'
      candidato.dettaglio = 'Il socio ha già un voucher emesso attorno a questa vendita.'
      continue
    }

    if (prova || emessiInQuestoGiro >= MASSIMO_PER_GIRO) continue

    // L'emissione: si riprova solo sulla collisione del codice. Se a
    // collidere è l'unico sulla vendita, il voucher esiste già (un altro giro
    // è arrivato prima) e non si insiste.
    let voucher: Voucher | null = null
    let ultimoErrore = ''
    for (let tentativo = 0; tentativo < TENTATIVI_CODICE; tentativo++) {
      const { data: inserito, error: errInsert } = await supabase
        .from('voucher')
        .insert({
          codice: generaCodice(),
          tipo: 'visita_medica',
          nome: candidato.nome,
          cognome: candidato.cognome,
          email: candidato.email,
          telefono: p?.cellulare?.trim() || null,
          note: `${candidato.prodotto} venduto il ${new Date(v.data_vendita).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}`,
          valido_fino: dataScadenza(),
          emesso_da: EMESSO_DA,
          abbonamento_id: v.id,
        })
        .select(COLONNE)
        .single()
      if (!errInsert) {
        voucher = inserito as Voucher
        break
      }
      ultimoErrore = errInsert.message
      if (errInsert.code !== '23505' || errInsert.message.includes('voucher_abbonamento_unico')) break
    }

    if (!voucher) {
      const giaEmesso = ultimoErrore.includes('voucher_abbonamento_unico')
      candidato.esito = giaEmesso ? 'gia_emesso' : 'errore'
      candidato.dettaglio = giaEmesso ? undefined : ultimoErrore
      if (!giaEmesso) console.error('Voucher non emesso per', v.id, ultimoErrore)
      continue
    }

    // Come nel pannello: l'esito dell'email si salva accanto al voucher. Se
    // SendGrid è giù il codice esiste comunque, e la segreteria lo vede
    // «non partita» con il pulsante per rimandarla.
    const esitoEmail = await inviaEmail(voucher.email, emailAssegnazione(voucher), voucher.id)
    await supabase
      .from('voucher')
      .update(
        esitoEmail.ok
          ? { email_inviata_il: new Date().toISOString(), email_invii: voucher.email_invii + 1, email_errore: null }
          : { email_errore: esitoEmail.errore }
      )
      .eq('id', voucher.id)

    emessiInQuestoGiro++
    candidato.esito = 'emesso'
    if (!esitoEmail.ok) candidato.dettaglio = `Email non partita: ${esitoEmail.errore}`

    await supabase.from('audit_log').insert({
      email: null,
      azione: 'voucher_emesso',
      entita: 'voucher',
      entita_id: voucher.id,
      dettagli: {
        destinatario: voucher.email,
        email_inviata: esitoEmail.ok,
        automatico: CHIAVE_AUTOMAZIONE,
        abbonamento_id: v.id,
      },
    })
  }

  return rispondi({
    ok: true,
    attiva: stato?.attiva === true,
    prova,
    dal,
    sendgrid_configurato: !!Deno.env.get('SENDGRID_API_KEY'),
    candidati,
  })
})
