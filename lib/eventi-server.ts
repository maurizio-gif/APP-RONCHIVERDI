import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { nomePersona } from '@/lib/persone'

// Server-only (usa il client service role): importare solo da Server
// Component/Server Action, mai da un file "use client".

/** Il contatto agganciato a una voce, come lo vuole voceDaTask. */
export type ContattoDiVoce = {
  id: string
  nome: string | null
  email: string | null
  cellulare: string | null
}

/**
 * Il contatto di ogni voce della segreteria, per id di `task`.
 *
 * **I due agganci, non uno solo** (vedi ENTITA_COLLEGAMENTO in lib/eventi.ts):
 *
 *  - `persona` — l'id è già quello del contatto. È il caso delle voci create
 *    a mano dall'agenda;
 *  - `form_contatti` — l'id è quello della richiesta dal sito, e il contatto
 *    si raggiunge dal suo `persona_id`. È il caso dei **seguiti**: si chiude
 *    una richiesta, si programma il richiamo, e quel richiamo nasce agganciato
 *    alla richiesta.
 *
 * Agenda, dashboard e Core Manager risolvevano solo il primo: sul secondo la
 * voce arrivava a schermo senza nome del contatto, senza recapiti — cioè con
 * «Chiama» e «WhatsApp» spariti dall'espansione — e senza il pulsante per la
 * sua scheda, che è esattamente quello che serve aprendo un richiamo. Le tre
 * pagine avevano lo stesso ripiego scritto tre volte, quindi la correzione
 * sta qui una volta sola.
 *
 * Le due strade si leggono **insieme**, non in fila: le persone agganciate
 * direttamente, e le richieste con la loro persona già incorporata (la
 * relazione `form_contatti.persona_id → persone`). Prima si risolveva la
 * richiesta e solo dopo si leggeva la persona: un andata e ritorno in più
 * verso Supabase davanti a ogni agenda, dashboard e Core Manager.
 *
 * Nessuna lettura quando l'elenco è vuoto, e quella su `form_contatti` solo
 * quando ci sono voci di quel tipo.
 */
export async function contattiDelleVoci(
  righe: Record<string, any>[]
): Promise<Map<string, ContattoDiVoce>> {
  const perVoce = new Map<string, ContattoDiVoce>()
  if (righe.length === 0) return perVoce

  const supabase = createSupabaseServiceClient()

  const personeDirette = new Set<string>()
  const richiesteDaRisolvere = new Set<string>()
  for (const riga of righe) {
    if (!riga.entita_id) continue
    if (riga.entita === 'persona') personeDirette.add(riga.entita_id as string)
    else if (riga.entita === 'form_contatti') richiesteDaRisolvere.add(riga.entita_id as string)
  }

  const COLONNE_PERSONA = 'id, nome, cognome, email, cellulare'
  const [{ data: persone, error: errorePersone }, { data: richieste, error: erroreRichieste }] =
    await Promise.all([
      personeDirette.size > 0
        ? supabase.from('persone').select(COLONNE_PERSONA).in('id', [...personeDirette])
        : Promise.resolve({ data: [] as Record<string, any>[], error: null }),
      richiesteDaRisolvere.size > 0
        ? supabase
            .from('form_contatti')
            .select(`id, persona:persone(${COLONNE_PERSONA})`)
            .in('id', [...richiesteDaRisolvere])
        : Promise.resolve({ data: [] as Record<string, any>[], error: null }),
    ])

  // Nessuno dei due errori è un motivo per non disegnare l'agenda: senza
  // queste letture le voci restano, con il solo titolo. Ma va nei log, o un
  // elenco di richiami senza recapiti si legge come un'anagrafica vuota.
  if (errorePersone) {
    console.error('Nomi dei contatti delle voci non letti:', errorePersone.message)
  }
  if (erroreRichieste) {
    console.error('Contatti dei seguiti non letti:', erroreRichieste.message)
  }

  const contatto = (p: Record<string, any>): ContattoDiVoce => ({
    id: p.id as string,
    nome: nomePersona(p),
    email: (p.email as string) ?? null,
    cellulare: (p.cellulare as string) ?? null,
  })

  const perPersona = new Map<string, ContattoDiVoce>(
    (persone ?? []).map((p) => [p.id as string, contatto(p)])
  )
  const perRichiesta = new Map<string, ContattoDiVoce>()
  for (const r of (richieste ?? []) as Record<string, any>[]) {
    // Molti-a-uno: PostgREST incorpora un oggetto, o null se la richiesta non
    // ha (ancora) una persona.
    if (r.persona) perRichiesta.set(r.id as string, contatto(r.persona))
  }

  for (const riga of righe) {
    if (!riga.entita_id) continue
    const trovato =
      riga.entita === 'persona'
        ? perPersona.get(riga.entita_id as string)
        : riga.entita === 'form_contatti'
          ? perRichiesta.get(riga.entita_id as string)
          : undefined
    if (trovato) perVoce.set(String(riga.id), trovato)
  }

  return perVoce
}
