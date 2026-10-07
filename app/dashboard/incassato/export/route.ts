import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { oggiRoma, primoDelMese, ultimoDelMese } from '@/lib/agenda'
import {
  ETICHETTE_COLLEGAMENTO,
  PRIMO_MESE_DATI,
  SENZA_METODO,
  caricaMovimenti,
  leggiFiltriMovimenti,
  nomeTipo,
} from '@/lib/incassato'

export const dynamic = 'force-dynamic'

// L'elenco dei movimenti del mese (con gli stessi filtri della pagina) in
// CSV, per chi riconcilia su Excel: separatore «;» e virgola decimale come
// li vuole un Excel italiano, e BOM iniziale perché le lettere accentate non
// diventino geroglifici. Il permesso lo controlla la rotta: il middleware
// propaga solo l'email dell'operatore.

const PAGINA = 1000
const MASSIMO = 50000

function cella(valore: string | number | null | undefined): string {
  const testo = valore === null || valore === undefined ? '' : String(valore)
  // Un valore che comincia con = + - @ sarebbe interpretato da Excel come
  // formula: la causale è testo libero scritto dagli operatori.
  const sicuro = /^[=+\-@]/.test(testo) && typeof valore === 'string' ? `'${testo}` : testo
  return /[";\n\r]/.test(sicuro) ? `"${sicuro.replace(/"/g, '""')}"` : sicuro
}

const importo = (n: number) => n.toFixed(2).replace('.', ',')

function dataOra(iso: string): string {
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
  const filtri = leggiFiltriMovimenti(mese, ultimoDelMese(mese), sp)

  const supabase = createSupabaseServiceClient()
  const righe = []
  for (let da = 0; da < MASSIMO; da += PAGINA) {
    const { righe: blocco, errore } = await caricaMovimenti(supabase, filtri, da, PAGINA)
    if (errore) return new NextResponse(`Errore: ${errore}`, { status: 500 })
    righe.push(...blocco)
    if (blocco.length < PAGINA) break
  }

  const intestazione = [
    'ID movimento',
    'Data e ora',
    'Tipo',
    'Causale',
    'Metodo di pagamento',
    'Passa dalla cassa',
    'Importo',
    'Storno',
    'Collegamento',
    'ID vendita',
    'Abbonamento',
    'Data vendita',
    'Totale vendita',
    'Persona',
    'Operatore',
  ]
  const corpo = righe.map((r) =>
    [
      r.source_movimento_id,
      dataOra(r.data_operazione),
      nomeTipo(r.tipo_servizio ?? '?'),
      r.causale ?? r.descrizione_servizio,
      r.metodo_pagamento ?? SENZA_METODO,
      r.movimenta_cassa === null ? '' : r.movimenta_cassa ? 'Sì' : 'No',
      importo(r.importo),
      r.e_storno ? 'Sì' : '',
      ETICHETTE_COLLEGAMENTO[r.collegamento].nome,
      r.source_iscrizione_id,
      r.abbonamento,
      r.data_vendita ? dataOra(r.data_vendita) : '',
      r.vendita_totale === null ? '' : importo(r.vendita_totale),
      [r.persona_cognome, r.persona_nome].filter(Boolean).join(' '),
      r.operatore_nome,
    ]
      .map(cella)
      .join(';')
  )

  const csv = '﻿' + [intestazione.map(cella).join(';'), ...corpo].join('\r\n')
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="incassato-${mese.slice(0, 7)}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
