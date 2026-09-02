import { rigaStaffCorrente } from './staff-server'

// Autorizzazione al pannello: la tabella staff_users invece di una variabile
// d'ambiente, così aggiungere o togliere qualcuno si fa da Gestione utenti
// senza toccare Vercel né rifare un deploy.
export function isStaffEmail(email: string | null | undefined): Promise<boolean> {
  return rigaStaffCorrente(email).then((riga) => !!riga)
}
