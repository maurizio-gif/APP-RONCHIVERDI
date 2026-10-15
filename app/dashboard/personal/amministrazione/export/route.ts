import { NextResponse } from 'next/server'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { normalizzaOra, oggiRoma, primoDelMese } from '@/lib/agenda'
import { dataNumerica } from '@/lib/personal'
import { rendicontoMese } from '@/lib/personal-server'

export const dynamic = 'force-dynamic'

// Il conto del mese in CSV per chi incassa dai trainer su Excel: il dovuto di
// ciascuno e le sessioni confermate da cui viene. Separatore «;», virgola
// decimale e BOM iniziale come nell'export dell'incassato.

function cella(valore: string | number | null | undefined): string {
  const testo = valore === null || valore === undefined ? '' : String(valore)
  // Un nome che comincia con = + - @ sarebbe una formula per Excel: nome e
  // cognome di un corporate li scrive a mano il trainer.
  const sicuro = /^[=+\-@]/.test(testo) && typeof valore === 'string' ? `'${testo}` : testo
  return /[";\n\r]/.test(sicuro) ? `"${sicuro.replace(/"/g, '""')}"` : sicuro
}

const importo = (n: number | null) => (n == null ? '' : n.toFixed(2).replace('.', ','))

export async function GET(request: Request) {
  if (!(await utenteHaSezione('personal-amministrazione'))) {
    return new NextResponse('Non autorizzato', { status: 403 })
  }

  const richiesto = new URL(request.url).searchParams.get('mese') ?? ''
  const mese = /^\d{4}-\d{2}-\d{2}$/.test(richiesto) ? primoDelMese(richiesto) : primoDelMese(oggiRoma())
  const { righe, errore } = await rendicontoMese(mese)
  if (errore) return new NextResponse(`Errore: ${errore}`, { status: 500 })

  // Prima il riepilogo per trainer (quello che si incassa), poi il dettaglio
  // delle sessioni confermate da cui viene, separati da una riga vuota.
  const riepilogo = [
    ['Trainer', 'Formula', 'Importo', 'Sessioni confermate', 'In attesa', 'Dovuto'],
    ...righe.map((r) => [
      r.trainerNome,
      r.quota ? (r.quota.tipo === 'flat' ? 'Flat mensile' : 'Oraria') : 'Non impostata',
      r.quota ? importo(r.quota.importo) : '',
      r.confermate.length,
      r.inAttesa,
      importo(r.dovuto),
    ]),
  ]
  const dettaglio = [
    ['Trainer', 'Data', 'Ora', 'Cliente', 'Azienda (corporate)', 'Abbonamento'],
    ...righe.flatMap((r) =>
      r.confermate.map((s) => [
        r.trainerNome,
        dataNumerica(s.data),
        normalizzaOra(s.ora),
        `${s.cliente_cognome} ${s.cliente_nome}`,
        s.corporate ? s.azienda : '',
        s.abbonamento_nome,
      ])
    ),
  ]
  const linee = [...riepilogo, [], ...dettaglio].map((r) => r.map(cella).join(';'))

  const csv = '\uFEFF' + linee.join('\r\n')
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="personal-${mese.slice(0, 7)}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
