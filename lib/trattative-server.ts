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

// ── Chi chiude l'evento si prende la trattativa ───────────────────────────
//
// L'alternativa era vietare l'assegnazione finché l'evento non ha un esito,
// per impedire che qualcuno si intesti un lead senza poi chiamarlo. Non
// regge, per tre ragioni:
//
//  1. prendere in carico è un impegno preso **prima** del lavoro, e serve a
//     una cosa sola — impedire che in due si chiami la stessa persona. Se
//     l'assegnazione arrivasse solo dopo l'esito, fra l'arrivo del lead e la
//     telefonata la trattativa sarebbe di nessuno: cioè esattamente lo stato
//     che la sezione «Trattative da prendere in carico» esiste per svuotare;
//  2. i casi normali non hanno un esito finale subito. «Non risponde»,
//     «richiamami giovedì», «gli ho scritto e aspetto»: in tutti questi la
//     trattativa deve già essere di qualcuno, o un collega richiama chi ha
//     appena detto giovedì;
//  3. una regola che si può soddisfare solo registrando il falso, si
//     soddisfa registrando il falso: l'unico modo di ottenere l'assegnazione
//     diventerebbe chiudere «fallita» quello che è solo in corso.
//
// Quindi l'assegnazione alla chiusura c'è, ma come **aggiunta** e non come
// precondizione: chi mette l'esito a un evento di una trattativa che nessuno
// segue se la prende. Il gesto «gestisci l'evento e ti si assegna in
// automatico» funziona; semplicemente non è l'unica strada.

/**
 * La trattativa a cui appartiene un evento, qualunque ne sia la sorgente.
 *
 * Tre strade, perché un evento si aggancia a tre cose diverse:
 *
 *   una richiesta dal sito  → la sua `opportunita_id`, scritta dal trigger
 *                             collega_persona_a_contatto;
 *   un task su una richiesta→ l'opportunità di quella richiesta;
 *   un task su una persona  → la trattativa aperta della persona. Al massimo
 *                             ce n'è una (vedi trova_o_crea_opportunita), e
 *                             agganciare gli eventi alla persona invece che
 *                             all'opportunità è proprio la scelta che li fa
 *                             sopravvivere alla chiusura di una trattativa.
 *
 * Ritorna null dove non c'è niente da collegare, che è un caso normale: un
 * promemoria su una persona senza trattative aperte non ne apre una perché
 * qualcuno lo spunta.
 */
export async function trattativaDellEvento(
  origine: 'task' | 'form_contatti',
  id: string
): Promise<string | null> {
  const supabase = createSupabaseServiceClient()

  if (origine === 'form_contatti') {
    const { data } = await supabase
      .from('form_contatti')
      .select('opportunita_id')
      .eq('id', id)
      .maybeSingle()
    return (data?.opportunita_id as string) ?? null
  }

  const { data: task } = await supabase
    .from('task')
    .select('entita, entita_id')
    .eq('id', id)
    .maybeSingle()
  if (!task?.entita_id) return null

  if (task.entita === 'form_contatti') {
    const { data } = await supabase
      .from('form_contatti')
      .select('opportunita_id')
      .eq('id', task.entita_id as string)
      .maybeSingle()
    return (data?.opportunita_id as string) ?? null
  }

  if (task.entita === 'persona') {
    const { data } = await supabase
      .from('opportunita')
      .select('id')
      .eq('persona_id', task.entita_id as string)
      .not('stato', 'in', '("vinto","perso","annullato")')
      .order('creato_il', { ascending: false })
      .limit(1)
      .maybeSingle()
    return (data?.id as string) ?? null
  }

  return null
}

/**
 * Intesta a `operatore` la trattativa dell'evento appena chiuso, **se non la
 * seguiva nessuno**.
 *
 * L'update è condizionato (`assegnato_a is null` e stato non chiuso) e non
 * preceduto da una lettura: due operatori che chiudono nello stesso istante
 * leggerebbero entrambi «libera» e si sovrascriverebbero a vicenda. Così il
 * secondo aggiorna zero righe e la trattativa resta del primo, che è la
 * risposta giusta.
 *
 * Gli stati chiusi restano fuori: mettere l'esito a un evento vecchio di una
 * trattativa già vinta non deve riaprirla in gestione a chi ha fatto l'ordine.
 *
 * Non fallisce mai in modo rumoroso, per la stessa ragione di
 * trattativaPerEvento: l'evento è già chiuso quando questa viene chiamata, e
 * un errore rosso su un salvataggio riuscito porta a riprovare.
 */
export async function prendiChiudendoEvento(
  origine: 'task' | 'form_contatti',
  idEvento: string,
  operatore: string | null
): Promise<boolean> {
  if (!operatore) return false

  try {
    const idTrattativa = await trattativaDellEvento(origine, idEvento)
    if (!idTrattativa) return false

    const adesso = new Date().toISOString()
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase
      .from('opportunita')
      .update({
        assegnato_a: operatore,
        assegnato_il: adesso,
        assegnato_da: operatore,
        // Una libera è in «da prendere in carico»; una rimasta orfana può
        // essere già in gestione. In entrambi i casi, dopo, è in gestione.
        stato: 'in_gestione',
        stato_da: operatore,
        stato_il: adesso,
      })
      .eq('id', idTrattativa)
      .is('assegnato_a', null)
      .in('stato', ['nuovo', 'in_gestione'])
      .select('id')

    if (error) {
      console.error('Trattativa dell’evento chiuso non assegnata:', error.message)
      return false
    }
    return (data ?? []).length > 0
  } catch (e) {
    console.error('Trattativa dell’evento chiuso non assegnata:', e)
    return false
  }
}

/** Cosa dire a chi ha appena chiuso l'evento e si è preso la trattativa. */
export const AVVISO_PRESA_CHIUDENDO =
  'La trattativa di questo contatto era libera: ora la segui tu.'
