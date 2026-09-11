// Leggere colonne che il database potrebbe non avere ancora.
//
// Le migration di questo progetto si eseguono a mano nel SQL Editor di
// Supabase (vedi scripts/sql/), quindi fra il deploy del codice e la
// migration c'è una finestra — a volte di minuti, a volte del tempo che passa
// prima che qualcuno la esegua. In quella finestra PostgREST non ignora la
// colonna che non conosce: **fa fallire l'intera query**, e la pagina si
// svuota. Non è un degrado, è un guasto: un elenco vuoto si legge come «non
// c'è niente da fare», che è la bugia peggiore che un pannello di lavoro
// possa dire.
//
// Il ripiego è lo stesso che caricaPercorso già fa a mano per `visitor_id`
// (app/dashboard/percorso-actions.ts): si chiede tutto, e se l'errore nomina
// una delle colonne nuove si rilegge senza. Qui è scritto una volta invece
// che ricopiato a ogni lettura.
//
// **Va togliuto quando la migration è passata su tutti gli ambienti.** Non è
// un pattern da tenere: una tolleranza permanente vuol dire due forme
// possibili degli stessi dati per sempre, e il codice a valle deve
// continuare a difendersi da un `undefined` che non è mai un dato mancante
// vero — è solo una migration dimenticata.

type Risposta<T> = { data: T[] | null; error: { message: string } | null }

/**
 * Esegue la lettura con tutte le colonne; se il database non conosce ancora
 * una delle `nuove`, la ripete senza quelle.
 *
 * @param colonne L'elenco completo, nella forma `'a, b, c'` che prende
 * `.select()`.
 * @param nuove Le colonne introdotte da una migration non ancora eseguita
 * dappertutto.
 * @param esegui La lettura, parametrizzata sull'elenco di colonne: viene
 * richiamata una seconda volta col ripiego, quindi deve costruire la query da
 * zero e non riusarne una già eseguita.
 */
export async function conColonneNuove<T>(
  colonne: string,
  nuove: readonly string[],
  esegui: (colonne: string) => PromiseLike<Risposta<T>>
): Promise<Risposta<T>> {
  const primo = await esegui(colonne)
  if (!primo.error) return primo

  const mancante = nuove.find((c) => primo.error!.message.includes(c))
  if (!mancante) return primo

  const senza = colonne
    .split(',')
    .map((c) => c.trim())
    .filter((c) => !nuove.includes(c))
    .join(', ')

  // Nei log e non in silenzio: una pagina che funziona a metà senza dirlo a
  // nessuno resta a metà per settimane.
  console.warn(
    `Colonna "${mancante}" non ancora nel database: lettura senza ${nuove.join(', ')}. ` +
      'Esegui la migration in scripts/sql/.'
  )
  return esegui(senza)
}

/**
 * Le colonne di `form_contatti` introdotte da
 * scripts/sql/2026-09-11-evento-assegnato-alla-trattativa.sql: di chi è il
 * lavoro su una richiesta, distinto da chi l'ha chiusa.
 */
export const COLONNE_ASSEGNAZIONE_RICHIESTA = ['assegnato_a', 'assegnato_il', 'assegnato_da'] as const

/**
 * Le colonne di `opportunita` introdotte da
 * scripts/sql/2026-09-11-nota-della-vinta.sql: quale abbonamento è stato
 * venduto, e quanto vale il contratto.
 *
 * Solo in **lettura** si ripiega. La scrittura no: chiudere una trattativa
 * come vinta senza la sua nota vorrebbe dire salvare a metà qualcosa che è
 * appena stato dichiarato obbligatorio — cambiaStato preferisce rifiutare, e
 * dire quale migration manca.
 */
export const COLONNE_NOTA_VINTA = ['motivo_vinto', 'valore_euro'] as const
