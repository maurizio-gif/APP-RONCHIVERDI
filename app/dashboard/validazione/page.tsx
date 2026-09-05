import { redirect } from 'next/navigation'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { Validatore } from './Validatore'

export const dynamic = 'force-dynamic'

// La pagina che usa il centro medico, dentro il pannello come ogni altra
// sezione: account personale, permesso assegnabile, e chi brucia un codice
// lascia il proprio nome accanto al voucher. Al partner si assegna questa
// sola sezione — è marcata "esterna" in lib/auth/sezioni.ts, quindi il
// pannello non gli mostra nemmeno il Riepilogo.
export default async function ValidazionePage() {
  if (!(await utenteHaSezione('validazione-voucher'))) {
    redirect('/dashboard')
  }

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Visita medico-sportiva</p>
        <h1>Validazione voucher</h1>
        <p className="muted">
          Inserisci il codice che il socio detta al telefono: la pagina dice se è valido e a chi è
          intestato, e lo registra come utilizzato quando confermi la prenotazione.
        </p>
      </div>

      <Validatore />
    </>
  )
}
