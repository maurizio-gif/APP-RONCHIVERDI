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
