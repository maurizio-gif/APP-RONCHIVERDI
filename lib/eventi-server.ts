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
 * Una lettura in più su `form_contatti` solo quando ci sono voci di quel tipo,
 * e nessuna quando l'elenco è vuoto.
 */
export async function contattiDelleVoci(
  righe: Record<string, any>[]
): Promise<Map<string, ContattoDiVoce>> {
  const perVoce = new Map<string, ContattoDiVoce>()
  if (righe.length === 0) return perVoce

  const supabase = createSupabaseServiceClient()

  // Voce → persona. Diretto per le voci agganciate a un contatto, da fare per
  // quelle agganciate a una richiesta.
  const personaDiVoce = new Map<string, string>()
  const richiesteDaRisolvere = new Set<string>()

  for (const riga of righe) {
    if (!riga.entita_id) continue
    if (riga.entita === 'persona') {
      personaDiVoce.set(String(riga.id), riga.entita_id as string)
    } else if (riga.entita === 'form_contatti') {
      richiesteDaRisolvere.add(riga.entita_id as string)
    }
  }

  if (richiesteDaRisolvere.size > 0) {
    const { data: richieste, error } = await supabase
      .from('form_contatti')
      .select('id, persona_id')
      .in('id', [...richiesteDaRisolvere])

    // Non è un motivo per non disegnare l'agenda: senza questa lettura le
    // voci restano, con il solo titolo — come prima. Ma va nei log, o un
    // elenco di richiami senza recapiti si legge come un'anagrafica vuota.
    if (error) {
      console.error('Contatti dei seguiti non letti:', error.message)
    }

    const personaDiRichiesta = new Map(
      (richieste ?? [])
        .filter((r) => r.persona_id)
        .map((r) => [r.id as string, r.persona_id as string])
    )

    for (const riga of righe) {
      if (riga.entita !== 'form_contatti' || !riga.entita_id) continue
      const persona = personaDiRichiesta.get(riga.entita_id as string)
      if (persona) personaDiVoce.set(String(riga.id), persona)
    }
  }

  const idPersone = [...new Set(personaDiVoce.values())]
  if (idPersone.length === 0) return perVoce

  const { data: persone, error } = await supabase
    .from('persone')
    .select('id, nome, cognome, email, cellulare')
    .in('id', idPersone)

  if (error) {
    console.error('Nomi dei contatti delle voci non letti:', error.message)
    return perVoce
  }

  const perId = new Map<string, ContattoDiVoce>(
    (persone ?? []).map((p) => [
      p.id as string,
      {
        id: p.id as string,
        nome: nomePersona(p),
        email: (p.email as string) ?? null,
        cellulare: (p.cellulare as string) ?? null,
      },
    ])
  )

  for (const [voce, persona] of personaDiVoce) {
    const contatto = perId.get(persona)
    if (contatto) perVoce.set(voce, contatto)
  }

  return perVoce
}
