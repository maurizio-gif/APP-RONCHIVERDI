import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { slotOccupati, voceDaContatto, voceDaTask, type VoceAgenda } from '@/lib/agenda'

export const dynamic = 'force-dynamic'

// Endpoint pubblico, senza autenticazione: lo chiama il sito Ronchiverdi
// (Astro) prima di offrire in prenotazione un orario per una visita o una
// telefonata, per togliere quelli già occupati in agenda.
//
// Risponde SOLO con data, ora e durata degli impegni: nessun nome, email,
// titolo o id di riga. Anche intercettando la risposta non si impara nulla su
// chi ha un appuntamento, quindi non serve autenticazione né una chiave con
// RLS dedicata.
//
// Stessa agenda condivisa di lib/agenda.ts: un appuntamento fissato dalla
// segreteria e uno prenotato dal sito occupano lo stesso calendario, quindi
// una telefonata prenotabile deve evitare anche gli orari già presi da una
// visita in sede, e viceversa.

// Oltre il massimo che il sito offre davvero (giorniAvanti in
// src/lib/leadForm.client.js, oggi 14): un intervallo più ampio è quasi
// sempre un errore del chiamante, non un uso legittimo.
const MAX_GIORNI = 62

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    // Breve: riduce il carico su Supabase senza rendere la disponibilità
    // percepibilmente vecchia — il sito la chiede una volta per apertura del
    // calendario, non a ogni click.
    'Cache-Control': 'public, max-age=15, s-maxage=15',
  }
}

function eDataValida(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const da = searchParams.get('da')
  const a = searchParams.get('a')

  if (!eDataValida(da) || !eDataValida(a) || da > a) {
    return NextResponse.json(
      { errore: 'Parametri "da"/"a" mancanti o non validi (formato YYYY-MM-DD).' },
      { status: 400, headers: corsHeaders() }
    )
  }

  if ((Date.parse(a) - Date.parse(da)) / 86_400_000 > MAX_GIORNI) {
    return NextResponse.json(
      { errore: 'Intervallo troppo ampio.' },
      { status: 400, headers: corsHeaders() }
    )
  }

  const supabase = createSupabaseServiceClient()

  const [{ data: task, error: erroreTask }, { data: contatti, error: erroreContatti }] =
    await Promise.all([
      supabase
        .from('task')
        .select('id, titolo, tipo, data, ora, durata_minuti, stato, note, assegnato_a')
        .gte('data', da)
        .lte('data', a),
      supabase
        .from('form_contatti')
        .select('id, azione, data_scelta, ora_scelta, nome, cognome, email, cellulare, attivita_label, messaggio, gestito')
        .gte('data_scelta', da)
        .lte('data_scelta', a),
    ])

  if (erroreTask || erroreContatti) {
    console.error('Disponibilità non calcolata:', erroreTask?.message ?? erroreContatti?.message)
    return NextResponse.json(
      { errore: 'Errore nella lettura della disponibilità.' },
      { status: 500, headers: corsHeaders() }
    )
  }

  const voci: VoceAgenda[] = [
    ...(task ?? []).map(voceDaTask),
    ...(contatti ?? []).map(voceDaContatto).filter((v): v is VoceAgenda => v !== null),
  ]

  return NextResponse.json({ occupati: slotOccupati(voci) }, { headers: corsHeaders() })
}
