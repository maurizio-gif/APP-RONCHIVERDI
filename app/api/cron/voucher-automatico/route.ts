import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { eseguiVoucherAutomatico } from '@/lib/voucher-automatico'

export const dynamic = 'force-dynamic'

// Ogni 15 minuti (vedi vercel.json) cerca le nuove vendite "(cer000)" e manda
// al socio il codice della visita medica. La regola sta in
// lib/voucher-automatico.ts; qui c'è solo chi la chiama.
//
// Finché in tabella `automazioni` la riga voucher_cer000 è spenta, il giro
// non fa nulla e risponde { attiva: false }. Con ?prova=1 elenca le vendite
// degli ultimi giorni che riceverebbero il codice, senza emettere né
// inviare: funziona anche a interruttore spento, per controllare il filtro
// prima di accenderlo.
export async function GET(request: Request) {
  const segreto = process.env.CRON_SECRET
  const url = new URL(request.url)

  // Come gli altri cron: Vercel manda il segreto nell'header Authorization,
  // ?secret= serve solo a lanciarlo a mano.
  const auth = request.headers.get('authorization')
  const autorizzato = !!segreto && (auth === `Bearer ${segreto}` || url.searchParams.get('secret') === segreto)
  if (!autorizzato) {
    return NextResponse.json({ ok: false, errore: 'Non autorizzato' }, { status: 401 })
  }

  try {
    const esito = await eseguiVoucherAutomatico({ prova: url.searchParams.get('prova') === '1' })
    if (esito.attiva && !esito.prova && esito.candidati.some((c) => c.esito === 'emesso')) {
      revalidatePath('/dashboard/voucher')
    }
    return NextResponse.json({ ok: true, ...esito })
  } catch (e) {
    const messaggio = e instanceof Error ? e.message : String(e)
    console.error('Voucher automatico: giro non riuscito —', messaggio)
    return NextResponse.json({ ok: false, errore: messaggio }, { status: 500 })
  }
}
