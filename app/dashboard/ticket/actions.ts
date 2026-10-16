'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import {
  avvisaGestore,
  gestoreDiLivello,
  leggiTicket,
  nomiStaff,
  ruoloCorrente,
  segnalaDaLeggere,
  togliDaLeggere,
} from '@/lib/ticket-server'
import { BUCKET_TICKET, MASSIMO_ALLEGATI, erroreAllegato, tipoAllegato, type Ticket } from '@/lib/ticket'

// Le azioni sui ticket. Ogni passo scrive un evento nella storia del ticket
// (ticket_eventi) e sposta il segnale «da leggere» su chi deve muoversi.
// Restituiscono { ok, errore } invece di lanciare: in produzione Next
// nasconde il messaggio di un'eccezione.

export type Esito = { ok: true; id?: string } | { ok: false; errore: string }

export type FileDaCaricare = { nome: string; tipo: string; byte: number }
export type AllegatoCaricato = { percorso: string; nome: string; tipo: string; byte: number }

// La cartella di ciascuno nel bucket: chi registra un allegato può indicare
// solo file caricati da lui.
function cartellaDi(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9._-]/g, '_')
}

// I file non passano dal server (Vercel limita il corpo di una richiesta a
// 4,5 MB, e un allegato può arrivare a 10): il server controlla tipo e peso
// e rilascia un URL firmato per ciascuno, il browser carica direttamente su
// Supabase Storage. Il bucket rifiuta comunque ciò che non è immagine o PDF
// o supera i 10 MB.
export async function preparaAllegati(
  file: FileDaCaricare[]
): Promise<{ ok: true; caricamenti: { percorso: string; token: string; tipo: string }[] } | { ok: false; errore: string }> {
  const email = emailCorrente()
  if (!email) return { ok: false, errore: 'Sessione scaduta: rientra nel CRM.' }
  if (file.length > MASSIMO_ALLEGATI) return { ok: false, errore: `Al massimo ${MASSIMO_ALLEGATI} allegati.` }
  for (const f of file) {
    const errore = erroreAllegato(f)
    if (errore) return { ok: false, errore }
  }
  const supabase = createSupabaseServiceClient()
  const caricamenti = []
  for (const f of file) {
    const tipo = tipoAllegato(f.nome, f.tipo)!
    const estensione = (f.nome.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)
    const percorso = `${cartellaDi(email)}/${randomUUID()}${estensione ? `.${estensione}` : ''}`
    const { data, error } = await supabase.storage.from(BUCKET_TICKET).createSignedUploadUrl(percorso)
    if (error || !data) return { ok: false, errore: 'Non riesco a preparare il caricamento. Riprova.' }
    caricamenti.push({ percorso, token: data.token, tipo })
  }
  return { ok: true, caricamenti }
}

async function registraAllegati(ticketId: string, eventoId: string | null, email: string, allegati: AllegatoCaricato[]) {
  const propri = allegati.filter((a) => a.percorso.startsWith(`${cartellaDi(email)}/`)).slice(0, MASSIMO_ALLEGATI)
  if (!propri.length) return
  const supabase = createSupabaseServiceClient()
  await supabase.from('ticket_allegati').insert(
    propri.map((a) => ({
      ticket_id: ticketId,
      evento_id: eventoId,
      percorso: a.percorso,
      nome: a.nome.slice(0, 200),
      tipo: a.tipo,
      byte: a.byte,
      caricato_da: email,
    }))
  )
}

function aggiorna() {
  revalidatePath('/dashboard/ticket', 'layout')
}

// ── apertura ────────────────────────────────────────────────────────────────

export async function apriTicket(dati: {
  sezione: string
  titolo: string
  descrizione: string
  allegati: AllegatoCaricato[]
}): Promise<Esito> {
  const email = emailCorrente()
  if (!email) return { ok: false, errore: 'Sessione scaduta: rientra nel CRM.' }

  const titolo = dati.titolo.trim().slice(0, 160)
  const descrizione = dati.descrizione.trim().slice(0, 8000)
  if (titolo.length < 4) return { ok: false, errore: 'Scrivi un titolo che dica di cosa si tratta.' }
  if (descrizione.length < 30)
    return { ok: false, errore: 'La descrizione è troppo breve: spiega il problema con nomi ed esempi.' }

  // La sezione deve essere una di quelle che chi scrive vede davvero.
  const sezioni = await getSezioniConsentite(email)
  const sezione = dati.sezione === '' ? null : dati.sezione
  if (sezione && !sezioni.includes(sezione)) return { ok: false, errore: 'Scegli una sezione fra quelle del tuo menu.' }

  const primo = await gestoreDiLivello(1)
  if (!primo) return { ok: false, errore: 'Nessun gestore dei ticket configurato: avvisa l’amministratore.' }

  const supabase = createSupabaseServiceClient()
  const { data: t, error } = await supabase
    .from('ticket')
    .insert({ aperto_da: email, sezione, titolo, descrizione, assegnato_a: primo })
    .select('*')
    .single()
  if (error || !t) {
    console.error('Ticket non aperto:', error?.message)
    return { ok: false, errore: 'Non sono riuscito ad aprire il ticket. Riprova.' }
  }
  const ticket = t as Ticket

  const { data: ev } = await supabase
    .from('ticket_eventi')
    .insert({ ticket_id: ticket.id, autore: email, tipo: 'apertura', testo: null, pubblico: true })
    .select('id')
    .single()
  await registraAllegati(ticket.id, ev?.id ?? null, email, dati.allegati)
  await segnalaDaLeggere(ticket.id, primo, 'Nuovo ticket')

  const nomi = await nomiStaff()
  const esito = await avvisaGestore(ticket, primo, 'nuovo', { chi: nomi.get(email) ?? email })
  if (!esito.ok) console.error('Email del nuovo ticket non partita:', esito.errore)

  await registraLog(email, 'ticket_aperto', { entita: 'ticket', entitaId: ticket.id, dettagli: { numero: ticket.numero } })
  aggiorna()
  return { ok: true, id: ticket.id }
}

// ── i passi della gestione ──────────────────────────────────────────────────

export type Passo = 'nota' | 'risposta' | 'escalation' | 'rimando' | 'replica' | 'chiudi' | 'riapri' | 'conferma'

export async function passoTicket(
  ticketId: string,
  passo: Passo,
  testoGrezzo: string,
  allegati: AllegatoCaricato[] = []
): Promise<Esito> {
  const ruolo = await ruoloCorrente()
  if (!ruolo) return { ok: false, errore: 'Sessione scaduta: rientra nel CRM.' }
  const t = await leggiTicket(ticketId)
  if (!t) return { ok: false, errore: 'Ticket non trovato.' }

  const io = ruolo.email
  const gestore = ruolo.livello !== null
  const richiedente = t.aperto_da === io
  if (!gestore && !richiedente) return { ok: false, errore: 'Questo ticket non è tuo.' }

  const testo = testoGrezzo.trim().slice(0, 8000) || null
  const supabase = createSupabaseServiceClient()
  const adesso = new Date().toISOString()
  let patch: Partial<Ticket> = {}
  let tipo: string
  let pubblico = false

  switch (passo) {
    case 'nota':
      if (!gestore) return { ok: false, errore: 'Le note interne sono di chi gestisce.' }
      if (!testo) return { ok: false, errore: 'Scrivi la nota.' }
      tipo = 'nota'
      break

    case 'risposta':
      if (!gestore) return { ok: false, errore: 'Solo chi gestisce risponde.' }
      if (t.stato === 'chiuso') return { ok: false, errore: 'Il ticket è chiuso: riaprilo per rispondere.' }
      if (!testo) return { ok: false, errore: 'Scrivi la risposta.' }
      tipo = 'risposta'
      pubblico = true
      patch = { stato: 'risposto' }
      break

    case 'escalation': {
      if (!gestore || t.livello !== 1) return { ok: false, errore: 'Si passa al secondo livello solo dal primo.' }
      if (!testo) return { ok: false, errore: 'Scrivi perché lo passi e cosa hai già verificato.' }
      const secondo = await gestoreDiLivello(2)
      if (!secondo) return { ok: false, errore: 'Nessun gestore di secondo livello configurato.' }
      tipo = 'escalation'
      patch = { livello: 2, assegnato_a: secondo, stato: 'aperto' }
      break
    }

    case 'rimando': {
      if (!gestore || t.livello !== 2) return { ok: false, errore: 'Si rimanda al primo livello solo dal secondo.' }
      const primo = await gestoreDiLivello(1)
      if (!primo) return { ok: false, errore: 'Nessun gestore di primo livello configurato.' }
      tipo = 'rimando'
      patch = { livello: 1, assegnato_a: primo, stato: 'aperto' }
      break
    }

    case 'replica':
      if (!richiedente) return { ok: false, errore: 'Risponde chi ha aperto il ticket.' }
      if (t.stato === 'chiuso') return { ok: false, errore: 'Il ticket è chiuso: riaprilo per scrivere.' }
      if (!testo) return { ok: false, errore: 'Scrivi la tua risposta.' }
      tipo = 'replica'
      pubblico = true
      patch = { stato: 'aperto' }
      break

    case 'chiudi':
      if (t.stato === 'chiuso') return { ok: false, errore: 'Il ticket è già chiuso.' }
      tipo = 'chiusura'
      pubblico = true
      patch = { stato: 'chiuso', chiuso_il: adesso, chiuso_da: io }
      break

    case 'riapri':
      if (t.stato !== 'chiuso') return { ok: false, errore: 'Il ticket è già aperto.' }
      tipo = 'riapertura'
      pubblico = true
      patch = { stato: 'aperto', chiuso_il: null, chiuso_da: null }
      break

    case 'conferma':
      // Chi ha aperto il ticket conferma di aver letto la chiusura fatta da
      // chi gestisce: non cambia niente, toglie solo il segnale.
      await togliDaLeggere(t.id, io)
      aggiorna()
      return { ok: true }

    default:
      return { ok: false, errore: 'Passo sconosciuto.' }
  }

  const { data: ev, error } = await supabase
    .from('ticket_eventi')
    .insert({ ticket_id: t.id, autore: io, tipo, testo, pubblico })
    .select('id')
    .single()
  if (error) {
    console.error('Passo del ticket non registrato:', error.message)
    return { ok: false, errore: 'Non sono riuscito a salvare. Riprova.' }
  }
  await supabase.from('ticket').update({ ...patch, aggiornato_il: adesso }).eq('id', t.id)
  await registraAllegati(t.id, ev?.id ?? null, io, allegati)

  // Il segnale passa a chi deve muoversi; chi ha appena agito ha letto.
  await togliDaLeggere(t.id, io)
  const aggiornato = { ...t, ...patch } as Ticket
  if (passo === 'risposta') await segnalaDaLeggere(t.id, t.aperto_da, 'Risposta al tuo ticket')
  if (passo === 'replica') await segnalaDaLeggere(t.id, t.assegnato_a, 'Nuova risposta')
  if (passo === 'riapri' && !gestore) await segnalaDaLeggere(t.id, t.assegnato_a, 'Ticket riaperto')
  if (passo === 'riapri' && gestore && !richiedente) await segnalaDaLeggere(t.id, t.aperto_da, 'Ticket riaperto')
  if (passo === 'escalation' || passo === 'rimando')
    await segnalaDaLeggere(t.id, aggiornato.assegnato_a, passo === 'escalation' ? 'Passato a te' : 'Rimandato a te')
  if (passo === 'chiudi') {
    // Chiuso da chi gestisce: chi l'ha aperto lo deve sapere e confermare.
    await supabase.from('ticket_da_leggere').delete().eq('ticket_id', t.id)
    if (!richiedente) await segnalaDaLeggere(t.id, t.aperto_da, 'Ticket chiuso')
  }

  if (passo === 'escalation') {
    const nomi = await nomiStaff()
    const esito = await avvisaGestore(aggiornato, aggiornato.assegnato_a, 'escalation', { chi: nomi.get(io) ?? io, nota: testo })
    if (!esito.ok) console.error('Email di secondo livello non partita:', esito.errore)
  }

  aggiorna()
  return { ok: true }
}

// Chi gestisce apre un ticket che gli è arrivato: è la presa visione. Il
// segnale si spegne e la storia lo registra (una volta per arrivo).
export async function prendiVisione(ticketId: string): Promise<Esito> {
  const ruolo = await ruoloCorrente()
  if (!ruolo?.livello) return { ok: false, errore: 'Non gestisci i ticket.' }
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('ticket_da_leggere')
    .delete()
    .eq('ticket_id', ticketId)
    .eq('email', ruolo.email)
    .select('ticket_id')
  if (data && data.length) {
    await supabase.from('ticket_eventi').insert({ ticket_id: ticketId, autore: ruolo.email, tipo: 'presa_visione', pubblico: false })
    aggiorna()
  }
  return { ok: true }
}
