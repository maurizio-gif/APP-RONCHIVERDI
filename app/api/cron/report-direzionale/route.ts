import { NextResponse } from 'next/server'
import { adessoRoma, oggiRoma } from '@/lib/agenda'
import { caricaResocontoDirezionale, componiEmailResoconto } from '@/lib/report-direzionale'
import { inviaEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

const DESTINATARIO = 'm.rolle@ronchiverdi.it'
const CC = ['maurizio@ready2digital.it']

// L'ora locale voluta è le 22:00 a Roma, ma un cron di Vercel si programma
// solo in UTC e non sa nulla dei cambi d'ora — vedi vercel.json: ci sono
// DUE schedulazioni giornaliere (20:00 e 21:00 UTC, una per ciascun fuso di
// Roma) e questa è la sola che decide quale delle due è quella "vera" del
// giorno, guardando l'ora locale al momento in cui gira davvero. L'altra
// chiamata, fuori orario, esce con 200 senza inviare nulla: due trigger
// pianificati, un solo invio, niente da aggiornare due volte l'anno.
const ORA_INVIO_ROMA = 22

const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function GET(request: Request) {
  const segreto = process.env.CRON_SECRET
  const url = new URL(request.url)

  // Vercel Cron manda il segreto nell'header Authorization: qui in più si
  // accetta anche ?secret= nell'URL — solo per poter innescare un invio di
  // prova aprendo un link nel browser, senza dover costruire una richiesta
  // con header custom. Stessa unica sorgente di verità (CRON_SECRET): senza
  // quella variabile impostata, nessuna delle due strade autentica nulla.
  const auth = request.headers.get('authorization')
  const autorizzato = !!segreto && (auth === `Bearer ${segreto}` || url.searchParams.get('secret') === segreto)
  if (!autorizzato) {
    return NextResponse.json({ ok: false, errore: 'Non autorizzato' }, { status: 401 })
  }

  // ?test=<email>: invio di prova a un solo indirizzo, mai al destinatario
  // né alla copia conoscenza abituali, e senza aspettare le 22 — per poter
  // verificare il contenuto prima che parta quello vero.
  const emailProva = url.searchParams.get('test')
  if (emailProva && !FORMATO_EMAIL.test(emailProva)) {
    return NextResponse.json({ ok: false, errore: 'Indirizzo di prova non valido' }, { status: 400 })
  }

  if (!emailProva) {
    const oraRoma = adessoRoma().getUTCHours()
    if (oraRoma !== ORA_INVIO_ROMA) {
      return NextResponse.json({ ok: true, inviato: false, motivo: `fuori orario (ore ${oraRoma} a Roma)` })
    }
  }

  const resoconto = await caricaResocontoDirezionale(oggiRoma())
  const { oggetto, html, testo } = componiEmailResoconto(resoconto)
  const esito = emailProva
    ? await inviaEmail({ a: emailProva, oggetto: `[PROVA] ${oggetto}`, html, testo })
    : await inviaEmail({ a: DESTINATARIO, cc: CC, oggetto, html, testo })

  if (!esito.ok) {
    console.error('Resoconto direzionale: invio fallito —', esito.errore)
    return NextResponse.json({ ok: false, errore: esito.errore }, { status: 502 })
  }
  return NextResponse.json({ ok: true, inviato: true, giorno: resoconto.giorno, prova: !!emailProva })
}
