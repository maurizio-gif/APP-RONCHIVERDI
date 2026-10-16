import { NextResponse } from 'next/server'
import { statoTicketCorrente } from '@/lib/ticket-server'

export const dynamic = 'force-dynamic'

// L'avviso dei ticket da leggere si aggiorna da qui, come quello dei
// messaggi interni (vedi app/api/interno/notifiche/stato): una route e non
// una Server Action, così il polling non si mette in coda davanti alle
// navigazioni. Sotto /api/interno il middleware garantisce l'operatore.
export async function GET() {
  const stato = await statoTicketCorrente()
  return NextResponse.json(stato, { headers: { 'cache-control': 'no-store' } })
}
