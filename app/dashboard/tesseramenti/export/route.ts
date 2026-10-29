import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { caricaElenco, elencoDi, vistaValida } from '@/lib/tesseramenti-elenchi'
import { dataIt, ETICHETTE_MOTIVO, ETICHETTE_VISTA, SEZIONE_TESSERAMENTI } from '@/lib/tesseramenti'

export const dynamic = 'force-dynamic'

// L'elenco scelto nella vista Elenchi di Tesseramenti (tesserati, da
// tesserare, non tesserabili, in errore, con l'eventuale filtro per motivo e
// la ricerca) in CSV, calcolato al momento, per girarlo ai responsabili.
// Separatore «;», BOM per Excel. Ogni esportazione finisce nel controllo
// operatori.

function cella(valore: string | number | null | undefined): string {
  const testo = valore === null || valore === undefined ? '' : String(valore)
  // Un testo che comincia con = + - @ Excel lo legge come formula.
  const sicuro = /^[=+\-@]/.test(testo) && typeof valore === 'string' ? `'${testo}` : testo
  return /[";\n\r]/.test(sicuro) ? `"${sicuro.replace(/"/g, '""')}"` : sicuro
}

export async function GET(richiesta: Request) {
  if (!(await utenteHaSezione(SEZIONE_TESSERAMENTI))) return new NextResponse('Non autorizzato', { status: 403 })

  const parametri = new URL(richiesta.url).searchParams
  const vista = vistaValida(parametri.get('vista'))
  if (!vista) return new NextResponse('Elenco non valido.', { status: 400 })
  const motivo = parametri.get('motivo')
  const q = parametri.get('q') ?? ''

  const { righe, error } = await caricaElenco(createSupabaseServiceClient())
  if (error) {
    console.error('Esportazione tesseramenti non riuscita:', error.message)
    return new NextResponse('Errore nell’esportazione.', { status: 500 })
  }
  const elenco = elencoDi(righe, vista, motivo, q)

  const linee = [
    [
      'Cognome',
      'Nome',
      'Codice fiscale',
      'Data di nascita',
      'Email',
      'Cellulare',
      'Abbonamento in corso',
      'Dal',
      'Al',
      'Tessera',
      'Tipo tessera',
      'Rilascio',
      'Scadenza',
      'Motivo',
      'Dettaglio',
      'Tentativi',
    ].join(';'),
    ...elenco.map((r) =>
      [
        cella(r.cognome),
        cella(r.nome),
        cella(r.codice_fiscale),
        cella(r.data_nascita ? dataIt(r.data_nascita) : ''),
        cella(r.email),
        cella(r.cellulare),
        cella(r.abbonamento),
        cella(r.data_inizio ? dataIt(r.data_inizio) : ''),
        cella(r.data_fine ? dataIt(r.data_fine) : ''),
        cella(r.tessera),
        cella(r.tessera_tipo),
        cella(r.tessera_rilascio ? dataIt(r.tessera_rilascio) : ''),
        cella(r.tessera_scadenza ? dataIt(r.tessera_scadenza) : ''),
        cella(r.motivo_tipo ? ETICHETTE_MOTIVO[r.motivo_tipo] : ''),
        cella(r.motivo),
        cella(r.tentativi),
      ].join(';')
    ),
  ]

  await registraLog(emailCorrente(), 'tesseramenti_esportati', {
    dettagli: { elenco: ETICHETTE_VISTA[vista], motivo: motivo ?? 'tutti', ricerca: q || null, persone: elenco.length },
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
