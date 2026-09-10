// Come si chiama e come si ordina chi lavora nel pannello.
//
// L'email è la chiave di staff_users e resta quella che si scrive nelle righe
// di lavorazione (`gestito_da`, `esito_da`, `assegnato_a`): sopravvive alla
// persona, e un log che dicesse solo "Maurizio" non basterebbe a ritrovarla
// due anni dopo. Ma *mostrare* l'email al posto del nome fa leggere un
// indirizzo dove serve una persona — e su un pannello dove tutti sono
// @ronchiverdi.it la parte che distingue è quella che si legge peggio.
//
// Quindi: email nel database, nome e cognome sullo schermo. Questo file è
// l'unico posto in cui quella traduzione avviene.
//
// Nessun import server-only: lo usano sia i Server Component sia i componenti
// client, che ricevono la mappa già pronta.

export type RigaStaff = {
  email: string
  nome?: string | null
  cognome?: string | null
}

/**
 * "Nome Cognome", o l'email se non li ha ancora scritti.
 *
 * Il ripiego sull'email non è un dettaglio: chi viene invitato compare in
 * elenco prima di aver impostato la password (è lì che nome e cognome si
 * scrivono, vedi app/imposta-password), e in quella finestra un trattino al
 * posto del nome renderebbe la riga irriconoscibile.
 */
export function nomeStaff(riga: RigaStaff | null | undefined): string {
  if (!riga) return ''
  const nome = `${riga.nome ?? ''} ${riga.cognome ?? ''}`.trim()
  return nome || riga.email
}

/**
 * Email → "Nome Cognome", per tradurre in blocco le righe già lette.
 *
 * Le pagine leggono staff_users una volta e passano questa mappa ai
 * componenti: cercare il nome una riga alla volta vorrebbe dire una query per
 * ogni voce d'agenda.
 */
export function mappaNomiStaff(righe: readonly RigaStaff[] | null | undefined): Record<string, string> {
  const mappa: Record<string, string> = {}
  for (const riga of righe ?? []) {
    if (riga?.email) mappa[riga.email] = nomeStaff(riga)
  }
  return mappa
}

/**
 * Il nome di chi ha un'email, quando la mappa ce l'ha.
 *
 * Ritorna l'email tale e quale se quella persona non è (più) in staff_users:
 * una lavorazione fatta da chi se n'è andato deve restare attribuita, non
 * diventare anonima.
 */
export function nomeDiEmail(
  email: string | null | undefined,
  nomi: Record<string, string> | undefined
): string | null {
  if (!email) return null
  return nomi?.[email] ?? email
}

/**
 * Ordina per cognome, poi per nome, e in fondo chi non ha né l'uno né l'altro.
 *
 * `localeCompare` con la locale italiana e `sensitivity: 'base'`: senza,
 * "D'Auria" e "de Rossi" finiscono lontani da dove chi scorre l'elenco li
 * cerca — le maiuscole e gli accenti ordinano prima delle lettere.
 *
 * Chi non ha ancora scritto il cognome va in coda invece che in cima: sono le
 * righe appena invitate, e mettere in testa all'elenco chi non si è ancora
 * presentato spingerebbe giù tutti gli altri a ogni invito.
 */
export function confrontaPerCognome(a: RigaStaff, b: RigaStaff): number {
  const cognomeA = (a.cognome ?? '').trim()
  const cognomeB = (b.cognome ?? '').trim()
  if (!cognomeA !== !cognomeB) return cognomeA ? -1 : 1

  const perCognome = cognomeA.localeCompare(cognomeB, 'it', { sensitivity: 'base' })
  if (perCognome !== 0) return perCognome

  const perNome = (a.nome ?? '').trim().localeCompare((b.nome ?? '').trim(), 'it', {
    sensitivity: 'base',
  })
  if (perNome !== 0) return perNome

  return a.email.localeCompare(b.email, 'it', { sensitivity: 'base' })
}

/** L'elenco ordinato per cognome, senza toccare l'array di partenza. */
export function ordinaPerCognome<T extends RigaStaff>(righe: readonly T[]): T[] {
  return [...righe].sort(confrontaPerCognome)
}
