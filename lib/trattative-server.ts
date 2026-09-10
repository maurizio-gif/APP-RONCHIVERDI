import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'

// Server-only (usa il client service role): importare solo da Server
// Action/Server Component, mai da un file "use client".

// L'evento in agenda apre la trattativa.
//
// L'agenda la tiene il settore core, cioè gli adulti: se un commerciale
// scrive un evento su una persona, quella persona è una trattativa in corso.
// Non serve che l'abbia dichiarato scegliendo un'attività di interesse — è il
// gesto stesso a dirlo.
//
// Il buco si vedeva proprio dove fa più male: l'agenda accetta contatti che
// in anagrafica non esistono ancora (li crea al volo, vedi creaVoce), quindi
// si poteva fissare un appuntamento a qualcuno che non compariva in nessuna
// pipeline. Ricopiando qui l'agenda di carta si sarebbe ricostruito il
// calendario senza il lavoro che rappresenta.
//
// La regola vive nel database (trattativa_per_evento, in
// scripts/sql/2026-09-10-evento-apre-trattativa.sql) e non qui: è la stessa
// ragione per cui ci vive trova_o_crea_persona — la decisione «esiste già o
// va creata?» va presa in un colpo solo, o due eventi scritti nello stesso
// istante aprono due trattative sulla stessa persona.

/**
 * Cos'è successo alla trattativa di quella persona:
 *
 *  - `creata` — non ne aveva una aperta: l'ha aperta l'evento, in gestione a
 *    chi l'ha scritto;
 *  - `presa_in_carico` — ce n'era una libera, e ora la segue chi ha scritto
 *    l'evento;
 *  - `avviata` — ce n'era una con un titolare ma ferma in «da prendere in
 *    carico»: il lavoro è cominciato, l'assegnatario resta il suo;
 *  - `invariata` — la stava già seguendo qualcuno. Non si tocca.
 */
export type AzioneTrattativa = 'creata' | 'presa_in_carico' | 'avviata' | 'invariata'

/** Cosa dire a chi ha appena salvato l'evento. `invariata` non merita una riga. */
export const AVVISO_TRATTATIVA: Record<AzioneTrattativa, string | null> = {
  creata: 'Aperta anche la trattativa di questo contatto, in gestione a te.',
  presa_in_carico: 'La trattativa di questo contatto era libera: ora la segui tu.',
  avviata: 'La trattativa di questo contatto è passata in gestione.',
  invariata: null,
}

/**
 * Assicura che la persona abbia una trattativa aperta, e la restituisce.
 *
 * **Non fallisce mai in modo rumoroso**, ed è voluto: l'evento è già scritto
 * quando questa viene chiamata, e far comparire un errore rosso su un
 * salvataggio riuscito porterebbe a riprovare — cioè a scrivere l'evento due
 * volte. Se la trattativa non si apre resta l'evento, che è il dato che non
 * si può perdere; il difetto si vede dai log e si rimedia dal pannello
 * prendendo in carico a mano.
 */
export async function trattativaPerEvento(
  personaId: string,
  operatore: string | null
): Promise<AzioneTrattativa | null> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc('trattativa_per_evento', {
    p_persona_id: personaId,
    p_operatore: operatore,
  })

  if (error) {
    console.error('Trattativa dell’evento non aperta:', error.message)
    return null
  }

  // `returns table` arriva come elenco di righe: qui è sempre una sola, e
  // nessuna se la persona non c'era.
  const riga = Array.isArray(data) ? data[0] : data
  const azione = riga?.azione as string | undefined
  return azione === 'creata' ||
    azione === 'presa_in_carico' ||
    azione === 'avviata' ||
    azione === 'invariata'
    ? azione
    : null
}
