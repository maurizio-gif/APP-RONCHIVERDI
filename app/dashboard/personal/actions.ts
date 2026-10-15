'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import type { SezioneChiave } from '@/lib/auth/sezioni'
import { registraLog } from '@/lib/audit'
import { oggiRoma } from '@/lib/agenda'
import {
  COLONNE_SESSIONE,
  erroreDataOra,
  nomeCliente,
  type ClienteScelto,
  type ClienteTrovato,
  type CorporateTrovato,
  type SessionePersonal,
} from '@/lib/personal'
import { leggiTrainer, nomeTrainer, verificaCliente } from '@/lib/personal-server'

// Esito come valore di ritorno e non throw: in produzione Next.js oscura il
// messaggio di un errore lanciato da una Server Action, e il trainer al
// telefono deve leggere perché la sessione non è partita.
export type EsitoAzione = { ok: true; messaggio: string } | { ok: false; errore: string }

const PAGINE = ['/dashboard/personal', '/dashboard/personal/check', '/dashboard/personal/amministrazione']

function aggiornaPagine(personaIds: (string | null | undefined)[] = []) {
  for (const p of PAGINE) revalidatePath(p)
  for (const id of personaIds) if (id) revalidatePath(`/dashboard/persone/${id}`)
}

/** L'email di chi chiama, se ha almeno una delle sezioni indicate. */
async function operatoreCon(...sezioni: SezioneChiave[]): Promise<string | null> {
  const email = emailCorrente()
  if (!email) return null
  const consentite = await getSezioniConsentite(email)
  return sezioni.some((s) => consentite.includes(s)) ? email : null
}

const NEGATO_CHECK: EsitoAzione = {
  ok: false,
  errore: 'Solo il responsabile del personal training può confermare, modificare o eliminare le sessioni.',
}

// ──────────────────────────────────────────────────────────── ricerca

export type EsitoRicerca<T> = { ok: true; risultati: T[] } | { ok: false; errore: string }

const MANCA_MIGRAZIONE =
  'Manca la funzione di ricerca: esegui scripts/sql/2026-10-15-personal-training.sql nel SQL Editor.'

/**
 * Le persone con un abbonamento attivo che corrispondono a quanto scritto.
 * La usano il trainer nel suo modulo e il responsabile quando corregge il
 * cliente di una sessione.
 */
export async function cercaClienti(query: string): Promise<EsitoRicerca<ClienteTrovato>> {
  if (!(await operatoreCon('personal', 'personal-check'))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }
  const termine = String(query ?? '').trim().slice(0, 80)
  // Due lettere almeno: con una sola, «a» trova mezza anagrafica.
  if (termine.replace(/\s/g, '').length < 2) return { ok: true, risultati: [] }

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc('personal_cerca_clienti', { p_query: termine, p_limite: 30 })
  if (error) {
    console.error('personal_cerca_clienti:', error.message)
    return { ok: false, errore: /personal_cerca_clienti/.test(error.message) ? MANCA_MIGRAZIONE : 'Ricerca non riuscita. Riprova.' }
  }
  return { ok: true, risultati: (data ?? []) as ClienteTrovato[] }
}

/** Gli abbonamenti corporate attivi, filtrati per nome dell'azienda (vuoto = tutti). */
export async function cercaCorporate(query: string): Promise<EsitoRicerca<CorporateTrovato>> {
  if (!(await operatoreCon('personal', 'personal-check'))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }
  const termine = String(query ?? '').trim().slice(0, 80)

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc('personal_cerca_corporate', { p_query: termine, p_limite: 100 })
  if (error) {
    console.error('personal_cerca_corporate:', error.message)
    return { ok: false, errore: /personal_cerca_corporate/.test(error.message) ? MANCA_MIGRAZIONE : 'Ricerca non riuscita. Riprova.' }
  }
  return { ok: true, risultati: (data ?? []) as CorporateTrovato[] }
}

// ─────────────────────────────────────────────── registrazione (trainer)

/**
 * La stessa sessione registrata due volte — il doppio tocco sul pulsante, o
 * il trainer che non ricorda di averla già segnata — si ferma qui: stesso
 * trainer, stesso cliente, stesso giorno e stessa ora. Due clienti diversi
 * alla stessa ora restano possibili: una sessione in coppia sono due
 * lezioni.
 */
async function giaRegistrata(
  trainerEmail: string,
  dati: { persona_id: string; cliente_nome: string; cliente_cognome: string },
  data: string,
  ora: string,
  escludiId?: string
): Promise<boolean> {
  const supabase = createSupabaseServiceClient()
  let query = supabase
    .from('personal_sessioni')
    .select('id')
    .eq('trainer_email', trainerEmail)
    .eq('persona_id', dati.persona_id)
    .eq('data', data)
    .eq('ora', `${ora}:00`)
    .ilike('cliente_nome', dati.cliente_nome)
    .ilike('cliente_cognome', dati.cliente_cognome)
  if (escludiId) query = query.neq('id', escludiId)
  const { data: righe } = await query.limit(1)
  return (righe ?? []).length > 0
}

export async function registraSessione(input: {
  cliente: ClienteScelto
  data: string
  ora: string
}): Promise<EsitoAzione> {
  const email = await operatoreCon('personal')
  if (!email) return { ok: false, errore: 'Non hai il permesso di registrare sessioni di personal training.' }

  const data = String(input?.data ?? '')
  const ora = String(input?.ora ?? '')
  const erroreQuando = erroreDataOra(data, ora, oggiRoma())
  if (erroreQuando) return { ok: false, errore: erroreQuando }

  const verifica = await verificaCliente(input?.cliente)
  if (!verifica.ok) return verifica
  const dati = verifica.dati

  if (await giaRegistrata(email, dati, data, ora)) {
    return { ok: false, errore: 'Questa sessione è già registrata: stesso cliente, stesso giorno e stessa ora.' }
  }

  const supabase = createSupabaseServiceClient()
  const { data: creata, error } = await supabase
    .from('personal_sessioni')
    .insert({
      ...dati,
      trainer_email: email,
      trainer_nome: await nomeTrainer(email),
      data,
      ora,
    })
    .select('id')
    .single()

  if (error || !creata) {
    console.error('Sessione personal non registrata:', error?.message)
    return { ok: false, errore: 'Non siamo riusciti a registrare la sessione. Riprova.' }
  }

  await registraLog(email, 'personal_sessione_registrata', {
    entita: 'personal_sessioni',
    entitaId: creata.id as string,
    dettagli: { cliente: nomeCliente(dati), corporate: dati.corporate, azienda: dati.azienda, data, ora },
  })

  aggiornaPagine()
  return { ok: true, messaggio: `Sessione con ${dati.cliente_nome} ${dati.cliente_cognome} registrata: ora la conferma il responsabile.` }
}

// ───────────────────────────────────────────────── controllo (responsabile)

async function leggiSessioni(ids: string[]): Promise<SessionePersonal[]> {
  if (!ids.length) return []
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase.from('personal_sessioni').select(COLONNE_SESSIONE).in('id', ids)
  return (data ?? []) as unknown as SessionePersonal[]
}

/** Conferma una o più sessioni in attesa (il pulsante sulla riga, o tutte quelle mostrate). */
export async function confermaSessioni(ids: string[]): Promise<EsitoAzione> {
  const email = await operatoreCon('personal-check')
  if (!email) return NEGATO_CHECK

  const unici = [...new Set((ids ?? []).map(String))].slice(0, 1000)
  if (!unici.length) return { ok: false, errore: 'Nessuna sessione da confermare.' }

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('personal_sessioni')
    .update({ stato: 'confermata', confermata_il: new Date().toISOString(), confermata_da: email })
    .in('id', unici)
    .eq('stato', 'in_attesa')
    .select('id, persona_id')

  if (error) {
    console.error('Sessioni personal non confermate:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a confermare. Riprova.' }
  }

  const confermate = data ?? []
  for (const r of confermate) {
    await registraLog(email, 'personal_sessione_confermata', { entita: 'personal_sessioni', entitaId: r.id as string })
  }

  aggiornaPagine(confermate.map((r) => r.persona_id as string | null))
  if (confermate.length === 0) return { ok: false, errore: 'Erano già confermate.' }
  return {
    ok: true,
    messaggio: confermate.length === 1 ? 'Sessione confermata.' : `${confermate.length} sessioni confermate.`,
  }
}

/** Una sessione confermata per errore torna in attesa: esce dalla scheda e dal calcolo del mese. */
export async function rimettiInAttesa(id: string): Promise<EsitoAzione> {
  const email = await operatoreCon('personal-check')
  if (!email) return NEGATO_CHECK

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('personal_sessioni')
    .update({ stato: 'in_attesa', confermata_il: null, confermata_da: null })
    .eq('id', id)
    .eq('stato', 'confermata')
    .select('id, persona_id')

  if (error) {
    console.error('Sessione personal non rimessa in attesa:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a cambiare lo stato. Riprova.' }
  }
  if (!data?.length) return { ok: false, errore: 'La sessione non è (più) confermata.' }

  await registraLog(email, 'personal_sessione_in_attesa', { entita: 'personal_sessioni', entitaId: id })
  aggiornaPagine([data[0].persona_id as string | null])
  return { ok: true, messaggio: 'Sessione rimessa in attesa.' }
}

/**
 * La correzione del responsabile: cliente, giorno, ora e trainer. Lo stato
 * non cambia — una sessione confermata e corretta resta confermata.
 *
 * Il limite sulle date del trainer (da inizio mese scorso a trenta giorni)
 * qui non vale: il responsabile corregge anche una sessione vecchia.
 */
export async function modificaSessione(
  id: string,
  input: { cliente: ClienteScelto; data: string; ora: string; trainerEmail: string }
): Promise<EsitoAzione> {
  const email = await operatoreCon('personal-check')
  if (!email) return NEGATO_CHECK

  const [prima] = await leggiSessioni([id])
  if (!prima) return { ok: false, errore: 'Sessione non trovata: forse è stata eliminata.' }

  const data = String(input?.data ?? '')
  const ora = String(input?.ora ?? '')
  const erroreQuando = erroreDataOra(data, ora, oggiRoma(), false)
  if (erroreQuando) return { ok: false, errore: erroreQuando }

  const verifica = await verificaClienteOAttuale(input?.cliente, prima)
  if (!verifica.ok) return verifica
  const dati = verifica.dati

  // Il trainer si sceglie fra chi ha la sezione; quello già scritto sulla
  // sessione resta valido anche se nel frattempo gli è stata tolta.
  const trainerEmail = String(input?.trainerEmail ?? '').trim().toLowerCase()
  let trainerNome = prima.trainer_nome
  if (trainerEmail !== prima.trainer_email) {
    const trainer = (await leggiTrainer()).find((t) => t.email === trainerEmail)
    if (!trainer) return { ok: false, errore: 'Scegli un trainer fra quelli abilitati.' }
    trainerNome = await nomeTrainer(trainerEmail)
  }

  if (await giaRegistrata(trainerEmail, dati, data, ora, id)) {
    return { ok: false, errore: 'C’è già un’altra sessione uguale: stesso trainer, cliente, giorno e ora.' }
  }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('personal_sessioni')
    .update({
      ...dati,
      trainer_email: trainerEmail,
      trainer_nome: trainerNome,
      data,
      ora,
      modificata_il: new Date().toISOString(),
      modificata_da: email,
    })
    .eq('id', id)

  if (error) {
    console.error('Sessione personal non modificata:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a salvare la modifica. Riprova.' }
  }

  await registraLog(email, 'personal_sessione_modificata', {
    entita: 'personal_sessioni',
    entitaId: id,
    dettagli: {
      prima: { trainer: prima.trainer_email, cliente: nomeCliente(prima), data: prima.data, ora: prima.ora.slice(0, 5) },
      dopo: { trainer: trainerEmail, cliente: nomeCliente(dati), data, ora },
    },
  })

  aggiornaPagine([prima.persona_id, dati.persona_id])
  return { ok: true, messaggio: 'Sessione aggiornata.' }
}

/**
 * Il cliente di una correzione. Se il responsabile non l'ha cambiato vale
 * quello già salvato, anche se nel frattempo l'abbonamento è scaduto: la
 * sessione si è svolta quando era attivo, e spostarne l'ora non deve
 * obbligare a ritrovare un cliente che la ricerca non mostra più.
 */
async function verificaClienteOAttuale(cliente: ClienteScelto, prima: SessionePersonal) {
  const invariato =
    !!cliente &&
    cliente.personaId === prima.persona_id &&
    cliente.abbonamentoId === prima.abbonamento_id &&
    (cliente.tipo !== 'corporate' ||
      (cliente.nome.trim() === prima.cliente_nome && cliente.cognome.trim() === prima.cliente_cognome))
  if (invariato && prima.persona_id && prima.abbonamento_id) {
    return {
      ok: true as const,
      dati: {
        persona_id: prima.persona_id,
        abbonamento_id: prima.abbonamento_id,
        abbonamento_nome: prima.abbonamento_nome,
        cliente_nome: prima.cliente_nome,
        cliente_cognome: prima.cliente_cognome,
        corporate: prima.corporate,
        azienda: prima.azienda,
      },
    }
  }
  return verificaCliente(cliente)
}

/** Cancellazione vera: una sessione mai avvenuta non deve restare nel registro. Resta il log. */
export async function eliminaSessione(id: string): Promise<EsitoAzione> {
  const email = await operatoreCon('personal-check')
  if (!email) return NEGATO_CHECK

  const [sessione] = await leggiSessioni([id])
  if (!sessione) return { ok: false, errore: 'Sessione già eliminata.' }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('personal_sessioni').delete().eq('id', id)
  if (error) {
    console.error('Sessione personal non eliminata:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a eliminare la sessione. Riprova.' }
  }

  // Nel log tutta la riga: è l'unica traccia che resta della sessione.
  await registraLog(email, 'personal_sessione_eliminata', {
    entita: 'personal_sessioni',
    entitaId: id,
    dettagli: { sessione },
  })

  aggiornaPagine([sessione.persona_id])
  return { ok: true, messaggio: 'Sessione eliminata.' }
}

// ─────────────────────────────────────────────────── compensi (amministrazione)

export async function impostaCompenso(input: {
  trainerEmail: string
  validoDal: string
  compenso: string
}): Promise<EsitoAzione> {
  const email = await operatoreCon('personal-amministrazione')
  if (!email) return { ok: false, errore: 'Non hai il permesso di impostare i compensi.' }

  const trainerEmail = String(input?.trainerEmail ?? '').trim().toLowerCase()
  const validoDal = String(input?.validoDal ?? '')
  // La virgola è il separatore che si scrive in Italia: «35,50».
  const testo = String(input?.compenso ?? '').trim().replace(/\s|€/g, '').replace(',', '.')
  const compenso = Number(testo)

  if (!trainerEmail) return { ok: false, errore: 'Trainer mancante.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validoDal)) return { ok: false, errore: 'Indica da quando vale il compenso.' }
  if (!testo || !Number.isFinite(compenso) || compenso < 0 || compenso > 10000) {
    return { ok: false, errore: 'Scrivi il compenso a sessione in euro, per esempio 35 o 35,50.' }
  }

  const supabase = createSupabaseServiceClient()
  // Stesso trainer e stessa data: si corregge il valore invece di avere due
  // righe che si contendono lo stesso giorno.
  const { error } = await supabase.from('personal_compensi').upsert(
    {
      trainer_email: trainerEmail,
      valido_dal: validoDal,
      compenso_sessione: Math.round(compenso * 100) / 100,
      impostato_da: email,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'trainer_email,valido_dal' }
  )

  if (error) {
    console.error('Compenso personal non salvato:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a salvare il compenso. Riprova.' }
  }

  await registraLog(email, 'personal_compenso_impostato', {
    entita: 'personal_compensi',
    entitaId: trainerEmail,
    dettagli: { trainer: trainerEmail, valido_dal: validoDal, compenso_sessione: compenso },
  })

  revalidatePath('/dashboard/personal/amministrazione')
  return { ok: true, messaggio: 'Compenso salvato.' }
}
