// Edge function: il tesseramento CSI che parte da solo.
//
// Ogni nuova vendita di un prodotto configurato in `tesseramenti_csi_prodotti`
// diventa una riga di `tesseramenti_csi` (una per persona e stagione), e la
// riga viene inviata al server nazionale di tesseramento del CSI (web service
// JSON, guida v. 2.3). La chiama pg_cron in due giri (vedi
// scripts/sql/2026-10-29-tesseramento-csi.sql):
//
// - ?giro=nuovi    ogni 10 minuti: crea le righe delle nuove vendite e le invia;
// - ?giro=ritenta  ogni 2 ore: riprova chi non è ancora tesserato;
// - ?id=<riga>     «Riprova ora» della pagina Tesseramenti: lavora quella riga
//                  sola, subito. È un'azione manuale: vale anche a
//                  interruttore spento, e non crea né tocca altre righe;
// - ?simula=1      un giro a mano che ignora l'interruttore, ma SOLO in
//                  simulazione (CSI_LIVE diverso da 1): con CSI_LIVE=1 il
//                  parametro è ignorato e l'interruttore vale. Con
//                  &max=<n> (al massimo 50) lavora più righe del solito.
//
// Per ogni persona, prima di mandare il nuovo tesserato (operazione N) chiede
// a CSI se è già tesserata nella stagione (operazione I per codice fiscale):
// il web service ha solo chiamate POST, quindi quella è la «lettura». Chi è
// già tesserato, anche dal portale, si registra come tale senza inviare nulla.
//
// Non manda nessuna email. L'esito, o il motivo per cui CSI non ha tesserato,
// sta in `tesseramenti_csi` e si legge nella pagina Tesseramenti del CRM.
//
// Sicurezza: finché il segreto CSI_LIVE non vale 1 ogni N parte con
// test = 1, cioè CSI calcola quota e credito ma non inserisce nulla e non
// scala il credito: la riga diventa «simulato». Accendere l'automazione in
// `automazioni` da sola non basta a emettere tessere vere.
//
// Autenticazione: header `x-cron-token`, confrontato nel database con il
// segreto `cron_token` del Vault (funzione verifica_token_cron), come
// voucher-automatico. Si pubblica con verify_jwt = false.
//
// ?prova=1 elenca cosa farebbe il giro (chi verrebbe inviato, a chi mancano
// dati) senza scrivere nulla e senza chiamare CSI, anche a interruttore
// spento.
//
// Segreti della function (Dashboard → Edge Functions → Secrets):
//   CSI_USERID           userid della società, 8 cifre (stringa: tiene gli zeri)
//   CSI_PASSWORD         password della società
//   CSI_X_AUTHORIZATION  valore dell'header x-authorization rilasciato dal CSI
//   CSI_LIVE             "1" per emettere tessere vere; assente = simulazione
//   CSI_API_URL          facoltativo, default https://api.csi-net.it/wst/
//                        (con la barra finale: senza, il POST è rifiutato)
//   CSI_COMITATO         facoltativo, default le prime 3 cifre di CSI_USERID
//   CSI_STAGIONE         facoltativo, per forzare la stagione
//   CSI_CREDITO          facoltativo, 2 = credito a tessere (default), 1 = euro
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY li fornisce Supabase. Nessuno di
// questi valori si scrive nei log né nei tentativi.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.114.0'

// Il client senza lo schema generato: le tabelle si leggono per nome.
// deno-lint-ignore no-explicit-any
type Supabase = SupabaseClient<any, 'public', any>

const CHIAVE_AUTOMAZIONE = 'tesseramento_csi'
// I segreti incollati dal pannello possono portarsi dietro uno spazio o un a
// capo: si tolgono (una userid con lo spazio davanti sposta il codice del
// comitato e CSI risponde «Errore codice comitato»).
const env = (nome: string) => (Deno.env.get(nome) ?? '').trim()
const URL_CSI = env('CSI_API_URL') || 'https://api.csi-net.it/wst/'

// Quanto indietro guarda il giro «nuovi», oltre al limite di `attiva_dal`:
// una finestra stretta evita che una vendita vecchia, ricomparsa per una
// correzione nel gestionale, faccia partire un tesseramento fuori tempo.
const GIORNI_FINESTRA = 14

// Tetto di righe per giro: ogni riga costa fino a due chiamate al CSI, che
// registra tutto e si riserva di spegnere il servizio a chi lo martella
// (§16 della guida).
const MASSIMO_PER_GIRO = 25
const PAUSA_TRA_CHIAMATE_MS = 300
const TIMEOUT_CSI_MS = 30_000
const GIORNO_MS = 24 * 60 * 60 * 1000

// 2 = credito a numero di tessere, 1 = in euro. CSI_CREDITO lo cambia senza
// ripubblicare, se la convenzione della società cambia.
const TIPO_CREDITO = env('CSI_CREDITO') || '2'

type Giro = 'nuovi' | 'ritenta'
type MotivoTipo = 'dati_mancanti' | 'csi' | 'credito' | 'rete' | 'configurazione'

type Persona = {
  id: string
  nome: string | null
  cognome: string | null
  data_nascita: string | null
  luogo_nascita: string | null
  provincia_nascita: string | null
  stato_nascita: string | null
  sesso: string | null
  codice_fiscale: string | null
  email: string | null
  cellulare: string | null
  telefono_1: string | null
  indirizzo_via: string | null
  indirizzo_civico: string | null
  indirizzo_cap: string | null
  indirizzo_citta: string | null
  indirizzo_provincia: string | null
}

type Riga = {
  id: string
  persona_id: string
  stagione: number
  abbonamento_id: string | null
  codice_attivita: string | null
  stato: 'da_inviare' | 'tesserato' | 'non_tesserato' | 'simulato'
  tentativi: number
  aggiornato_il: string
  abbonamenti: { abbonamento: string | null; data_fine: string | null; cancellato_il: string | null } | null
}

type RispostaCsi =
  | { ok: true; dati: Record<string, unknown> }
  | { ok: false; errore: string; rete: boolean }

type Esito = { rigaId: string; esito: string; dettaglio?: string }

function rispondi(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ─────────────────────────────────────────────────────────────────── date

function annoMeseRoma(): { anno: number; mese: number } {
  const roma = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit' }).format(
    new Date()
  )
  const [anno, mese] = roma.split('-').map(Number)
  return { anno, mese }
}

// La stagione è quella in cui la tessera nasce (§3.2): da luglio l'anno
// corrente, fino a giugno quello precedente. CSI_STAGIONE la forza.
function stagioneCorrente(): number {
  const forzata = Number(Deno.env.get('CSI_STAGIONE'))
  if (Number.isInteger(forzata) && forzata > 2000) return forzata
  const { anno, mese } = annoMeseRoma()
  return mese >= 7 ? anno : anno - 1
}

// 2026-10-29 → 29/10/2026, il formato di CSI.
function dataCsi(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return ''
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

// 29/10/2026 → 2026-10-29; null se non è una data.
function dataIso(csi: unknown): string | null {
  const m = typeof csi === 'string' ? csi.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) : null
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

// ──────────────────────────────────────────────────────────────── chiamate

function credenziali(): { userid: string; password: string; xAuth: string; comitato: string } | null {
  const userid = env('CSI_USERID')
  const password = env('CSI_PASSWORD')
  const xAuth = env('CSI_X_AUTHORIZATION')
  if (!userid || !password || !xAuth) return null
  return { userid, password, xAuth, comitato: env('CSI_COMITATO') || userid.slice(0, 3) }
}

// Una chiamata al web service: POST JSON, e l'esito si legge sempre dal campo
// `esito`, mai dallo status HTTP, che è 200 anche negli errori (§2).
async function chiamaCsi(
  cred: NonNullable<ReturnType<typeof credenziali>>,
  stagione: number,
  corpo: Record<string, unknown>
): Promise<RispostaCsi> {
  try {
    const risposta = await fetch(URL_CSI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-authorization': cred.xAuth },
      body: JSON.stringify({
        userid: cred.userid,
        password: cred.password,
        comitato: cred.comitato,
        stagione: String(stagione),
        ...corpo,
      }),
      signal: AbortSignal.timeout(TIMEOUT_CSI_MS),
    })
    const testo = await risposta.text()
    let dati: Record<string, unknown>
    try {
      dati = JSON.parse(testo)
    } catch (_e) {
      return { ok: false, errore: `Risposta di CSI non leggibile (HTTP ${risposta.status}).`, rete: true }
    }
    if (dati.esito === 'OK') return { ok: true, dati }
    return { ok: false, errore: String(dati.errore ?? 'Errore sconosciuto di CSI.').trim(), rete: false }
  } catch (_e) {
    return { ok: false, errore: 'Il server CSI non risponde: riproviamo al prossimo giro.', rete: true }
  }
}

// Che cosa dice l'errore di CSI, e se vale per tutte le righe: in quel caso
// il giro si ferma (credito finito, credenziali sbagliate, stagione non
// ammessa) invece di consumare una chiamata per ogni riga. Dopo un errore di
// credito la guida (§14) sconsiglia i ritentativi ravvicinati.
function classifica(errore: string): { tipo: MotivoTipo; ferma: boolean } {
  if (/credito a scalare|credito insufficiente/i.test(errore)) return { tipo: 'credito', ferma: true }
  if (/x-authorization|userid\/password|codice comitato|body JSON|stagione sportiva|account di prova/i.test(errore)) {
    return { tipo: 'configurazione', ferma: true }
  }
  if (/codice attivit|attivit[àa] monodisciplinare|autorizzazione/i.test(errore)) {
    return { tipo: 'configurazione', ferma: false }
  }
  return { tipo: 'csi', ferma: false }
}

// ───────────────────────────────────────────────────────────────── dati

const tronca = (v: string | null | undefined, max: number) => (v ?? '').trim().slice(0, max)

// Il luogo come lo vuole CSI (§6.1): il comune per chi è nato in Italia, lo
// stato per gli stranieri. In Info4U l'estero si riconosce da
// Provincia_Nascita = 'EE' o da uno Stato_Nascita diverso da «Italia»; lo
// stato è compilato a mano e a volte è sporco (una città al posto dello
// stato), quindi lo si usa solo se c'è un segnale di estero.
function luogoPerCsi(p: Pick<Persona, 'luogo_nascita' | 'provincia_nascita' | 'stato_nascita'>): string {
  const comune = tronca(p.luogo_nascita, 35)
  const stato = tronca(p.stato_nascita, 35)
  const estero = (p.provincia_nascita ?? '').trim().toUpperCase() === 'EE' || (stato !== '' && stato.toLowerCase() !== 'italia')
  return estero && stato ? stato : comune
}

// I campi obbligatori di N (§6.1) più il codice attività. Il codice fiscale
// è «consigliato» e non blocca: serve al controllo dei doppi tesseramenti e
// alla lettura preventiva, ma i nati all'estero non lo hanno.
function datiMancanti(p: Persona, codiceAttivita: string | null): string[] {
  const mancanti: string[] = []
  if (tronca(p.cognome, 50).length < 2) mancanti.push('cognome')
  if (tronca(p.nome, 50).length < 2) mancanti.push('nome')
  if (!p.data_nascita) mancanti.push('data di nascita')
  else if (p.data_nascita > new Date().toISOString().slice(0, 10)) mancanti.push('data di nascita (è nel futuro)')
  if (luogoPerCsi(p).length < 2) mancanti.push('luogo di nascita')
  if (!['M', 'F'].includes((p.sesso ?? '').trim().toUpperCase())) mancanti.push('sesso')
  if (!codiceAttivita) mancanti.push('codice attività CSI del prodotto')
  return mancanti
}

function cifre(v: string | null | undefined): string {
  return (v ?? '').replace(/[^\d+]/g, '')
}

function corpoNuovoTesserato(p: Persona, codiceAttivita: string, cmed: string | null, test: boolean) {
  const telefono = cifre(p.cellulare) || cifre(p.telefono_1)
  const corpo: Record<string, string> = {
    operazione: 'N',
    test: test ? '1' : '0',
    cognome: tronca(p.cognome, 50),
    nome: tronca(p.nome, 50),
    nascita: dataCsi(p.data_nascita),
    luogo: luogoPerCsi(p),
    sesso: (p.sesso ?? '').trim().toUpperCase(),
    // Il campo si chiama `tipotess` (lo dice l'errore del server), non
    // `tipoess` come scritto nelle tabelle della guida: si mandano entrambi.
    tipotess: 'AT',
    tipoess: 'AT',
    codiceatt1: codiceAttivita,
    // Il credito della società è a tessere (convenzione ANIF), non in euro:
    // per le attività CR, CF e CS CSI rifiuta il credito in euro. Verificato
    // con la simulazione, vedi supabase/functions/csi-verifica.
    credito: TIPO_CREDITO,
  }
  // I facoltativi si mandano solo se ci sono: in N un campo vuoto non
  // aggiunge nulla, ma non c'è motivo di sporcare la richiesta.
  const facoltativi: Record<string, string> = {
    cft: tronca(p.codice_fiscale, 16).toUpperCase(),
    indirizzo: tronca(p.indirizzo_via, 150),
    civico: tronca(p.indirizzo_civico, 6),
    comune: tronca(p.indirizzo_citta, 35),
    provincia: tronca(p.indirizzo_provincia, 2).toUpperCase(),
    cap: tronca(p.indirizzo_cap, 5),
    telefono,
    email: tronca(p.email, 100).toLowerCase(),
    cmed: cmed ?? '',
  }
  for (const [k, v] of Object.entries(facoltativi)) if (v) corpo[k] = v
  return corpo
}

// ──────────────────────────────────────────────────────────── scrittura

type Aggiornamento = Partial<{
  stato: Riga['stato']
  origine: 'automatico' | 'gia_presente'
  tessera: string | null
  quota: number | null
  rilascio: string | null
  scadenza: string | null
  tesserato_il: string | null
  motivo: string | null
  motivo_tipo: MotivoTipo | null
  codice_attivita: string | null
}>

async function registraTentativo(
  supabase: Supabase,
  rigaId: string,
  operazione: string,
  test: boolean,
  risposta: RispostaCsi,
  richiesta: Record<string, unknown>
) {
  const { error } = await supabase.from('tesseramenti_csi_tentativi').insert({
    tesseramento_id: rigaId,
    operazione,
    test,
    esito: risposta.ok ? 'OK' : risposta.rete ? 'rete' : 'KO',
    errore: risposta.ok ? null : risposta.errore,
    // La richiesta senza credenziali (non ci sono mai: le aggiunge chiamaCsi)
    // e senza immagini (non se ne mandano); la risposta intera.
    richiesta,
    risposta: risposta.ok ? risposta.dati : null,
  })
  if (error) console.error('Tentativo non registrato:', error.message)
}

async function aggiorna(supabase: Supabase, rigaId: string, campi: Aggiornamento) {
  const { error } = await supabase
    .from('tesseramenti_csi')
    .update({ ...campi, aggiornato_il: new Date().toISOString() })
    .eq('id', rigaId)
  if (error) console.error('Riga di tesseramento non aggiornata:', rigaId, error.message)
}

// ───────────────────────────────────────────────────────────── una riga

type Contesto = {
  supabase: Supabase
  cred: NonNullable<ReturnType<typeof credenziali>>
  live: boolean
  stagione: number
  prodotti: Map<string, string>
  // Le attività della società per la stagione (operazione S), lette una
  // volta per giro; null se la lettura non è riuscita.
  attivita: Set<string> | null
  fermato: string | null
}

async function leggiAttivita(ctx: Contesto) {
  if (ctx.attivita) return
  const r = await chiamaCsi(ctx.cred, ctx.stagione, { operazione: 'S' })
  if (!r.ok) return
  const elenco = Array.isArray(r.dati.attivita) ? (r.dati.attivita as { codiceatt?: string }[]) : []
  ctx.attivita = new Set(elenco.map((a) => String(a.codiceatt ?? '').toUpperCase()).filter(Boolean))
}

async function lavoraRiga(ctx: Contesto, riga: Riga): Promise<Esito> {
  const { supabase } = ctx
  const ora = new Date().toISOString()

  // Si «prende» la riga: l'aggiornamento riesce solo se nessun altro giro l'ha
  // toccata dopo che l'abbiamo letta, così due giri sovrapposti non mandano
  // due volte lo stesso nominativo.
  const { data: presa } = await supabase
    .from('tesseramenti_csi')
    .update({ ultimo_tentativo_il: ora, tentativi: riga.tentativi + 1, aggiornato_il: ora })
    .eq('id', riga.id)
    .eq('aggiornato_il', riga.aggiornato_il)
    .select('id')
  if (!presa || presa.length === 0) return { rigaId: riga.id, esito: 'saltata', dettaglio: 'Presa da un altro giro.' }

  const { data: persona } = await supabase
    .from('persone')
    .select(
      'id, nome, cognome, data_nascita, luogo_nascita, provincia_nascita, stato_nascita, sesso, codice_fiscale, email, cellulare, telefono_1, indirizzo_via, indirizzo_civico, indirizzo_cap, indirizzo_citta, indirizzo_provincia'
    )
    .eq('id', riga.persona_id)
    .maybeSingle()
  if (!persona) {
    await aggiorna(supabase, riga.id, { stato: 'non_tesserato', motivo: 'La persona non esiste più in anagrafica.', motivo_tipo: 'configurazione' })
    return { rigaId: riga.id, esito: 'non_tesserato', dettaglio: 'persona assente' }
  }
  const p = persona as Persona

  // Il codice attività è quello del prodotto di oggi; se il prodotto è stato
  // tolto dalla configurazione resta quello con cui la riga è nata.
  const prodotto = riga.abbonamenti?.abbonamento ?? ''
  const codice = ctx.prodotti.get(prodotto) ?? riga.codice_attivita ?? null

  const mancanti = datiMancanti(p, codice)
  if (mancanti.length > 0) {
    await aggiorna(supabase, riga.id, {
      stato: 'non_tesserato',
      motivo: `Dati mancanti: ${mancanti.join(', ')}.`,
      motivo_tipo: 'dati_mancanti',
      codice_attivita: codice,
    })
    return { rigaId: riga.id, esito: 'dati_mancanti', dettaglio: mancanti.join(', ') }
  }

  await leggiAttivita(ctx)
  if (ctx.attivita && ctx.attivita.size > 0 && !ctx.attivita.has(codice!.toUpperCase())) {
    await aggiorna(supabase, riga.id, {
      stato: 'non_tesserato',
      motivo: `L'attività ${codice} non risulta fra quelle della società per la stagione ${ctx.stagione}.`,
      motivo_tipo: 'configurazione',
      codice_attivita: codice,
    })
    return { rigaId: riga.id, esito: 'non_tesserato', dettaglio: 'attività non della società' }
  }

  // 1. Già tesserato? L'operazione I accetta il codice fiscale al posto
  // della tessera e restituisce una riga per ogni tessera della stagione.
  const cft = tronca(p.codice_fiscale, 16).toUpperCase()
  if (cft.length === 16) {
    const richiestaI = { operazione: 'I', tessera: cft }
    const lettura = await chiamaCsi(ctx.cred, ctx.stagione, richiestaI)
    await registraTentativo(supabase, riga.id, 'I', false, lettura, richiestaI)
    if (lettura.ok) {
      const trovati = Array.isArray(lettura.dati.tesserati) ? (lettura.dati.tesserati as Record<string, unknown>[]) : []
      const nellaStagione = trovati.find((t) => String(t.as) === String(ctx.stagione))
      if (nellaStagione) {
        await aggiorna(supabase, riga.id, {
          stato: 'tesserato',
          origine: 'gia_presente',
          tessera: String(nellaStagione.tessera ?? ''),
          rilascio: dataIso(nellaStagione.rilascio),
          scadenza: dataIso(nellaStagione.scadenza),
          tesserato_il: ora,
          motivo: null,
          motivo_tipo: null,
          codice_attivita: codice,
        })
        return { rigaId: riga.id, esito: 'gia_presente' }
      }
    } else if (lettura.rete) {
      await aggiorna(supabase, riga.id, { stato: 'non_tesserato', motivo: lettura.errore, motivo_tipo: 'rete' })
      ctx.fermato = lettura.errore
      return { rigaId: riga.id, esito: 'rete', dettaglio: lettura.errore }
    } else {
      // La lettura è fallita per un motivo di CSI (credenziali, stagione):
      // vale per ogni riga, e inviare N non cambierebbe nulla.
      const { tipo, ferma } = classifica(lettura.errore)
      await aggiorna(supabase, riga.id, { stato: 'non_tesserato', motivo: lettura.errore, motivo_tipo: tipo })
      if (ferma) ctx.fermato = lettura.errore
      return { rigaId: riga.id, esito: 'non_tesserato', dettaglio: lettura.errore }
    }
    await pausa(PAUSA_TRA_CHIAMATE_MS)
  }

  // 2. Nuovo tesserato. Il certificato medico, se c'è ed è in corso, va nella
  // richiesta come `cmed` (scadenza).
  const { data: cert } = await supabase
    .from('certificati')
    .select('data_scadenza')
    .eq('persona_id', p.id)
    .gte('data_scadenza', new Date().toISOString().slice(0, 10))
    .order('data_scadenza', { ascending: false })
    .limit(1)
    .maybeSingle()
  const cmed = dataCsi((cert as { data_scadenza: string | null } | null)?.data_scadenza) || null

  const corpo = corpoNuovoTesserato(p, codice!, cmed, !ctx.live)
  const risposta = await chiamaCsi(ctx.cred, ctx.stagione, corpo)
  await registraTentativo(supabase, riga.id, 'N', !ctx.live, risposta, corpo)

  if (risposta.ok) {
    const d = risposta.dati
    if (!ctx.live) {
      // Simulazione: «tessera» è un valore fittizio e non va conservato.
      await aggiorna(supabase, riga.id, {
        stato: 'simulato',
        origine: 'automatico',
        tessera: null,
        quota: Number(d.quota ?? 0),
        scadenza: dataIso(d.scadenza),
        motivo: null,
        motivo_tipo: null,
        codice_attivita: codice,
      })
      return { rigaId: riga.id, esito: 'simulato' }
    }
    await aggiorna(supabase, riga.id, {
      stato: 'tesserato',
      origine: 'automatico',
      tessera: String(d.tessera ?? ''),
      quota: Number(d.quota ?? 0),
      rilascio: new Date().toISOString().slice(0, 10),
      scadenza: dataIso(d.scadenza),
      tesserato_il: ora,
      motivo: null,
      motivo_tipo: null,
      codice_attivita: codice,
    })
    return { rigaId: riga.id, esito: 'tesserato' }
  }

  if (risposta.rete) {
    await aggiorna(supabase, riga.id, { stato: 'non_tesserato', motivo: risposta.errore, motivo_tipo: 'rete' })
    ctx.fermato = risposta.errore
    return { rigaId: riga.id, esito: 'rete', dettaglio: risposta.errore }
  }

  const { tipo, ferma } = classifica(risposta.errore)
  await aggiorna(supabase, riga.id, {
    stato: 'non_tesserato',
    motivo: risposta.errore,
    motivo_tipo: tipo,
    codice_attivita: codice,
  })
  if (ferma) ctx.fermato = risposta.errore
  return { rigaId: riga.id, esito: 'non_tesserato', dettaglio: risposta.errore }
}

// ─────────────────────────────────────────────────────────────── il giro

const COLONNE_RIGA =
  'id, persona_id, stagione, abbonamento_id, codice_attivita, stato, tentativi, aggiornato_il, abbonamenti(abbonamento, data_fine, cancellato_il)'

Deno.serve(async (req: Request) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const token = req.headers.get('x-cron-token') ?? ''
  const { data: autorizzato } = await supabase.rpc('verifica_token_cron', { p_token: token })
  if (autorizzato !== true) return rispondi({ ok: false, errore: 'Non autorizzato' }, 401)

  const url = new URL(req.url)
  const prova = url.searchParams.get('prova') === '1'
  const giro: Giro = url.searchParams.get('giro') === 'ritenta' ? 'ritenta' : 'nuovi'
  const idParam = url.searchParams.get('id') ?? ''
  const idRiga = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idParam) ? idParam : null
  const live = Deno.env.get('CSI_LIVE') === '1'
  const stagione = stagioneCorrente()
  // Il giro a mano in simulazione: ignora l'interruttore, mai con tessere vere.
  const simula = url.searchParams.get('simula') === '1' && !live
  const massimo = simula
    ? Math.min(Math.max(Number(url.searchParams.get('max')) || MASSIMO_PER_GIRO, 1), 50)
    : MASSIMO_PER_GIRO

  const { data: stato } = await supabase
    .from('automazioni')
    .select('attiva, attiva_dal')
    .eq('chiave', CHIAVE_AUTOMAZIONE)
    .maybeSingle()

  if (!prova && !idRiga && !simula && (!stato?.attiva || !stato.attiva_dal)) {
    return rispondi({ ok: true, attiva: false, motivo: 'automazione spenta' })
  }

  const { data: configurati, error: errProdotti } = await supabase
    .from('tesseramenti_csi_prodotti')
    .select('prodotto, codice_attivita')
    .eq('attivo', true)
  if (errProdotti) {
    console.error('Lettura prodotti non riuscita:', errProdotti.message)
    return rispondi({ ok: false, errore: errProdotti.message }, 500)
  }
  const prodotti = new Map<string, string>(
    (configurati ?? []).map((r: { prodotto: string; codice_attivita: string }) => [r.prodotto, r.codice_attivita])
  )
  if (prodotti.size === 0) return rispondi({ ok: true, giro, configurato: false, motivo: 'nessun prodotto configurato' })

  // ── Le nuove vendite diventano righe da inviare (solo il giro «nuovi»).
  let nuoveRighe = 0
  const daCreare: { persona: string; abbonamento: string }[] = []
  if (giro === 'nuovi' && !idRiga) {
    const finestra = new Date(Date.now() - GIORNI_FINESTRA * GIORNO_MS)
    const attivaDal = !prova && stato?.attiva_dal ? new Date(stato.attiva_dal) : null
    const dal = (attivaDal && attivaDal > finestra ? attivaDal : finestra).toISOString()

    const { data: vendite, error } = await supabase
      .from('abbonamenti')
      .select('id, abbonamento, persona_id, data_vendita')
      .in('abbonamento', Array.from(prodotti.keys()))
      .is('cancellato_il', null)
      .not('persona_id', 'is', null)
      .gte('data_vendita', dal)
      .order('data_vendita', { ascending: true })
      .limit(500)
    if (error) {
      console.error('Lettura abbonamenti non riuscita:', error.message)
      return rispondi({ ok: false, errore: error.message }, 500)
    }

    // Una riga per persona: la prima vendita è quella che la fa nascere.
    const primaVendita = new Map<string, { id: string; abbonamento: string }>()
    for (const v of (vendite ?? []) as { id: string; abbonamento: string; persona_id: string }[]) {
      if (!primaVendita.has(v.persona_id)) primaVendita.set(v.persona_id, { id: v.id, abbonamento: v.abbonamento })
    }

    const persone = Array.from(primaVendita.keys())
    const { data: esistenti } = persone.length
      ? await supabase.from('tesseramenti_csi').select('persona_id').eq('stagione', stagione).in('persona_id', persone)
      : { data: [] }
    const giaPresenti = new Set((esistenti ?? []).map((r: { persona_id: string }) => r.persona_id))

    const righeNuove = persone
      .filter((id) => !giaPresenti.has(id))
      .map((id) => ({
        persona_id: id,
        stagione,
        abbonamento_id: primaVendita.get(id)!.id,
        codice_attivita: prodotti.get(primaVendita.get(id)!.abbonamento) ?? null,
      }))

    for (const r of righeNuove) daCreare.push({ persona: r.persona_id, abbonamento: r.abbonamento_id })
    if (!prova && righeNuove.length > 0) {
      // L'unicità (persona, stagione) rende innocuo un doppio inserimento.
      const { error: errInsert } = await supabase
        .from('tesseramenti_csi')
        .upsert(righeNuove, { onConflict: 'persona_id,stagione', ignoreDuplicates: true })
      if (errInsert) {
        console.error('Righe di tesseramento non create:', errInsert.message)
        return rispondi({ ok: false, errore: errInsert.message }, 500)
      }
      nuoveRighe = righeNuove.length
    }
  }

  // ── Le righe da lavorare. Le «simulate» si rifanno solo dopo il passaggio
  // a CSI_LIVE=1: in simulazione ripeterle sarebbe una chiamata inutile.
  const stati = giro === 'nuovi' ? ['da_inviare'] : ['da_inviare', 'non_tesserato']
  if (live) stati.push('simulato')

  // «Riprova ora»: quella riga, qualunque sia la stagione e purché non sia già
  // tesserata. Le altre condizioni (abbonamento finito, tetto per giro) sono
  // dei giri automatici e qui non contano.
  const query = supabase.from('tesseramenti_csi').select(COLONNE_RIGA)
  const { data: candidate, error: errRighe } = idRiga
    ? await query.eq('id', idRiga).in('stato', ['da_inviare', 'non_tesserato', 'simulato'])
    : await query
        .eq('stagione', stagione)
        .in('stato', stati)
        .order('ultimo_tentativo_il', { ascending: true, nullsFirst: true })
        .limit(100)
  if (errRighe) {
    console.error('Lettura righe non riuscita:', errRighe.message)
    return rispondi({ ok: false, errore: errRighe.message }, 500)
  }

  const oggi = new Date().toISOString().slice(0, 10)
  const righe = idRiga
    ? ((candidate ?? []) as unknown as Riga[])
    : ((candidate ?? []) as unknown as Riga[])
        // Chi ha un abbonamento finito o annullato non va più inseguito.
        .filter((r) => !r.abbonamenti || (!r.abbonamenti.cancellato_il && (!r.abbonamenti.data_fine || r.abbonamenti.data_fine >= oggi)))
        .slice(0, massimo)

  if (prova) {
    const { data: persone } = righe.length
      ? await supabase
          .from('persone')
          .select('id, data_nascita, luogo_nascita, provincia_nascita, stato_nascita, sesso, nome, cognome')
          .in('id', righe.map((r) => r.persona_id))
      : { data: [] }
    const perId = new Map(((persone ?? []) as Persona[]).map((p) => [p.id, p]))
    return rispondi({
      ok: true,
      prova: true,
      giro,
      live,
      stagione,
      credenziali_configurate: credenziali() !== null,
      vendite_senza_riga: daCreare.length,
      righe: righe.map((r) => {
        const p = perId.get(r.persona_id)
        const codice = prodotti.get(r.abbonamenti?.abbonamento ?? '') ?? r.codice_attivita
        return {
          riga: r.id,
          stato: r.stato,
          mancano: p ? datiMancanti(p as Persona, codice) : ['persona'],
        }
      }),
    })
  }

  const cred = credenziali()
  if (!cred) {
    return rispondi({ ok: false, errore: 'Credenziali CSI non configurate (CSI_USERID, CSI_PASSWORD, CSI_X_AUTHORIZATION).' }, 500)
  }

  const ctx: Contesto = { supabase, cred, live, stagione, prodotti, attivita: null, fermato: null }
  const esiti: Esito[] = []
  for (const riga of righe) {
    if (ctx.fermato) break
    esiti.push(await lavoraRiga(ctx, riga))
    await pausa(PAUSA_TRA_CHIAMATE_MS)
  }

  return rispondi({
    ok: true,
    attiva: stato?.attiva === true,
    giro: idRiga ? 'riga' : giro,
    live,
    simula,
    stagione,
    righe_create: nuoveRighe,
    lavorate: esiti.length,
    fermato: ctx.fermato,
    esiti,
  })
})
