import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getNomeUtente, getSezioniConsentite, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { oggiRoma } from '@/lib/agenda'
import { nomeFileReport, periodoPredefinito, sezioniDaParametro } from '@/lib/report'
import { caricaReport } from '@/lib/report-server'
import { costruisciPdf } from '@/lib/report-pdf'

export const dynamic = 'force-dynamic'
// pdf-lib è JavaScript puro, ma legge parecchie tabelle: il margine evita il
// timeout di default su un periodo lungo.
export const maxDuration = 60

// Il PDF del report, con gli stessi parametri della pagina (periodo, sezioni).
// Il permesso lo controlla la rotta: il middleware propaga solo l'email.
// Ogni scarico finisce nel controllo operatori, perché il report contiene
// incassi e numeri della direzione.
export async function GET(richiesta: Request) {
  if (!(await utenteHaSezione('report'))) return new NextResponse('Non autorizzato', { status: 403 })

  const url = new URL(richiesta.url)
  const parametri = {
    periodo: url.searchParams.get('periodo') ?? undefined,
    dal: url.searchParams.get('dal') ?? undefined,
    al: url.searchParams.get('al') ?? undefined,
  }
  const sezioni = sezioniDaParametro(url.searchParams.getAll('sezioni'), url.searchParams.has('inviato'))
  if (sezioni.length === 0) return new NextResponse('Scegli almeno una sezione.', { status: 400 })

  const email = emailCorrente()
  const periodo = periodoPredefinito(parametri, oggiRoma())
  try {
    const dati = await caricaReport(createSupabaseServiceClient(), periodo, sezioni, await getSezioniConsentite(email), await getNomeUtente(email))
    const pdf = await costruisciPdf(dati)
    await registraLog(email, 'report_scaricato', {
      dettagli: { dal: periodo.dal, al: periodo.al, sezioni: dati.sezioni.filter((s) => !dati.nonConsentite.includes(s)) },
    })
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nomeFileReport(periodo.dal, periodo.al)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('Report PDF non generato:', e)
    return new NextResponse(e instanceof Error ? e.message : 'Errore nella generazione del PDF.', { status: 500 })
  }
}
