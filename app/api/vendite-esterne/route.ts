import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'

export const dynamic = 'force-dynamic'

// Endpoint pubblico per un front-end ESTERNO a Info4U (un negozio online che
// vende abbonamenti per conto del club) che, a pagamento avvenuto, deve
// finire per creare una vendita vera in Info4U. Non scrive mai su Info4U da
// qui: mette solo la riga in coda su `vendite_esterne` — è
// ops/sync-info4u/scrivi-vendite.ps1, sullo stesso server dove gira SQL
// Server, a leggerla e scriverla in dbo.AbbonamentiIscrizione. Vedi il
// README di quella cartella per l'architettura completa e i suoi limiti
// (in particolare: il front-end deve già conoscere l'IDDurata Info4U del
// prodotto venduto, e una persona non ancora presente in Info4U non viene
// creata automaticamente).
//
// A differenza di /api/disponibilita, qui il corpo contiene dati personali e
// innesca una scrittura contabile: niente CORS aperto, e una richiesta senza
// il segreto condiviso giusto viene rifiutata prima di toccare Supabase.
const SEGRETO = process.env.VENDITE_ESTERNE_SHARED_SECRET

function segretoValido(fornito: string | null): boolean {
  if (!SEGRETO || !fornito) return false
  const a = Buffer.from(fornito)
  const b = Buffer.from(SEGRETO)
  // Lunghezza diversa già lo esclude, ma va controllata PRIMA di chiamare
  // timingSafeEqual: con buffer di lunghezza diversa lancia un'eccezione
  // invece di restituire false.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

type CorpoVendita = {
  origine?: unknown
  riferimento_esterno?: unknown
  nome?: unknown
  cognome?: unknown
  email?: unknown
  cellulare?: unknown
  codice_fiscale?: unknown
  data_nascita?: unknown
  source_durata_id?: unknown
  abbonamento?: unknown
  variante?: unknown
  totale?: unknown
  data_vendita?: unknown
  data_inizio?: unknown
  data_fine?: unknown
  metodo_pagamento?: unknown
  riferimento_pagamento?: unknown
  note?: unknown
}

function testoOppureNullo(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

function eTestoNonVuoto(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

function eDataValida(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

export async function POST(request: Request) {
  if (!segretoValido(request.headers.get('x-rv-shared-secret'))) {
    return NextResponse.json({ errore: 'Non autorizzato.' }, { status: 401 })
  }

  let corpo: CorpoVendita
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ errore: 'Corpo JSON non valido.' }, { status: 400 })
  }

  if (
    !eTestoNonVuoto(corpo.origine) ||
    !eTestoNonVuoto(corpo.riferimento_esterno) ||
    !eTestoNonVuoto(corpo.nome) ||
    !eTestoNonVuoto(corpo.cognome) ||
    typeof corpo.source_durata_id !== 'number' ||
    !Number.isInteger(corpo.source_durata_id) ||
    typeof corpo.totale !== 'number' ||
    !(corpo.totale >= 0)
  ) {
    return NextResponse.json(
      {
        errore:
          'Campi obbligatori mancanti o non validi: origine, riferimento_esterno, nome, cognome (testo), source_durata_id (intero), totale (numero >= 0).',
      },
      { status: 400 }
    )
  }

  if (
    corpo.data_vendita !== undefined &&
    corpo.data_vendita !== null &&
    (typeof corpo.data_vendita !== 'string' || Number.isNaN(Date.parse(corpo.data_vendita)))
  ) {
    return NextResponse.json({ errore: 'data_vendita non valida (data/ora ISO 8601).' }, { status: 400 })
  }
  if (corpo.data_inizio !== undefined && corpo.data_inizio !== null && !eDataValida(corpo.data_inizio)) {
    return NextResponse.json({ errore: 'data_inizio non valida (formato YYYY-MM-DD).' }, { status: 400 })
  }
  if (corpo.data_fine !== undefined && corpo.data_fine !== null && !eDataValida(corpo.data_fine)) {
    return NextResponse.json({ errore: 'data_fine non valida (formato YYYY-MM-DD).' }, { status: 400 })
  }
  if (corpo.data_nascita !== undefined && corpo.data_nascita !== null && !eDataValida(corpo.data_nascita)) {
    return NextResponse.json({ errore: 'data_nascita non valida (formato YYYY-MM-DD).' }, { status: 400 })
  }

  const riga = {
    origine: corpo.origine.trim(),
    riferimento_esterno: corpo.riferimento_esterno.trim(),
    nome: corpo.nome.trim(),
    cognome: corpo.cognome.trim(),
    email: testoOppureNullo(corpo.email),
    cellulare: testoOppureNullo(corpo.cellulare),
    codice_fiscale: testoOppureNullo(corpo.codice_fiscale),
    data_nascita: corpo.data_nascita ?? null,
    source_durata_id: corpo.source_durata_id,
    abbonamento: testoOppureNullo(corpo.abbonamento),
    variante: testoOppureNullo(corpo.variante),
    totale: corpo.totale,
    ...(typeof corpo.data_vendita === 'string' ? { data_vendita: corpo.data_vendita } : {}),
    data_inizio: corpo.data_inizio ?? null,
    data_fine: corpo.data_fine ?? null,
    metodo_pagamento: testoOppureNullo(corpo.metodo_pagamento),
    riferimento_pagamento: testoOppureNullo(corpo.riferimento_pagamento),
    note: testoOppureNullo(corpo.note),
  }

  const supabase = createSupabaseServiceClient()

  const { data: inserita, error } = await supabase.from('vendite_esterne').insert(riga).select('id, stato').single()

  if (!error) {
    return NextResponse.json({ id: inserita.id, stato: inserita.stato }, { status: 201 })
  }

  // 23505 = violazione di un vincolo unique: e' il conflitto voluto su
  // (origine, riferimento_esterno) — un retry del chiamante (rete, doppio
  // click) non deve creare una seconda vendita. Si ritrova e si restituisce
  // la riga già in coda, con lo stesso 200 di "va bene così", invece di
  // farla passare per un errore.
  if (error.code === '23505') {
    const { data: esistente, error: erroreLettura } = await supabase
      .from('vendite_esterne')
      .select('id, stato')
      .eq('origine', riga.origine)
      .eq('riferimento_esterno', riga.riferimento_esterno)
      .single()

    if (!erroreLettura && esistente) {
      return NextResponse.json({ id: esistente.id, stato: esistente.stato }, { status: 200 })
    }
  }

  console.error('Vendita esterna non accodata:', error.message)
  return NextResponse.json({ errore: 'Errore nella registrazione della vendita.' }, { status: 500 })
}
