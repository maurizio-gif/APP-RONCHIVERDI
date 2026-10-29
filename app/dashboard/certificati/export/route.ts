import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { leggiPaginato } from '@/lib/supabase/leggiPaginato'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { dataIt } from '@/lib/tesseramenti'
import {
  ETICHETTE_VISTA,
  GIORNI_IN_SCADENZA,
  SEZIONE_CERTIFICATI,
  elencoDi,
  vistaValida,
  type RigaCertificato,
} from '@/lib/certificati'

export const dynamic = 'force-dynamic'

// L'elenco scelto nella pagina Certificati medici (con la ricerca) in CSV,
// calcolato al momento. Separatore «;», BOM per Excel. Ogni esportazione
// finisce nel controllo operatori.

function cella(valore: string | number | null | undefined): string {
  const testo = valore === null || valore === undefined ? '' : String(valore)
  // Un testo che comincia con = + - @ Excel lo legge come formula.
  const sicuro = /^[=+\-@]/.test(testo) && typeof valore === 'string' ? `'${testo}` : testo
  return /[";\n\r]/.test(sicuro) ? `"${sicuro.replace(/"/g, '""')}"` : sicuro
}

export async function GET(richiesta: Request) {
  if (!(await utenteHaSezione(SEZIONE_CERTIFICATI))) return new NextResponse('Non autorizzato', { status: 403 })

  const parametri = new URL(richiesta.url).searchParams
  const vista = vistaValida(parametri.get('vista'))
  if (!vista) return new NextResponse('Elenco non valido.', { status: 400 })
  const q = parametri.get('q') ?? ''

  const supabase = createSupabaseServiceClient()
  const { righe, error } = await leggiPaginato<RigaCertificato>((da) =>
    supabase.rpc('certificati_stato', { p_giorni: GIORNI_IN_SCADENZA }).range(da, da + 999) as unknown as PromiseLike<{
      data: RigaCertificato[] | null
      error: { message: string } | null
    }>
  )
  if (error) {
    console.error('Esportazione certificati non riuscita:', error.message)
    return new NextResponse('Errore nell’esportazione.', { status: 500 })
  }
  const elenco = elencoDi(righe, vista, q)

  const linee = [
    [
      'Cognome',
      'Nome',
      'Codice fiscale',
      'Email',
      'Cellulare',
      'Abbonamento in corso',
      'Dal',
      'Al',
      'Certificato',
      'Emesso il',
      'Scade il',
      'Giorni alla scadenza',
    ].join(';'),
    ...elenco.map((r) =>
      [
        cella(r.cognome),
        cella(r.nome),
        cella(r.codice_fiscale),
        cella(r.email),
        cella(r.cellulare),
        cella(r.abbonamento),
        cella(r.data_inizio ? dataIt(r.data_inizio) : ''),
        cella(r.data_fine ? dataIt(r.data_fine) : ''),
        cella(r.certificato),
        cella(r.emissione ? dataIt(r.emissione) : ''),
        cella(r.scadenza ? dataIt(r.scadenza) : ''),
        cella(r.giorni_alla_scadenza),
      ].join(';')
    ),
  ]

  await registraLog(emailCorrente(), 'certificati_esportati', {
    dettagli: { elenco: ETICHETTE_VISTA[vista], ricerca: q || null, persone: elenco.length },
  })
  const giorno = new Date().toISOString().slice(0, 10)
  return new NextResponse('﻿' + linee.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="certificati_${vista}_${giorno}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
