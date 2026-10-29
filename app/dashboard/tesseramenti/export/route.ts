import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { caricaTesseramenti, elencoDi, vistaValida } from '@/lib/tesseramenti-elenchi'
import { dataIt, ETICHETTE_MOTIVO, ETICHETTE_VISTA, SEZIONE_TESSERAMENTI } from '@/lib/tesseramenti'

export const dynamic = 'force-dynamic'

// L'elenco scelto nella vista Automazione di Tesseramenti (tesserati, da
// tesserare, non tesserabili, in errore, con l'eventuale filtro per motivo)
// in CSV, per girarlo ai responsabili. Separatore «;», BOM per Excel. Ogni
// esportazione finisce nel controllo operatori.

function cella(valore: string | number | null | undefined): string {
  const testo = valore === null || valore === undefined ? '' : String(valore)
  // Un testo che comincia con = + - @ Excel lo legge come formula.
  const sicuro = /^[=+\-@]/.test(testo) && typeof valore === 'string' ? `'${testo}` : testo
  return /[";\n\r]/.test(sicuro) ? `"${sicuro.replace(/"/g, '""')}"` : sicuro
}

export async function GET(richiesta: Request) {
  if (!(await utenteHaSezione(SEZIONE_TESSERAMENTI))) return new NextResponse('Non autorizzato', { status: 403 })

  const parametri = new URL(richiesta.url).searchParams
  const vista = vistaValida(parametri.get('vista') ?? undefined)
  if (!vista) return new NextResponse('Elenco non valido.', { status: 400 })
  const motivo = parametri.get('motivo')

  const { righe, error } = await caricaTesseramenti(createSupabaseServiceClient())
  if (error) {
    console.error('Esportazione tesseramenti non riuscita:', error.message)
    return new NextResponse('Errore nell’esportazione.', { status: 500 })
  }
  const nominativo = (r: (typeof righe)[number]) => `${r.persone?.cognome ?? ''} ${r.persone?.nome ?? ''}`
  const elenco = elencoDi(righe, vista, motivo)
    .slice()
    .sort((a, b) => nominativo(a).localeCompare(nominativo(b), 'it'))

  const linee = [
    [
      'Cognome',
      'Nome',
      'Codice fiscale',
      'Data di nascita',
      'Email',
      'Cellulare',
      'Prodotto',
      'Stagione',
      'Tessera',
      'Rilascio',
      'Scadenza',
      'Motivo',
      'Dettaglio',
      'Tentativi',
    ].join(';'),
    ...elenco.map((r) =>
      [
        cella(r.persone?.cognome),
        cella(r.persone?.nome),
        cella(r.persone?.codice_fiscale),
        cella(r.persone?.data_nascita ? dataIt(r.persone.data_nascita) : ''),
        cella(r.persone?.email),
        cella(r.persone?.cellulare),
        cella(r.abbonamenti?.abbonamento),
        cella(r.stagione),
        cella(r.tessera),
        cella(r.rilascio ? dataIt(r.rilascio) : ''),
        cella(r.scadenza ? dataIt(r.scadenza) : ''),
        cella(r.motivo_tipo ? ETICHETTE_MOTIVO[r.motivo_tipo] : ''),
        cella(r.motivo),
        cella(r.tentativi),
      ].join(';')
    ),
  ]

  await registraLog(emailCorrente(), 'tesseramenti_esportati', {
    dettagli: { elenco: ETICHETTE_VISTA[vista], motivo: motivo ?? 'tutti', persone: elenco.length },
  })
  const giorno = new Date().toISOString().slice(0, 10)
  return new NextResponse('﻿' + linee.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tesseramenti_${vista}_${giorno}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
