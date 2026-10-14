import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'

export const dynamic = 'force-dynamic'

/** Dopo quanti giorni senza interazioni una trattativa in gestione è persa. */
const GIORNI_SENZA_INTERAZIONI = 14

// Ogni mattina chiude come perse le trattative in gestione senza interazioni
// da 14 giorni e senza niente in agenda per il futuro, e annulla le loro voci
// d'agenda scadute. La regola vive tutta nel database —
// chiudi_trattative_inattive, in
// scripts/sql/2026-10-14-trattative-inattive-perse.sql — e qui c'è solo chi la
// chiama: così la pulizia fatta a mano dal SQL Editor e quella di ogni giorno
// non possono contare in due modi diversi.
//
// Gira alle 03:00 UTC (vedi vercel.json), cioè alle 4 o alle 5 a Roma secondo
// l'ora legale: a quell'ora nessuno sta lavorando una trattativa, e chi apre
// la Dashboard New al mattino la trova già pulita. Qui l'ora esatta non
// conta, quindi una sola schedulazione basta — a differenza del resoconto
// direzionale, che deve partire alle 22 in punto.
export async function GET(request: Request) {
  const segreto = process.env.CRON_SECRET
  const url = new URL(request.url)

  // Come il resoconto direzionale: Vercel Cron manda il segreto
  // nell'header Authorization, ?secret= serve solo a lanciarlo a mano.
  const auth = request.headers.get('authorization')
  const autorizzato = !!segreto && (auth === `Bearer ${segreto}` || url.searchParams.get('secret') === segreto)
  if (!autorizzato) {
    return NextResponse.json({ ok: false, errore: 'Non autorizzato' }, { status: 401 })
  }

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc('chiudi_trattative_inattive', {
    p_giorni: GIORNI_SENZA_INTERAZIONI,
  })

  if (error) {
    console.error('Trattative inattive: chiusura non riuscita —', error.message)
    return NextResponse.json({ ok: false, errore: error.message }, { status: 500 })
  }

  const chiuse = (data ?? []) as { voci_annullate: number | null }[]
  const vociAnnullate = chiuse.reduce((totale, r) => totale + (r.voci_annullate ?? 0), 0)

  if (chiuse.length > 0) {
    revalidatePath('/dashboard')
    revalidatePath('/dashboard/richieste', 'layout')
    revalidatePath('/dashboard/agenda')
  }

  return NextResponse.json({ ok: true, chiuse: chiuse.length, voci_annullate: vociAnnullate })
}
