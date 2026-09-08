import { NextResponse } from 'next/server'
import { getOpportunitaLibere } from '@/app/dashboard/opportunita-actions'

export const dynamic = 'force-dynamic'

// L'avviso delle trattative da prendere in carico si aggiorna da qui e non con
// una Server Action, per la stessa ragione del badge dei messaggi interni:
// un'azione è un POST alla pagina aperta e finisce nella coda del router
// davanti alle navigazioni, quindi ogni giro di polling rallenterebbe il
// cambio di pagina.
//
// Il permesso lo controlla getOpportunitaLibere, che legge l'operatore
// corrente dall'header scritto dal middleware: chi non è commerciale riceve
// un elenco vuoto, non un errore.
export async function GET() {
  const opportunita = await getOpportunitaLibere()
  return NextResponse.json({ opportunita }, { headers: { 'cache-control': 'no-store' } })
}
