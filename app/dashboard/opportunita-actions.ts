'use server'

import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente } from '@/lib/auth/sezioni-server'
import { rigaStaffCorrente } from '@/lib/auth/staff-server'
import { nomePersona } from '@/lib/persone'

// Le trattative libere che un commerciale può prendersi, per l'avviso che
// compare su qualunque pagina del pannello (vedi AvvisoOpportunita).
//
// Perché serve un avviso e non basta il riquadro in dashboard: una richiesta
// Club o Family che arriva alle 15 crea una trattativa senza titolare, e
// finché qualcuno non riapre il Riepilogo nessuno se ne accorge. Il numero
// c'è già; quello che mancava era che si facesse sentire.

/** Una trattativa senza titolare, come la mostra l'avviso. */
export type OpportunitaLibera = {
  id: string
  personaId: string
  nome: string
  email: string | null
  cellulare: string | null
  /** Quando è nata la trattativa. */
  quando: string
  /** Cosa ha chiesto, dall'ultima sua richiesta: è ciò che apre la telefonata. */
  attivita: string | null
  messaggio: string | null
}

/**
 * Chi riceve l'avviso: solo chi ha il **diritto commerciale** e la sezione
 * Club e Family.
 *
 * Il diritto commerciale è ciò che permette di prendere in carico (vedi
 * puoAssegnare in lib/pipeline.ts): suonare a chi non può agire sarebbe un
 * rumore e nient'altro. La sezione serve perché l'avviso porta lì.
 */
export async function puoRicevereAvvisoOpportunita(): Promise<boolean> {
  const riga = await rigaStaffCorrente(emailCorrente())
  return !!riga?.commerciale && (riga?.sezioni_consentite ?? []).includes('richieste-club')
}

export async function getOpportunitaLibere(): Promise<OpportunitaLibera[]> {
  if (!(await puoRicevereAvvisoOpportunita())) return []

  const supabase = createSupabaseServiceClient()

  // Senza titolare e ancora aperte: `nuovo` e `in_gestione` senza assegnatario
  // sono la stessa cosa per chi guarda — lavoro che nessuno ha in mano. Una
  // in gestione rimasta orfana (l'assegnatario è stato liberato) è anzi la
  // più urgente, perché qualcuno l'aveva già toccata.
  const { data, error } = await supabase
    .from('opportunita')
    .select('id, persona_id, creato_il')
    .is('assegnato_a', null)
    .in('stato', ['nuovo', 'in_gestione'])
    .order('creato_il', { ascending: false })
    .limit(20)

  if (error) {
    console.error('Trattative libere non lette:', error.message)
    return []
  }

  const righe = data ?? []
  if (righe.length === 0) return []

  const personaIds = [...new Set(righe.map((t) => t.persona_id as string))]

  const [{ data: persone, error: errorePersone }, { data: richieste }] = await Promise.all([
    supabase.from('persone').select('id, nome, cognome, email, cellulare').in('id', personaIds),
    // L'ultima richiesta di ciascuno: l'attività e la frase che ha scritto
    // sono quello che serve sapere prima di chiamare. In ordine crescente,
    // così scrivendo nella mappa vince l'ultima letta — la più recente.
    supabase
      .from('form_contatti')
      .select('persona_id, attivita_label, messaggio, created_at')
      .in('persona_id', personaIds)
      .order('created_at', { ascending: true }),
  ])

  if (errorePersone) {
    console.error('Nomi delle trattative libere non letti:', errorePersone.message)
  }

  const perPersona = new Map((persone ?? []).map((p) => [p.id as string, p]))
  const ultimaRichiesta = new Map<string, { attivita: string | null; messaggio: string | null }>()
  for (const r of richieste ?? []) {
    ultimaRichiesta.set(r.persona_id as string, {
      attivita: (r.attivita_label as string) ?? null,
      messaggio: (r.messaggio as string) ?? null,
    })
  }

  return righe.map((t) => {
    const persona = perPersona.get(t.persona_id as string)
    const richiesta = ultimaRichiesta.get(t.persona_id as string)
    return {
      id: t.id as string,
      personaId: t.persona_id as string,
      nome: persona ? nomePersona(persona) : 'Senza nome',
      email: (persona?.email as string) ?? null,
      cellulare: (persona?.cellulare as string) ?? null,
      quando: t.creato_il as string,
      attivita: richiesta?.attivita ?? null,
      messaggio: richiesta?.messaggio ?? null,
    }
  })
}
