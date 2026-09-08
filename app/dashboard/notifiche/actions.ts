'use server'

import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { SEZIONI } from '@/lib/auth/sezioni'
import { registraLog } from '@/lib/audit'
import {
  BUCKET_ALLEGATI,
  DIMENSIONE_MASSIMA_ALLEGATO,
  ERRORE_DIMENSIONE_ALLEGATO,
  ERRORE_TIPO_ALLEGATO,
  TIPI_ALLEGATO_CONSENTITI,
} from '@/lib/allegati'
import {
  LINK_PREDEFINITO,
  LUNGHEZZA_MASSIMA_MESSAGGIO,
  SEZIONE_NOTIFICHE,
  nomeOperatore,
} from '@/lib/notifiche'
import { inviaPush } from '@/lib/push'

// Esito come valore di ritorno e non throw: in produzione Next.js oscura il
// messaggio di un errore lanciato da una Server Action, e qui chi scrive deve
// sapere perché il messaggio non è partito.
export type EsitoAzione = { ok: true } | { ok: false; errore: string }

const NEGATO = { ok: false as const, errore: 'Non hai il permesso di usare i messaggi interni.' }
const SESSIONE_SCADUTA = {
  ok: false as const,
  errore: 'Sessione non valida: ricarica la pagina e riprova.',
}

// Le stesse voci offerte dalla tendina "Apri su" in ComponiNotifica, validate
// di nuovo qui: la Server Action non si fida del valore mandato dal client, e
// un link fuori da questo elenco ricade sul predefinito invece di finire così
// com'è nel payload della push.
//
// Fuori le sezioni "in arrivo" (non hanno una pagina dove atterrare) e quelle
// dei partner esterni (un operatore della segreteria che le toccasse verrebbe
// rimandato al Riepilogo, che è peggio di non offrirle).
const LINK_VALIDI = new Set(
  SEZIONI.filter((s) => !s.inArrivo && !s.esterna).map((s) => s.href)
)

async function operatoreAutorizzato(): Promise<string | null> {
  const email = emailCorrente()
  if (!email) return null
  if (!(await utenteHaSezione(SEZIONE_NOTIFICHE))) return null
  return email
}

/**
 * Invia un messaggio a uno o più colleghi.
 *
 * FormData e non argomenti separati perché serve poter allegare un file: una
 * Server Action riceve un File solo dentro un FormData.
 *
 * Una riga per destinatario, così ognuno ha la propria conferma di lettura
 * anche quando testo e allegato sono gli stessi.
 */
export async function inviaNotifica(formData: FormData): Promise<EsitoAzione> {
  const email = emailCorrente()
  if (!email) return SESSIONE_SCADUTA

  // Controllo lato server e non solo nella pagina: il permesso può essere
  // stato revocato dopo che il modulo era già aperto in una scheda.
  if (!(await utenteHaSezione(SEZIONE_NOTIFICHE))) return NEGATO

  const testo = String(formData.get('messaggio') ?? '')
    .trim()
    .slice(0, LUNGHEZZA_MASSIMA_MESSAGGIO)
  if (!testo) return { ok: false, errore: 'Scrivi un messaggio prima di inviarlo.' }

  const richiesti = [...new Set(formData.getAll('destinatari').map(String).filter(Boolean))]
  if (richiesti.length === 0) return { ok: false, errore: 'Scegli almeno un destinatario.' }

  const linkRichiesto = String(formData.get('link') ?? '')
  const link = LINK_VALIDI.has(linkRichiesto) ? linkRichiesto : LINK_PREDEFINITO

  const file = formData.get('allegato')
  const allegato = file instanceof File && file.size > 0 ? file : null

  if (allegato) {
    if (!TIPI_ALLEGATO_CONSENTITI[allegato.type]) return { ok: false, errore: ERRORE_TIPO_ALLEGATO }
    if (allegato.size > DIMENSIONE_MASSIMA_ALLEGATO) {
      return { ok: false, errore: ERRORE_DIMENSIONE_ALLEGATO }
    }
  }

  const supabase = createSupabaseServiceClient()

  // Non basta che il mittente abbia scelto un indirizzo nel modulo: chi non ha
  // (più) il permesso va escluso comunque, altrimenti scrivere a mano l'email
  // nella richiesta scavalcherebbe l'elenco filtrato della pagina.
  const { data: staffRichiesto, error: erroreStaff } = await supabase
    .from('staff_users')
    .select('email, sezioni_consentite')
    .in('email', richiesti)

  if (erroreStaff) {
    console.error('Destinatari non verificabili:', erroreStaff.message)
    return { ok: false, errore: 'Non è stato possibile verificare i destinatari. Riprova.' }
  }

  const destinatari = (staffRichiesto ?? [])
    .filter((s) => (s.sezioni_consentite ?? []).includes(SEZIONE_NOTIFICHE))
    .map((s) => s.email)

  if (destinatari.length === 0) {
    return { ok: false, errore: 'Nessuno dei destinatari scelti può ricevere messaggi interni.' }
  }

  let allegatoPath: string | null = null
  if (allegato) {
    allegatoPath = `${email}/${randomUUID()}${TIPI_ALLEGATO_CONSENTITI[allegato.type]}`
    const { error: erroreUpload } = await supabase.storage
      .from(BUCKET_ALLEGATI)
      .upload(allegatoPath, allegato, { contentType: allegato.type })

    if (erroreUpload) {
      console.error('Allegato non caricato:', erroreUpload.message)
      return { ok: false, errore: "Non è stato possibile caricare l'allegato. Riprova." }
    }
  }

  // Lo stesso batch_id su tutte le righe solo se i destinatari sono più di
  // uno: serve a mostrare a ciascuno "inviato anche a" senza toccare le righe
  // dei messaggi singoli, dove resta null.
  const batchId = destinatari.length > 1 ? randomUUID() : null

  const { error } = await supabase.from('notifiche').insert(
    destinatari.map((a_email) => ({
      da_email: email,
      a_email,
      messaggio: testo,
      allegato_path: allegatoPath,
      allegato_nome: allegato?.name ?? null,
      allegato_tipo: allegato?.type ?? null,
      allegato_dimensione: allegato?.size ?? null,
      batch_id: batchId,
    }))
  )

  if (error) {
    // Il file era già salito: senza le righe che lo citano resterebbe orfano
    // nel bucket, invisibile e non più cancellabile da nessuna interfaccia.
    if (allegatoPath) {
      await supabase.storage.from(BUCKET_ALLEGATI).remove([allegatoPath])
    }
    console.error('Messaggio interno non salvato:', error.message)
    return { ok: false, errore: 'Non è stato possibile inviare il messaggio. Riprova.' }
  }

  await registraLog(email, 'notifica_inviata', {
    entita: 'notifiche',
    dettagli: { destinatari, messaggio: testo, allegato: allegato?.name ?? null },
  })

  await provaInviaPush(supabase, email, destinatari, testo, link)

  revalidatePath('/dashboard/notifiche')
  return { ok: true }
}

// Il messaggio è già salvato e visibile (badge, avviso, elenco) a prescindere
// da come va la push: un dispositivo senza notifiche attive, senza rete o con
// una sottoscrizione scaduta non deve far fallire l'invio vero e proprio.
async function provaInviaPush(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  daEmail: string,
  destinatari: string[],
  testo: string,
  link: string
): Promise<void> {
  try {
    const [{ data: mittente }, { data: sottoscrizioni }] = await Promise.all([
      supabase.from('staff_users').select('nome, cognome').eq('email', daEmail).maybeSingle(),
      supabase
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth')
        .in('email', destinatari),
    ])

    if (!sottoscrizioni?.length) return

    const payload = {
      titolo: `Messaggio da ${nomeOperatore(mittente ?? undefined, daEmail)}`,
      corpo: testo.length > 140 ? `${testo.slice(0, 140)}…` : testo,
      url: link,
    }

    const esiti = await Promise.all(
      sottoscrizioni.map(async (s) => ({ id: s.id, ...(await inviaPush(s, payload)) }))
    )

    const scadute = esiti.filter((e) => !e.ok && e.scaduta).map((e) => e.id)
    if (scadute.length > 0) {
      await supabase.from('push_subscriptions').delete().in('id', scadute)
    }
  } catch (e) {
    // Nessuna gestione ulteriore: è un extra rispetto a badge, avviso, elenco.
    console.error('Push non inviate:', e)
  }
}

/**
 * Registra la conferma di lettura. Verifica lato server che il messaggio sia
 * davvero indirizzato a chi chiama: altrimenti passando un id a caso si
 * potrebbe confermare la lettura di un messaggio di un altro.
 */
export async function confermaLettura(id: number): Promise<EsitoAzione> {
  const email = await operatoreAutorizzato()
  if (!email) return NEGATO

  const supabase = createSupabaseServiceClient()
  const { data: riga } = await supabase
    .from('notifiche')
    .select('a_email, letta_il')
    .eq('id', id)
    .maybeSingle()

  if (!riga || riga.a_email !== email) return { ok: false, errore: 'Messaggio non trovato.' }

  // Già confermato: non si sovrascrive l'ora della prima conferma, che è il
  // dato che conta.
  if (!riga.letta_il) {
    const { error } = await supabase
      .from('notifiche')
      .update({ letta_il: new Date().toISOString() })
      .eq('id', id)
      .is('letta_il', null)

    if (error) {
      console.error('Conferma di lettura non salvata:', error.message)
      return { ok: false, errore: 'Non è stato possibile registrare la conferma. Riprova.' }
    }

    await registraLog(email, 'notifica_letta', { entita: 'notifiche', entitaId: String(id) })
  }

  revalidatePath('/dashboard/notifiche')
  return { ok: true }
}

/**
 * Solo il numero di messaggi da confermare, con una lettura indicizzata e
 * senza trasferire righe (head: true). La chiama il layout, che gira davanti
 * a ogni pagina del pannello: il badge deve essere giusto al primo render, o
 * si vedrebbe lampeggiare da zero al numero vero.
 *
 * Senza argomenti di proposito: ogni funzione esportata da un file
 * 'use server' è un endpoint richiamabile dal browser, e un parametro
 * `email` sarebbe il modo di contare i messaggi non letti di chiunque.
 */
export async function contaNonLette(): Promise<number> {
  return contaNonLettePer(emailCorrente())
}

async function contaNonLettePer(email: string | null): Promise<number> {
  if (!email) return 0

  const supabase = createSupabaseServiceClient()
  const { count, error } = await supabase
    .from('notifiche')
    .select('*', { count: 'exact', head: true })
    .eq('a_email', email)
    .is('letta_il', null)

  if (error) {
    console.error('Conteggio messaggi non letti non riuscito:', error.message)
    return 0
  }

  return count ?? 0
}

export type UltimoMessaggio = {
  id: number
  daEmail: string
  daNome: string
  messaggio: string
  quando: string
  /**
   * Quanti destinatari ha lo stesso invio, se più di uno: serve all'avviso per
   * far capire subito se il messaggio riguarda solo chi legge o anche altri,
   * senza aprire la sezione.
   */
  numeroDestinatari: number
  /** Null quando il destinatario è uno solo: vedi getDestinatariBatch. */
  batchId: string | null
}

/**
 * Interrogata a intervalli dal client (NotificheProvider) per il badge nel
 * menu e l'avviso in evidenza: solo il conteggio e il più recente da
 * confermare, non l'intero elenco.
 */
export async function getStatoNotifiche(): Promise<{
  nonLette: number
  ultimo: UltimoMessaggio | null
}> {
  const email = emailCorrente()
  if (!email) return { nonLette: 0, ultimo: null }

  // Chi non ha (più) il permesso non deve vedere badge né avviso, anche se il
  // polling stesse ancora girando in una scheda vecchia.
  if (!(await utenteHaSezione(SEZIONE_NOTIFICHE))) return { nonLette: 0, ultimo: null }

  const supabase = createSupabaseServiceClient()

  const [nonLette, { data: riga }] = await Promise.all([
    contaNonLettePer(email),
    supabase
      .from('notifiche')
      .select('id, da_email, messaggio, created_at, batch_id')
      .eq('a_email', email)
      .is('letta_il', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (!riga) return { nonLette, ultimo: null }

  const [{ data: mittente }, { count: numeroDestinatari }] = await Promise.all([
    supabase.from('staff_users').select('nome, cognome').eq('email', riga.da_email).maybeSingle(),
    riga.batch_id
      ? supabase
          .from('notifiche')
          .select('*', { count: 'exact', head: true })
          .eq('batch_id', riga.batch_id)
      : Promise.resolve({ count: 1 }),
  ])

  return {
    nonLette,
    ultimo: {
      id: riga.id,
      daEmail: riga.da_email,
      daNome: nomeOperatore(mittente ?? undefined, riga.da_email),
      messaggio: riga.messaggio,
      quando: riga.created_at,
      numeroDestinatari: numeroDestinatari ?? 1,
      batchId: riga.batch_id,
    },
  }
}

/**
 * I nomi degli altri destinatari di uno stesso invio, chiesti solo quando chi
 * legge apre il badge "A N destinatari" nell'avviso: non a ogni giro di
 * polling, per un caso che il più delle volte resta chiuso.
 */
export async function getDestinatariBatch(
  batchId: string
): Promise<{ ok: true; nomi: string[] } | { ok: false; errore: string }> {
  const email = await operatoreAutorizzato()
  if (!email) return NEGATO

  const supabase = createSupabaseServiceClient()
  const { data: righe, error } = await supabase
    .from('notifiche')
    .select('a_email')
    .eq('batch_id', batchId)

  if (error) {
    console.error('Destinatari del batch non leggibili:', error.message)
    return { ok: false, errore: 'Non è stato possibile leggere i destinatari.' }
  }

  // Chi chiama deve essere lui stesso fra i destinatari: un batch_id a caso
  // non deve poter rivelare chi ha ricevuto un messaggio non suo.
  if (!righe?.some((r) => r.a_email === email)) {
    return { ok: false, errore: 'Messaggio non trovato.' }
  }

  const indirizzi = [...new Set(righe.map((r) => r.a_email))]
  const { data: staff } = await supabase
    .from('staff_users')
    .select('email, nome, cognome')
    .in('email', indirizzi)
  const mappa = new Map((staff ?? []).map((s) => [s.email, s]))

  const nomi = indirizzi
    .map((indirizzo) => nomeOperatore(mappa.get(indirizzo), indirizzo))
    .sort((a, b) => a.localeCompare(b, 'it'))

  return { ok: true, nomi }
}
