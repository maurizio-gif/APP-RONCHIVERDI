import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { oggiRoma, primoDelMese, ultimoDelMese } from '@/lib/agenda'
import { PRIMO_MESE_DATI, nomeTipo } from '@/lib/incassato'
import {
  ETICHETTE_CATEGORIA,
  applicaFiltri,
  caricaRettifiche,
  causalePulita,
  leggiFiltriRettifiche,
} from '@/lib/rettifiche'

export const dynamic = 'force-dynamic'

// Le rettifiche del mese (con gli stessi filtri della pagina) in CSV per
// Excel italiano: «;» come separatore, virgola decimale, BOM iniziale.

function cella(valore: string | number | null | undefined): string {
  const testo = valore === null || valore === undefined ? '' : String(valore)
  // La causale e' testo libero scritto dagli operatori: un valore che comincia
  // con = + - @ verrebbe interpretato da Excel come formula.
  const sicuro = /^[=+\-@]/.test(testo) && typeof valore === 'string' ? `'${testo}` : testo
  return /[";\n\r]/.test(sicuro) ? `"${sicuro.replace(/"/g, '""')}"` : sicuro
}

const importo = (n: number | null) => (n === null ? '' : n.toFixed(2).replace('.', ','))

function dataOra(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export async function GET(request: Request) {
  if (!(await utenteHaSezione('incassato'))) {
    return new NextResponse('Non autorizzato', { status: 403 })
  }

  const sp = Object.fromEntries(new URL(request.url).searchParams.entries())
  const richiesto = /^\d{4}-\d{2}-\d{2}$/.test(sp.mese ?? '') ? primoDelMese(sp.mese) : primoDelMese(oggiRoma())
  const mese = richiesto < PRIMO_MESE_DATI ? PRIMO_MESE_DATI : richiesto

  const { righe, errore } = await caricaRettifiche(createSupabaseServiceClient(), mese, ultimoDelMese(mese))
  if (errore) return new NextResponse(`Errore: ${errore}`, { status: 500 })
  const filtrate = applicaFiltri(righe, leggiFiltriRettifiche(sp))

  const intestazione = [
    'ID movimento',
    'Data e ora rettifica',
    'Categoria',
    'Operatore',
    'Persona',
    'Tipo',
    'Prodotto / causale',
    'Metodo di pagamento',
    'Importo',
    'ID vendita',
    'ID movimento rettificato',
    'Data incasso rettificato',
    'Importo incasso rettificato',
    'Operatore incasso rettificato',
    'Giorni dall’incasso',
    'Su un altro mese',
  ]
  const corpo = filtrate.map((r) =>
    [
      r.source_movimento_id,
      dataOra(r.data_operazione),
      ETICHETTE_CATEGORIA[r.categoria].nome,
      r.operatore_nome,
      [r.persona_cognome, r.persona_nome].filter(Boolean).join(' '),
      nomeTipo(r.tipo_servizio ?? '?'),
      causalePulita(r.causale),
      r.metodo_pagamento,
      importo(r.importo),
      r.source_iscrizione_id,
      r.storno_di,
      dataOra(r.originale_data),
      importo(r.originale_importo),
      r.originale_operatore,
      r.giorni_dall_originale,
      r.mese_diverso === null ? '' : r.mese_diverso ? 'Sì' : 'No',
    ]
      .map(cella)
      .join(';')
  )

  const csv = '﻿' + [intestazione.map(cella).join(';'), ...corpo].join('\r\n')
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="eliminazioni-storni-${mese.slice(0, 7)}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
