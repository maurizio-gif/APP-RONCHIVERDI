// Da dove arriva una trattativa, come si legge in un colpo d'occhio.
//
// Il dato esisteva già in due posti — `opportunita.origine` e
// `form_contatti.origine` — ma da nessuna parte diventava una cosa da
// guardare: in dashboard una trattativa nata al banco e una arrivata dal
// form del sito erano due righe identiche. Sono due telefonate diverse.
// Chi è passato dal Guest Register era qui, ha già parlato con qualcuno
// della segreteria, e richiamarlo come un contatto freddo è il modo di
// sembrare disorganizzati; chi ha scritto dal sito non ha mai visto nessuno.
//
// Tre casi contano davvero, e il quarto serve a non mentire:
//
//   sito           — il form del sito, generico o inline di pagina;
//   guest-register — il banco, cioè il registro ospiti (`walk-in`);
//   agenda         — nata da un evento scritto in agenda, senza nessuna
//                    richiesta dietro (vedi trattativa_per_evento in
//                    scripts/sql/2026-09-10-evento-apre-trattativa.sql);
//   altro          — un'origine che questo file non conosce. Non si
//                    indovina: si dice «Altro» e si riporta la stringa, così
//                    chi la vede sa che c'è un canale da instradare qui.
//
// Nessun import server-only: lo usano sia i Server Component sia i
// componenti client.

export type ChiaveProvenienza = 'sito' | 'guest-register' | 'agenda' | 'altro'

export type Provenienza = {
  chiave: ChiaveProvenienza
  /** Quello che si legge nella targhetta: corto, perché sta in riga. */
  etichetta: string
  /** Classe di colore della targhetta. */
  classe: string
  /** Una riga in più nell'espansione, dove c'è spazio per spiegarsi. */
  spiegazione: string
}

/** L'origine con cui il registro ospiti marca le proprie righe. */
export const ORIGINE_BANCO = 'walk-in'

/**
 * Le origini che il sito scrive, per esteso.
 *
 * Un elenco e non «tutto ciò che non è walk-in», perché «Altro» deve restare
 * un'informazione: il giorno che nasce un canale d'ingresso nuovo — un
 * chiosco in reception, un'integrazione, un import — le sue righe devono
 * comparire marcate «Altro» e farsi notare, non travestirsi da richieste dal
 * sito. Aggiungere qui è il gesto con cui si dichiara di averle riconosciute.
 *
 *   null          — le righe più vecchie, scritte prima che il sito marcasse
 *                   l'origine;
 *   'lead-modal'  — il form generico, quello che si apre dai pulsanti di
 *                   tutto il sito;
 *   *-inline      — i form dentro una pagina (chinesis-inline,
 *                   fitness-manager-inline: vedi `origine` in lib/richieste.ts).
 */
const ORIGINI_SITO: readonly (string | null)[] = [null, 'lead-modal']

const SITO: Provenienza = {
  chiave: 'sito',
  etichetta: 'Sito',
  classe: 'da-sito',
  spiegazione: 'Ha scritto dal sito: non l’ha ancora incontrato nessuno.',
}

const GUEST_REGISTER: Provenienza = {
  chiave: 'guest-register',
  etichetta: 'Guest Register',
  classe: 'da-banco',
  spiegazione: 'Registrato al banco: è già stato qui e ha parlato con la segreteria.',
}

const AGENDA: Provenienza = {
  chiave: 'agenda',
  etichetta: 'Agenda',
  classe: 'da-agenda',
  spiegazione: 'Aperta da un evento in agenda, non da una richiesta.',
}

/**
 * Da dove viene questa trattativa.
 *
 * Si guarda l'origine della **richiesta** prima di quella della trattativa:
 * la trattativa è della persona e vive più delle sue richieste, quindi una
 * aperta al banco a maggio e ripresa da una richiesta dal sito a settembre
 * porta ancora `origine = 'walk-in'` addosso — ma la cosa che si sta per
 * lavorare è arrivata dal sito, ed è quella che deve dire come ci si
 * presenta al telefono.
 */
export function provenienzaTrattativa({
  origineRichiesta,
  origineTrattativa,
  haRichiesta,
}: {
  /** `form_contatti.origine` della richiesta che si sta guardando. */
  origineRichiesta?: string | null
  /** `opportunita.origine`: da dove è nata la trattativa. */
  origineTrattativa?: string | null
  /** false quando nessuna richiesta è agganciata: è nata in agenda. */
  haRichiesta: boolean
}): Provenienza {
  const origine = haRichiesta ? origineRichiesta : origineTrattativa

  if (origine === ORIGINE_BANCO) return GUEST_REGISTER
  if (!haRichiesta) return AGENDA
  // Il form generico e i form di pagina sono entrambi il sito: da quale
  // pagina è partito è un dettaglio del percorso, non un canale diverso da
  // presidiare.
  if (ORIGINI_SITO.includes(origine ?? null) || origine?.endsWith('-inline')) return SITO

  return {
    chiave: 'altro',
    etichetta: 'Altro',
    classe: 'da-altro',
    spiegazione: `Origine non riconosciuta: "${origine}". Va instradata in lib/provenienza.ts.`,
  }
}
