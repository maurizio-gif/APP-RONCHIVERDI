'use server'

import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { canaleDiRichiesta } from '@/lib/richieste'
import {
  MAX_ALTRE_VISITE,
  MAX_PAGINE,
  type AltraVisita,
  type PaginaVista,
  type Percorso,
  type SessioneVisita,
} from '@/lib/percorsoSito'

/** Le colonne della visita che servono alla riga di sintesi. */
const COLONNE_SESSIONE =
  'session_id, created_at, ultimo_contatto, pagine_viste, landing_page, referrer, utm_source, utm_medium, utm_campaign, dispositivo, citta, paese'

/**
 * Il percorso sul sito di una richiesta, caricato quando serve.
 *
 * Prende l'id della **richiesta** e non quello della sessione per due motivi
 * che vanno insieme: il permesso si verifica sul canale della richiesta, come
 * fanno le altre azioni di questa cartella, e così dal client non si può
 * chiedere una sessione qualunque passando un id trovato altrove.
 *
 * Chi ha l'anagrafica la vede comunque: dalla scheda di un contatto si
 * guardano richieste di canali diversi, e quella sezione è già il permesso di
 * leggerle tutte.
 *
 * Ritorna null se la richiesta non esiste o se chi chiede non ha il permesso.
 * Una richiesta senza percorso non è null ma un percorso vuoto: al pannello
 * serve poter dire «questa richiesta non ha una visita collegata», che è
 * un'informazione, non un errore.
 */
export async function caricaPercorso(idRichiesta: string): Promise<Percorso | null> {
  if (!idRichiesta) return null

  const supabase = createSupabaseServiceClient()
  let { data: richiesta, error } = await supabase
    .from('form_contatti')
    .select('attivita, settore, origine, session_id, visitor_id')
    .eq('id', idRichiesta)
    .maybeSingle()

  // La colonna visitor_id arriva con una migration del sito
  // (2026-09-11-visitor-id-e-sessione-del-lead.sql). Finché non è passata la
  // chiediamo e basta: il percorso della visita corrente si vede lo stesso,
  // sono le altre visite che non si possono cercare.
  if (error && /visitor_id/.test(error.message)) {
    ;({ data: richiesta } = await supabase
      .from('form_contatti')
      .select('attivita, settore, origine, session_id')
      .eq('id', idRichiesta)
      .maybeSingle())
  }

  if (!richiesta) return null

  const sezioni = await getSezioniConsentite(emailCorrente())
  const canale = canaleDiRichiesta(richiesta)
  const autorizzato = sezioni.includes('persone') || (!!canale && sezioni.includes(canale.chiave))
  if (!autorizzato) return null

  const sessionId = (richiesta.session_id as string | null) ?? null
  const visitorId = ((richiesta as { visitor_id?: string | null }).visitor_id as string | null) ?? null

  const { visite: altreVisite, troncate: altreTroncate } = await altreVisiteDi(
    supabase,
    visitorId,
    sessionId
  )

  if (!sessionId) {
    return { sessione: null, pagine: [], troncato: false, altreVisite, altreTroncate }
  }

  // Una pagina in più del massimo: è il modo per sapere se ne restano fuori
  // senza doverle contare tutte.
  const [{ data: sessione }, { data: pagine }] = await Promise.all([
    supabase.from('sessioni').select(COLONNE_SESSIONE).eq('session_id', sessionId).maybeSingle(),
    supabase
      .from('sessioni_pagine')
      .select('pagina, titolo, visto_at')
      .eq('session_id', sessionId)
      .order('visto_at', { ascending: true })
      .limit(MAX_PAGINE + 1),
  ])

  const viste = (pagine ?? []) as PaginaVista[]

  return {
    sessione: (sessione as SessioneVisita | null) ?? null,
    pagine: viste.slice(0, MAX_PAGINE),
    troncato: viste.length > MAX_PAGINE,
    altreVisite,
    altreTroncate,
  }
}

/**
 * Le altre visite della stessa persona, riconosciute dal visitor_id.
 *
 * È l'unica chiave che tiene insieme visite di giorni diversi: il session_id
 * vale per una visita sola. Senza visitor_id — chi non ha dato il consenso, e
 * i lead arrivati prima che il sito lo spedisse — l'elenco resta vuoto, che è
 * la risposta giusta: non è che non ci siano, è che non sappiamo quali sono.
 */
async function altreVisiteDi(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  visitorId: string | null,
  sessionIdCorrente: string | null
): Promise<{ visite: AltraVisita[]; troncate: boolean }> {
  if (!visitorId) return { visite: [], troncate: false }

  let query = supabase
    .from('sessioni')
    .select(`${COLONNE_SESSIONE}, convertita`)
    .eq('visitor_id', visitorId)
    .order('created_at', { ascending: false })
    .limit(MAX_ALTRE_VISITE + 1)

  // La visita in cui ha compilato è già raccontata pagina per pagina qui
  // sopra: ripeterla in fondo la farebbe sembrare due visite.
  if (sessionIdCorrente) query = query.neq('session_id', sessionIdCorrente)

  const { data } = await query
  const visite = (data ?? []) as AltraVisita[]

  return { visite: visite.slice(0, MAX_ALTRE_VISITE), troncate: visite.length > MAX_ALTRE_VISITE }
}
