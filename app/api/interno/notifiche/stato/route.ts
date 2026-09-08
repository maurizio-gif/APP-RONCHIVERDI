import { NextResponse } from 'next/server'
import { getStatoNotifiche } from '@/app/dashboard/notifiche/actions'

export const dynamic = 'force-dynamic'

// Il badge nel menu e l'avviso in evidenza si aggiornano da qui e non con una
// Server Action: un'azione è un POST alla pagina aperta e finisce nella stessa
// coda del router davanti alle navigazioni, quindi ogni giro di polling
// rallenterebbe il cambio di pagina (vedi NotificheProvider).
//
// Sta sotto /api/interno perché il middleware protegge solo /dashboard/*: qui
// il permesso lo controlla getStatoNotifiche, che legge l'operatore corrente
// dall'header e restituisce zero a chi non ha la sezione o non ha sessione.
export async function GET() {
  const stato = await getStatoNotifiche()
  return NextResponse.json(stato, { headers: { 'cache-control': 'no-store' } })
}
