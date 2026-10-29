// Edge function: le tessere CSI dentro il CRM.
//
// Ogni ora (pg_cron, job `csi-tessere`, vedi scripts/sql/2026-10-29-tessere-csi.sql)
// legge dal server nazionale CSI i tesserati della società (operazione E, per
// la stagione corrente e la precedente) e li scrive in `tessere_csi`, poi li
// lega alle persone per codice fiscale. È di sola lettura su CSI: nessuna
// tessera si emette e nessun credito si scala.
//
// Da lì il CRM mostra la tessera nella scheda della persona, la ricerca nella
// pagina Tesseramenti e l'elenco di chi ha pagato con IVA a zero senza una
// tessera in corso.
//
// Una tessera che CSI non restituisce più (annullata) esce dalla tabella al
// giro dopo, ma solo se la lettura della stagione è riuscita: un errore di
// CSI non cancella niente.
//
// Autenticazione: header `x-cron-token` (verifica_token_cron), come le altre
// edge function chiamate dal database; verify_jwt = false. L'interruttore è la
// riga `csi_tessere` di `automazioni`.
//
// Segreti: CSI_USERID, CSI_PASSWORD, CSI_X_AUTHORIZATION (obbligatori),
// CSI_API_URL e CSI_COMITATO (facoltativi). Non vengono mai restituiti né
// scritti nei log. La risposta contiene solo conteggi.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.114.0'

// deno-lint-ignore no-explicit-any
type Supabase = SupabaseClient<any, 'public', any>

// Spazi e a capo incollati col segreto sposterebbero il comitato (le prime 3
// cifre della userid) e CSI risponderebbe «Errore codice comitato».
const env = (nome: string) => (Deno.env.get(nome) ?? '').trim()

const URL_CSI = env('CSI_API_URL') || 'https://api.csi-net.it/wst/'
const TIMEOUT_MS = 60_000
const BLOCCO = 500
const CHIAVE_AUTOMAZIONE = 'csi_tessere'

type Dati = Record<string, unknown>

function rispondi(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}

const testo = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

// gg/mm/aaaa → aaaa-mm-gg (null se non è una data).
function dataIso(csi: unknown): string | null {
  const m = testo(csi).match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

async function leggiElenco(stagione: number): Promise<{ ok: true; tesserati: Dati[] } | { ok: false; errore: string }> {
  const userid = env('CSI_USERID')
  try {
    const r = await fetch(URL_CSI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-authorization': env('CSI_X_AUTHORIZATION') },
      body: JSON.stringify({
        userid,
        password: env('CSI_PASSWORD'),
        comitato: env('CSI_COMITATO') || userid.slice(0, 3),
        stagione: String(stagione),
        operazione: 'E',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const dati = (await r.json()) as Dati
    if (dati.esito !== 'OK') return { ok: false, errore: testo(dati.errore) || 'Errore sconosciuto di CSI' }
    return { ok: true, tesserati: Array.isArray(dati.tesserati) ? (dati.tesserati as Dati[]) : [] }
  } catch (_e) {
    return { ok: false, errore: 'Il server CSI non risponde o ha risposto in modo non leggibile.' }
  }
}

async function sincronizzaStagione(supabase: Supabase, stagione: number, inizio: string) {
  const letto = await leggiElenco(stagione)
  if (!letto.ok) return { stagione, ok: false, errore: letto.errore }

  // Un tesserato può comparire due volte nello stesso elenco: vale l'ultima.
  const righe = new Map<string, Record<string, unknown>>()
  for (const t of letto.tesserati) {
    const tessera = testo(t.tessera)
    if (!tessera) continue
    const cf = testo(t.cft).toUpperCase()
    righe.set(tessera, {
      stagione,
      tessera,
      cft: cf.length === 16 ? cf : null,
      cognome: testo(t.cognome) || null,
      nome: testo(t.nome) || null,
      // Il campo si chiama `tipotess` (come nella richiesta di N), non `tipoess`
      // come nelle tabelle della guida: si leggono entrambi.
      tipotess: testo(t.tipotess) || testo(t.tipoess) || null,
      attivita: [t.att1, t.att2, t.att3, t.att4].map(testo).filter(Boolean),
      qualifiche: [t.qua1, t.qua2, t.qua3, t.qua4, t.qua5].map(testo).filter(Boolean),
      rilascio: dataIso(t.rilascio),
      scadenza: dataIso(t.scadenza),
      foto: testo(t.foto).toUpperCase() === 'S',
      visto_il: inizio,
    })
  }

  const tutte = Array.from(righe.values())
  for (let i = 0; i < tutte.length; i += BLOCCO) {
    const { error } = await supabase
      .from('tessere_csi')
      .upsert(tutte.slice(i, i + BLOCCO), { onConflict: 'stagione,tessera' })
    if (error) return { stagione, ok: false, errore: `Scrittura non riuscita: ${error.message}` }
  }

  // Le tessere che CSI non restituisce più. Solo se l'elenco non è vuoto: una
  // risposta vuota improvvisa è più probabilmente un problema di CSI che
  // l'annullamento di tutte le tessere.
  let rimosse = 0
  if (tutte.length > 0) {
    const { data, error } = await supabase
      .from('tessere_csi')
      .delete()
      .eq('stagione', stagione)
      .lt('visto_il', inizio)
      .select('id')
    if (error) return { stagione, ok: false, errore: `Pulizia non riuscita: ${error.message}` }
    rimosse = data?.length ?? 0
  }
  return { stagione, ok: true, lette: tutte.length, rimosse }
}

Deno.serve(async (req: Request) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  }) as Supabase

  const token = req.headers.get('x-cron-token') ?? ''
  const { data: autorizzato } = await supabase.rpc('verifica_token_cron', { p_token: token })
  if (autorizzato !== true) return rispondi({ ok: false, errore: 'Non autorizzato' }, 401)

  const { data: stato } = await supabase.from('automazioni').select('attiva').eq('chiave', CHIAVE_AUTOMAZIONE).maybeSingle()
  if (!stato?.attiva) return rispondi({ ok: true, attiva: false, motivo: 'automazione spenta' })

  if (!env('CSI_USERID') || !env('CSI_PASSWORD') || !env('CSI_X_AUTHORIZATION')) {
    return rispondi({ ok: false, errore: 'Credenziali CSI non configurate.' }, 500)
  }

  const inizio = new Date().toISOString()
  const anno = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric' }).format(new Date()))

  const stagioni = []
  for (const stagione of [anno - 1, anno]) stagioni.push(await sincronizzaStagione(supabase, stagione, inizio))

  const { data: collegate, error: errLegame } = await supabase.rpc('collega_tessere_csi')
  if (errLegame) console.error('Legame tessere non riuscito:', errLegame.message)

  const { count: senzaPersona } = await supabase
    .from('tessere_csi')
    .select('id', { count: 'exact', head: true })
    .is('persona_id', null)

  return rispondi({
    ok: stagioni.every((s) => s.ok),
    stagioni,
    legami_aggiornati: collegate ?? null,
    tessere_senza_persona: senzaPersona ?? null,
  })
})
