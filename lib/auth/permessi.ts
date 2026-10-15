import { rigaStaffCorrente } from './staff-server'

// "Amministratore" nel pannello è chi ha puo_invitare: è il permesso che in
// Gestione utenti dà anche il diritto di cambiare i permessi altrui. Se un
// giorno i due ruoli andranno distinti basta aggiungere una colonna a
// staff_users e cambiare qui: le chiamate passano tutte da questa funzione.
//
// Server-only (usa il client service role): importare solo da Server
// Action/Server Component, mai da un file "use client".
export async function puoAmministrare(email: string | null | undefined): Promise<boolean> {
  return !!(await rigaStaffCorrente(email))?.puo_invitare
}

// Diritto di cancellare definitivamente un record (colonna puo_cancellare).
export async function puoCancellare(email: string | null | undefined): Promise<boolean> {
  return !!(await rigaStaffCorrente(email))?.puo_cancellare
}

/**
 * Diritto commerciale: può prendere in carico una trattativa libera ed essere
 * scelto come assegnatario (colonna commerciale, assegnabile da Gestione
 * utenti).
 */
export async function eCommerciale(email: string | null | undefined): Promise<boolean> {
  return !!(await rigaStaffCorrente(email))?.commerciale
}

/**
 * Diritto di spostare una trattativa che è di un altro operatore. Chi la ha
 * in mano può sempre passarla: il controllo serve per tutte le altre.
 */
export async function puoRiassegnare(email: string | null | undefined): Promise<boolean> {
  return !!(await rigaStaffCorrente(email))?.puo_riassegnare
}

/**
 * Chi vede la Dashboard New: i commerciali, che ci lavorano, e chi li
 * coordina (colonna vede_dashboard_new). Il secondo la legge senza diventare
 * commerciale: non compare fra gli assegnatari e non prende in carico.
 */
export async function vedeDashboardNew(email: string | null | undefined): Promise<boolean> {
  const riga = await rigaStaffCorrente(email)
  return !!(riga?.commerciale || riga?.vede_dashboard_new)
}
