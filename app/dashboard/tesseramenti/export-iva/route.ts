import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { leggiPaginato } from '@/lib/supabase/leggiPaginato'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { dataIt, oggiRoma, SEZIONE_TESSERAMENTI } from '@/lib/tesseramenti'

export const dynamic = 'force-dynamic'

// La vista «IVA zero senza tessera» di Tesseramenti in CSV, con gli stessi
// filtri (periodo, dicitura, solo con abbonamento in corso) della pagina.
// Separatore «;», BOM per Excel; ogni esportazione finisce nel controllo
// operatori.

const MESI: Record<string, number | null> = { '3': 3, '6': 6, '12': 12, '24': 24, tutto: null }
const TITOLI: Record<string, string | null> = { art4: 'art. 4', art15: 'art. 15', tutte: null }

type RigaIva = {
  nome: string | null
  cognome: string | null
  codice_fiscale: string | null
  n_ricevute: number
  importo: number | string
  primo_pagamento: string | null
  ultimo_pagamento: string | null
  abbonamento: string | null
  data_inizio: string | null
  data_fine: string | null
  iscritto_dal: string | null
  ultima_tessera: string | null
  ultima_tessera_scadenza: string | null
}

function cella(valore: string | number | null | undefined): string {
  const testo = valore === null || valore === undefined ? '' : String(valore)
  const sicuro = /^[=+\-@]/.test(testo) && typeof valore === 'string' ? `'${testo}` : testo
  return /[";\n\r]/.test(sicuro) ? `"${sicuro.replace(/"/g, '""')}"` : sicuro
}

function menoMesi(iso: string, mesi: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - mesi)
  return d.toISOString().slice(0, 10)
}

export async function GET(richiesta: Request) {
  if (!(await utenteHaSezione(SEZIONE_TESSERAMENTI))) return new NextResponse('Non autorizzato', { status: 403 })

  const p = new URL(richiesta.url).searchParams
  const periodo = p.get('periodo') && p.get('periodo')! in MESI ? p.get('periodo')! : '12'
  const titolo = p.get('titolo') && p.get('titolo')! in TITOLI ? p.get('titolo')! : 'art4'
  const soloAbbonamento = p.get('solo') === 'abbonamento'
  const mesi = MESI[periodo]
  // I dati delle ricevute partono dal 1 gennaio 2023.
  const dal = mesi ? menoMesi(oggiRoma(), mesi) : '2023-01-01'

  const supabase = createSupabaseServiceClient()
  const { righe, error } = await leggiPaginato<RigaIva>((da) =>
    supabase
      .rpc('iva_zero_senza_tessera', { p_dal: dal, p_titolo: TITOLI[titolo] })
      .range(da, da + 999) as unknown as PromiseLike<{ data: RigaIva[] | null; error: { message: string } | null }>
  )
  if (error) {
    console.error('Esportazione IVA zero non riuscita:', error.message)
    return new NextResponse('Errore nell’esportazione.', { status: 500 })
  }
  const elenco = righe
    .filter((r) => !soloAbbonamento || !!r.abbonamento)
    .sort((a, b) => {
      if (!!a.abbonamento !== !!b.abbonamento) return a.abbonamento ? -1 : 1
      return (b.ultimo_pagamento ?? '').localeCompare(a.ultimo_pagamento ?? '')
    })

  const linee = [
    [
      'Cognome',
      'Nome',
      'Codice fiscale',
      'Abbonamento in corso',
      'Dal',
      'Al',
      'Iscritto dal',
      'Ricevute',
      'Importo IVA zero',
      'Primo pagamento',
      'Ultimo pagamento',
      'Ultima tessera',
      'Scadenza ultima tessera',
    ].join(';'),
    ...elenco.map((r) =>
      [
        cella(r.cognome),
        cella(r.nome),
        cella(r.codice_fiscale),
        cella(r.abbonamento),
        cella(r.data_inizio ? dataIt(r.data_inizio) : ''),
        cella(r.data_fine ? dataIt(r.data_fine) : ''),
        cella(r.iscritto_dal ? dataIt(r.iscritto_dal) : ''),
        cella(r.n_ricevute),
        cella(Number(r.importo).toFixed(2).replace('.', ',')),
        cella(r.primo_pagamento ? dataIt(r.primo_pagamento) : ''),
        cella(r.ultimo_pagamento ? dataIt(r.ultimo_pagamento) : ''),
        cella(r.ultima_tessera),
        cella(r.ultima_tessera_scadenza ? dataIt(r.ultima_tessera_scadenza) : ''),
      ].join(';')
    ),
  ]

  await registraLog(emailCorrente(), 'tesseramenti_esportati', {
    dettagli: { elenco: 'IVA zero senza tessera', periodo, titolo, solo_abbonamento: soloAbbonamento, persone: elenco.length },
  })
  const giorno = new Date().toISOString().slice(0, 10)
  return new NextResponse('﻿' + linee.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="iva_zero_senza_tessera_${giorno}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
