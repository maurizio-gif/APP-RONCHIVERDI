import { NextResponse } from 'next/server'
import { getAvvisiLavoro } from '@/app/dashboard/opportunita-actions'

export const dynamic = 'force-dynamic'

// L'avviso del lavoro appena arrivato si aggiorna da qui e non con una Server
// Action, per la stessa ragione del badge dei messaggi interni: un'azione è un
// POST alla pagina aperta e finisce nella coda del router davanti alle
// navigazioni, quindi ogni giro di polling rallenterebbe il cambio di pagina.
//
// I permessi li controlla getAvvisiLavoro, che legge l'operatore corrente
// dall'header scritto dal middleware e tiene solo le sezioni che ha sul
// profilo: chi non ne ha nessuna riceve un elenco vuoto, non un errore.
export async function GET() {
  const avvisi = await getAvvisiLavoro()
  return NextResponse.json({ avvisi }, { headers: { 'cache-control': 'no-store' } })
}
