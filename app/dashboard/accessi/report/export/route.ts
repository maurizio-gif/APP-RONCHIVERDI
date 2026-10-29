import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { oggiRoma } from '@/lib/agenda'
import { nomeFileReportAccessi, type ParametriReport } from '@/lib/accessi-report'
import { ScriptReportMancante, caricaReportAccessi } from '@/lib/accessi-report-server'
import { costruisciCsv, costruisciPdf, costruisciXlsx } from '@/lib/accessi-report-file'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Il report accessi scaricabile (Excel, CSV o PDF), con gli stessi parametri
// della pagina: il file contiene gli stessi numeri che la pagina mostrava.
// Il permesso lo controlla la rotta: il middleware propaga solo l'email.
export async function GET(richiesta: Request) {
  if (!(await utenteHaSezione('accessi'))) return new NextResponse('Non autorizzato', { status: 403 })

  const url = new URL(richiesta.url)
  const formato = url.searchParams.get('formato')
  if (formato !== 'xlsx' && formato !== 'csv' && formato !== 'pdf') return new NextResponse('Formato non valido.', { status: 400 })

  const parametri: ParametriReport = {
    dal: url.searchParams.get('dal') ?? undefined,
    al: url.searchParams.get('al') ?? undefined,
    varco: url.searchParams.getAll('varco'),
    persona: url.searchParams.getAll('persona'),
    q: url.searchParams.get('q') ?? undefined,
  }
  try {
    const { report, candidate, nessunaPersona } = await caricaReportAccessi(createSupabaseServiceClient(), parametri, oggiRoma())
    if (candidate.length > 0 || nessunaPersona) {
      return new NextResponse('Scegli prima il nominativo dalla pagina del report.', { status: 400 })
    }
    const nome = nomeFileReportAccessi(report)
    const intestazioni = { 'Cache-Control': 'no-store' }
    if (formato === 'csv') {
      return new NextResponse(costruisciCsv(report), {
        headers: { ...intestazioni, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}.csv"` },
      })
    }
    if (formato === 'xlsx') {
      return new NextResponse(new Uint8Array(costruisciXlsx(report)), {
        headers: {
          ...intestazioni,
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${nome}.xlsx"`,
        },
      })
    }
    const generatoIl = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' })
    return new NextResponse(Buffer.from(await costruisciPdf(report, generatoIl)), {
      headers: { ...intestazioni, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nome}.pdf"` },
    })
  } catch (e) {
    if (e instanceof ScriptReportMancante) return new NextResponse(e.message, { status: 500 })
    console.error('Report accessi non generato:', e)
    return new NextResponse(e instanceof Error ? e.message : 'Errore nella generazione del file.', { status: 500 })
  }
}
