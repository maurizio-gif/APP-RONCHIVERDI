import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { descriviFiltri, leggiFiltri } from '@/lib/contatti-filtri'
import { ScriptContattiMancante, contattiPerEsportazione } from '@/lib/contatti-filtri-server'

export const dynamic = 'force-dynamic'

// La lista dei filtri in CSV (tutta, o solo le persone spuntate), per chi la
// porta in un foglio di calcolo o in un invio. Separatore «;», virgola
// decimale e BOM, perché Excel in italiano apra il file con le colonne e gli
// accenti giusti. Il permesso lo controlla la rotta: il middleware propaga
// solo l'email. Ogni esportazione finisce nel controllo operatori.

function cella(valore: string | number | null | undefined): string {
  const testo = valore === null || valore === undefined ? '' : String(valore)
  // Un testo che comincia con = + - @ Excel lo legge come formula: nomi e
  // note sono testo libero.
  const sicuro = /^[=+\-@]/.test(testo) && typeof valore === 'string' ? `'${testo}` : testo
  return /[";\n\r]/.test(sicuro) ? `"${sicuro.replace(/"/g, '""')}"` : sicuro
}

const data = (iso: string | null) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '')

export async function GET(richiesta: Request) {
  if (!(await utenteHaSezione('persone'))) return new NextResponse('Non autorizzato', { status: 403 })

  const parametri = Object.fromEntries(new URL(richiesta.url).searchParams.entries())
  const { filtri, ordine, ids } = leggiFiltri(parametri)
  try {
    const righe = await contattiPerEsportazione(createSupabaseServiceClient(), filtri, ordine, ids)
    const linee = [
      ['Cognome', 'Nome', 'Email', 'Cellulare', 'Abbonamento attivo', 'Scade il', 'Ultima scadenza', 'Ultimo ingresso', 'Lead', 'Richieste da lavorare'].join(';'),
      ...righe.map((r) =>
        [
          cella(r.cognome),
          cella(r.nome),
          cella(r.email),
          cella(r.cellulare),
          cella(r.abbonamento),
          cella(data(r.fine_abbonamento)),
          cella(data(r.ultima_scadenza)),
          cella(data(r.ultimo_accesso)),
          cella(r.lead_stato),
          cella(r.richieste_da_lavorare || ''),
        ].join(';')
      ),
    ]
    await registraLog(emailCorrente(), 'contatti_esportati', {
      dettagli: {
        persone: righe.length,
        selezione: ids.length > 0,
        filtri: descriviFiltri(filtri, { gruppi: {}, staff: {} }).map((d) => d.etichetta).join(' · ') || 'nessuno',
      },
    })
    const giorno = new Date().toISOString().slice(0, 10)
    return new NextResponse('﻿' + linee.join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="contatti_${giorno}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    if (e instanceof ScriptContattiMancante) return new NextResponse(e.message, { status: 500 })
    console.error('Esportazione contatti non riuscita:', e)
    return new NextResponse('Errore nell’esportazione.', { status: 500 })
  }
}
