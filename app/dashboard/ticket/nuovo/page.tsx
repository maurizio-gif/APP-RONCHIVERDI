import Link from 'next/link'
import { emailCorrente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { SEZIONI } from '@/lib/auth/sezioni'
import { NuovoTicket } from './NuovoTicket'

export const dynamic = 'force-dynamic'

// Aprire un ticket: per chiunque usi il CRM, senza permessi da avere. Le
// sezioni fra cui scegliere sono solo quelle del suo menu.
export default async function NuovoTicketPage() {
  const proprie = await getSezioniConsentite(emailCorrente())
  const sezioni = SEZIONI.filter((s) => proprie.includes(s.chiave)).map((s) => ({ chiave: s.chiave, label: s.label }))

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">
          <Link href="/dashboard/ticket">← I tuoi ticket</Link>
        </p>
        <h1>Apri un ticket</h1>
        <p className="muted">
          Per un problema nel CRM o una cosa che non riesci a fare. Lo legge Simone; se serve, lo passa a Maurizio.
        </p>
      </div>
      <NuovoTicket sezioni={sezioni} />
    </>
  )
}
