// Edge function: verifica di sola lettura sul server nazionale CSI.
//
// Legge i tesserati che CSI ha in archivio per la società (operazione E, due
// stagioni), le attività e le qualifiche della società (S) e il credito (C),
// e li incrocia per codice fiscale con `persone` e `abbonamenti`. Serve a
// capire come la società ha tesserato finora (che attività, che qualifiche,
// quali campi compilati) e quali prodotti dànno la tessera, prima di
// accendere il tesseramento automatico (vedi tesseramento-csi).
//
// Non scrive nulla, né su CSI né nel database, e NON restituisce nominativi:
// la risposta contiene solo conteggi. La risposta di una chiamata di
// pg_cron finisce in net._http_response e resta qualche ora, e non è il
// posto per dati personali.
//
// Autenticazione: header `x-cron-token` (verifica_token_cron), come le altre
// edge function chiamate dal database; verify_jwt = false.
//
// Segreti: CSI_USERID, CSI_PASSWORD, CSI_X_AUTHORIZATION (obbligatori),
// CSI_API_URL, CSI_COMITATO (facoltativi). Non vengono mai restituiti.

import { createClient } from 'npm:@supabase/supabase-js@2.114.0'

// I segreti incollati dal pannello possono portarsi dietro uno spazio o un a
// capo: si tolgono, perché la userid con uno spazio davanti sposta il codice
// del comitato (le sue prime 3 cifre) e CSI risponde «Errore codice comitato».
const env = (nome: string) => (Deno.env.get(nome) ?? '').trim()

const URL_CANDIDATI = [
  env('CSI_API_URL'),
  'https://api.csi-net.it/wst/',
  'https://servizi.csi-net.it/api/wst/',
].filter((u, i, a): u is string => !!u && a.indexOf(u) === i)

const TIMEOUT_MS = 60_000

type Dati = Record<string, unknown>
type Tesserato = Record<string, string>

function rispondi(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}

const testo = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

// gg/mm/aaaa → aaaa-mm-gg ('' se non è una data).
function dataIso(csi: string): string {
  const m = csi.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}

function oggiRoma(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date())
}

function incrementa(mappa: Record<string, number>, chiave: string, n = 1) {
  mappa[chiave] = (mappa[chiave] ?? 0) + n
}

function ordina(mappa: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(mappa).sort((a, b) => b[1] - a[1]))
}

// ─────────────────────────────────────────────────────────────── CSI

let urlUsato: string | null = null
const proveUrl: { url: string; esito: string }[] = []

async function chiamaCsi(corpo: Record<string, string>): Promise<{ ok: true; dati: Dati } | { ok: false; errore: string }> {
  const userid = env('CSI_USERID')
  const password = env('CSI_PASSWORD')
  const xAuth = env('CSI_X_AUTHORIZATION')
  const comitato = env('CSI_COMITATO') || userid.slice(0, 3)
  const richiesta = JSON.stringify({ userid, password, comitato, ...corpo })

  // Il primo indirizzo che risponde con un JSON che ha il campo `esito` è
  // quello giusto: la guida ne indica due (§1 e l'esempio) e qui si scopre.
  for (const url of urlUsato ? [urlUsato] : URL_CANDIDATI) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-authorization': xAuth },
        body: richiesta,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const grezzo = await r.text()
      let dati: Dati
      try {
        dati = JSON.parse(grezzo)
      } catch (_e) {
        if (!urlUsato) proveUrl.push({ url, esito: `HTTP ${r.status}, risposta non JSON` })
        continue
      }
      if (typeof dati.esito !== 'string') {
        if (!urlUsato) proveUrl.push({ url, esito: `HTTP ${r.status}, JSON senza «esito»` })
        continue
      }
      if (!urlUsato) proveUrl.push({ url, esito: `HTTP ${r.status}, risponde` })
      urlUsato = url
      return dati.esito === 'OK' ? { ok: true, dati } : { ok: false, errore: testo(dati.errore) || 'Errore sconosciuto' }
    } catch (e) {
      if (!urlUsato) proveUrl.push({ url, esito: `non raggiungibile (${(e as Error).name})` })
    }
  }
  return { ok: false, errore: 'Nessun indirizzo del servizio CSI ha risposto (vedi prove_url).' }
}

// ──────────────────────────────────────────────────────── riepilogo

function riepilogaTesserati(tutti: Tesserato[], oggi: string) {
  const validi = tutti.filter((t) => {
    const s = dataIso(t.scadenza ?? '')
    return s === '' || s >= oggi
  })
  const senzaScadenza = tutti.filter((t) => dataIso(t.scadenza ?? '') === '').length

  const tipoess: Record<string, number> = {}
  const att1: Record<string, number> = {}
  const attAggiuntive: Record<string, number> = {}
  const qualifiche: Record<string, number> = {}
  const scadenzaPerMese: Record<string, number> = {}
  const prefissi: Record<string, number> = {}
  const rilasciPerMese: Record<string, number> = {}
  const compilati: Record<string, number> = {}
  const campi = [
    'cft', 'luogo', 'email', 'telefono', 'indirizzo', 'comune', 'cap', 'provincia',
    'cmed', 'documento', 'gruppi', 'cittadinanza_st',
  ]

  for (const t of validi) {
    incrementa(tipoess, t.tipoess || '(vuoto)')
    incrementa(att1, t.att1 || '(vuoto)')
    for (const k of ['att2', 'att3', 'att4']) if (t[k]) incrementa(attAggiuntive, t[k])
    for (const k of ['qua1', 'qua2', 'qua3', 'qua4', 'qua5']) if (t[k]) incrementa(qualifiche, t[k])
    const s = dataIso(t.scadenza ?? '')
    if (s) incrementa(scadenzaPerMese, s.slice(0, 7))
    const r = dataIso(t.rilascio ?? '')
    if (r) incrementa(rilasciPerMese, r.slice(0, 7))
    incrementa(prefissi, (t.tessera ?? '').slice(0, 4))
    for (const c of campi) if (t[c]) incrementa(compilati, c)
    if (t.foto === 'S') incrementa(compilati, 'foto')
    if (t.disabile === 'S') incrementa(compilati, 'disabile')
  }

  return {
    totale_in_archivio: tutti.length,
    validi_oggi: validi.length,
    scaduti: tutti.length - validi.length,
    senza_scadenza_calcolata: senzaScadenza,
    tipo_tessera: ordina(tipoess),
    attivita_principale_att1: ordina(att1),
    attivita_aggiuntive: ordina(attAggiuntive),
    qualifiche: ordina(qualifiche),
    scadenze_per_mese: Object.fromEntries(Object.entries(scadenzaPerMese).sort()),
    rilasci_per_mese: Object.fromEntries(Object.entries(rilasciPerMese).sort()),
    inizio_numero_tessera: ordina(prefissi),
    campi_compilati_su_validi: ordina(compilati),
    validi,
  }
}

// ─────────────────────────────────────────────────────────── handler

Deno.serve(async (req: Request) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const token = req.headers.get('x-cron-token') ?? ''
  const { data: autorizzato } = await supabase.rpc('verifica_token_cron', { p_token: token })
  if (autorizzato !== true) return rispondi({ ok: false, errore: 'Non autorizzato' }, 401)

  const segreti = {
    CSI_USERID: !!env('CSI_USERID'),
    CSI_PASSWORD: !!env('CSI_PASSWORD'),
    CSI_X_AUTHORIZATION: !!env('CSI_X_AUTHORIZATION'),
  }
  if (!Object.values(segreti).every(Boolean)) {
    return rispondi({ ok: false, errore: 'Segreti CSI mancanti.', segreti_presenti: segreti })
  }

  const oggi = oggiRoma()
  const annoOggi = Number(oggi.slice(0, 4))
  const stagioni = [annoOggi - 1, annoOggi]
  const risultato: Record<string, unknown> = { ok: true, oggi, segreti_presenti: segreti }

  // La forma dei segreti, mai il valore: serve a capire perché CSI rifiuta il
  // comitato. La userid dev'essere di 8 cifre e il comitato le sue prime 3.
  const userid = env('CSI_USERID')
  const grezzo = Deno.env.get('CSI_USERID') ?? ''
  risultato.diagnosi_segreti = {
    userid_lunghezza: userid.length,
    userid_solo_cifre: /^\d+$/.test(userid),
    userid_aveva_spazi_o_a_capo: grezzo !== userid,
    comitato_impostato_a_mano: !!env('CSI_COMITATO'),
    comitato_lunghezza: (env('CSI_COMITATO') || userid.slice(0, 3)).length,
    comitato_uguale_alle_prime_3_cifre: !env('CSI_COMITATO') || env('CSI_COMITATO') === userid.slice(0, 3),
    password_lunghezza: env('CSI_PASSWORD').length,
    password_aveva_spazi_o_a_capo: (Deno.env.get('CSI_PASSWORD') ?? '') !== env('CSI_PASSWORD'),
    header_aveva_spazi_o_a_capo: (Deno.env.get('CSI_X_AUTHORIZATION') ?? '') !== env('CSI_X_AUTHORIZATION'),
  }

  // ?sonda=1: solo il credito (in euro e in numero di tessere) e due
  // simulazioni di N (test = 1: CSI calcola e non inserisce nulla né scala
  // credito) con i dati di esempio della guida, mai persone vere. Dicono se
  // il credito basta, quale credito serve e cosa pretende CSI sul documento.
  const parametri = new URL(req.url).searchParams
  if (parametri.get('sonda') === '1') {
    const anno = String(annoOggi)
    // `campi` è un JSON di campi che si sovrappongono alla richiesta di base
    // (nome dei campi, credito, documento...): si prova senza ripubblicare.
    let campi: Record<string, string> = {}
    try {
      campi = JSON.parse(parametri.get('campi') ?? '{}')
    } catch (_e) {
      return rispondi({ ok: false, errore: 'Il parametro campi non è un JSON valido.' }, 400)
    }
    risultato.credito_euro = await chiamaCsi({ stagione: anno, operazione: 'C', credito: '1' })
    risultato.credito_tessere = await chiamaCsi({ stagione: anno, operazione: 'C', credito: '2' })
    risultato.campi_provati = Object.keys(campi)
    risultato.simulazione_n = await chiamaCsi({
      stagione: anno, operazione: 'N', test: '1', cognome: 'ROSSI', nome: 'MARIO', nascita: '12/02/1987',
      luogo: 'BOLOGNA', sesso: 'M', codiceatt1: 'CR', cft: 'RSSMRA87B12A944X', ...campi,
    })
    risultato.url_usato = urlUsato
    return rispondi(risultato)
  }

  // Società: attività, qualifiche, affiliazione, credito.
  const s = await chiamaCsi({ stagione: String(annoOggi), operazione: 'S' })
  risultato.societa = s.ok
    ? {
        scadenza_affiliazione: s.dati.scadenza_affiliazione,
        ultimo_anno_affiliazione: s.dati.ultimo_anno_affiliazione,
        foto_prevista: s.dati.foto_prevista,
        documento_richiesto: s.dati.documento_richiesto,
        documento_obbligatorio_da_anni: s.dati.documento_obbligatorio_da_anni,
        documento_obbligatorio_a_anni: s.dati.documento_obbligatorio_a_anni,
        documento_obbligatorio_solo_codiceatt: s.dati.documento_obbligatorio_solo_codiceatt,
        foto_quota_aggiuntiva: s.dati.foto_quota_aggiuntiva,
        attivita: s.dati.attivita,
        qualifiche: s.dati.qualifiche,
        periodo_tessere: s.dati.periodo_tessere,
        attivita_principale: s.dati.attivita_principale,
      }
    : { errore: s.errore }
  const c = await chiamaCsi({ stagione: String(annoOggi), operazione: 'C', credito: '1' })
  risultato.credito = c.ok ? { tipo: c.dati.tipocredito, residuo: c.dati.creditoresiduo, convenzione: c.dati.convenzione } : { errore: c.errore }
  risultato.url_usato = urlUsato
  risultato.prove_url = proveUrl

  // I tesserati di ciascuna stagione.
  const tuttiValidi: Tesserato[] = []
  const perStagione: Record<string, unknown> = {}
  for (const st of stagioni) {
    const e = await chiamaCsi({ stagione: String(st), operazione: 'E' })
    if (!e.ok) {
      perStagione[st] = { errore: e.errore }
      continue
    }
    const elenco = Array.isArray(e.dati.tesserati) ? (e.dati.tesserati as Dati[]) : []
    const tesserati = elenco.map((t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, testo(v)])))
    const { validi, ...riepilogo } = riepilogaTesserati(tesserati, oggi)
    perStagione[st] = { ...riepilogo, limite_20000_raggiunto: tesserati.length >= 20000 }
    tuttiValidi.push(...validi)
  }
  risultato.stagioni = perStagione

  // Incrocio con i nostri dati, per codice fiscale. Un tesserato può comparire
  // in due stagioni: si conta una volta, con la tessera più recente.
  const perCf = new Map<string, Tesserato>()
  for (const t of tuttiValidi) {
    const cf = (t.cft ?? '').toUpperCase()
    if (cf.length === 16) perCf.set(cf, t)
  }
  risultato.validi_distinti_con_cf = perCf.size
  risultato.validi_senza_cf = tuttiValidi.filter((t) => (t.cft ?? '').length !== 16).length

  // Persone con abbonamento in corso (e il loro codice fiscale).
  const abbonamenti: { persona_id: string; abbonamento: string }[] = []
  for (let da = 0; da < 20000; da += 1000) {
    const { data, error } = await supabase
      .from('abbonamenti')
      .select('persona_id, abbonamento')
      .is('cancellato_il', null)
      .not('persona_id', 'is', null)
      .lte('data_inizio', oggi)
      .gte('data_fine', oggi)
      .order('id')
      .range(da, da + 999)
    if (error) return rispondi({ ...risultato, ok: false, errore: `Abbonamenti non letti: ${error.message}` }, 500)
    abbonamenti.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  const idPersone = Array.from(new Set(abbonamenti.map((a) => a.persona_id)))

  const cfPersona = new Map<string, string>()
  for (let i = 0; i < idPersone.length; i += 150) {
    const { data, error } = await supabase
      .from('persone')
      .select('id, codice_fiscale')
      .in('id', idPersone.slice(i, i + 150))
    if (error) return rispondi({ ...risultato, ok: false, errore: `Persone non lette: ${error.message}` }, 500)
    for (const p of data ?? []) {
      const cf = testo(p.codice_fiscale).toUpperCase()
      if (cf.length === 16) cfPersona.set(p.id, cf)
    }
  }

  // Quanti soci con abbonamento in corso sono già tesserati validi.
  const tesseratiTraSoci = idPersone.filter((id) => perCf.has(cfPersona.get(id) ?? ''))
  risultato.soci_con_abbonamento_in_corso = {
    persone: idPersone.length,
    con_codice_fiscale_valido: cfPersona.size,
    senza_codice_fiscale_valido: idPersone.length - cfPersona.size,
    gia_tesserati_validi: tesseratiTraSoci.length,
    non_tesserati_con_cf: cfPersona.size - tesseratiTraSoci.length,
  }

  // Per ogni prodotto: quanti soci lo hanno in corso, quanti di loro sono
  // tesserati validi, e con quale attività. Un prodotto con quota alta e
  // sempre la stessa attività è un prodotto che dà la tessera.
  const perProdotto = new Map<string, { soci: Set<string>; tesserati: Set<string>; att: Record<string, number> }>()
  for (const a of abbonamenti) {
    const nome = testo(a.abbonamento) || '(senza nome)'
    const p = perProdotto.get(nome) ?? { soci: new Set(), tesserati: new Set(), att: {} }
    p.soci.add(a.persona_id)
    const t = perCf.get(cfPersona.get(a.persona_id) ?? '')
    if (t && !p.tesserati.has(a.persona_id)) {
      p.tesserati.add(a.persona_id)
      incrementa(p.att, t.att1 || (t.tipoess === 'NA' ? `NA:${t.qua1}` : '(vuoto)'))
    }
    perProdotto.set(nome, p)
  }
  risultato.prodotti = Array.from(perProdotto.entries())
    .map(([prodotto, p]) => ({
      prodotto,
      soci_in_corso: p.soci.size,
      tesserati_validi: p.tesserati.size,
      percentuale_tesserati: Math.round((p.tesserati.size / p.soci.size) * 100),
      attivita_usate: ordina(p.att),
    }))
    .sort((a, b) => b.soci_in_corso - a.soci_in_corso)

  return rispondi(risultato)
})
