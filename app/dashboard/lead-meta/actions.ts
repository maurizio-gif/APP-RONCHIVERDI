'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { ORIGINE_META_LEAD, leggiLeadMeta } from '@/lib/leadMeta'

export type EsitoCaricamento =
  | { ok: true; inseriti: number; giaPresenti: number; scartate: string[] }
  | { ok: false; errore: string }

const MAX_RIGHE = 300

function soloCifre(v: string | null | undefined): string {
  return String(v ?? '').replace(/\D/g, '')
}

// Carica i lead di un modulo Meta. Entrano come qualunque richiesta Club dal
// sito (stessa attività, quindi lo stesso trigger crea persona e trattativa «da
// prendere in carico» e compaiono in Dashboard ed Eventi Core), ma con
// origine 'meta-lead-ads' e le UTM della sponsorizzata: la targhetta Meta
// Lead Ads li distingue in ogni elenco.
export async function caricaLeadMeta(formData: FormData): Promise<EsitoCaricamento> {
  if (!(await utenteHaSezione('lead-meta'))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }

  const testo = String(formData.get('testo') ?? '')
  const campagnaComune = String(formData.get('campagna') ?? '').trim()
  const { righe, scartate } = leggiLeadMeta(testo)

  if (righe.length === 0) {
    return {
      ok: false,
      errore: scartate.length
        ? `Nessuna riga utilizzabile. ${scartate.slice(0, 3).join(' · ')}`
        : 'Incolla almeno una riga.',
    }
  }
  if (righe.length > MAX_RIGHE) {
    return { ok: false, errore: `Massimo ${MAX_RIGHE} lead alla volta: ne hai incollati ${righe.length}.` }
  }
  if (!campagnaComune && righe.some((r) => !r.campagna)) {
    return { ok: false, errore: 'Scrivi il nome della campagna: serve per sapere da quale sponsorizzata arrivano.' }
  }

  const email = emailCorrente()
  const supabase = createSupabaseServiceClient()

  // Già caricati: stessa email o stesso telefono nella stessa campagna. Ricaricare
  // l'esportazione intera non deve duplicare chi c'era già.
  const { data: esistenti, error: erroreLettura } = await supabase
    .from('form_contatti')
    .select('email, cellulare, utm_campaign')
    .eq('origine', ORIGINE_META_LEAD)
    .limit(5000)
  if (erroreLettura) return { ok: false, errore: 'Non riesco a controllare i lead già caricati. Riprova.' }

  const chiavi = new Set<string>()
  for (const e of esistenti ?? []) {
    const camp = (e.utm_campaign ?? '').toLowerCase()
    if (e.email) chiavi.add(`${camp}|e|${String(e.email).toLowerCase()}`)
    if (e.cellulare) chiavi.add(`${camp}|t|${soloCifre(e.cellulare)}`)
  }

  const daInserire = []
  let giaPresenti = 0
  for (const r of righe) {
    const campagna = r.campagna ?? campagnaComune
    const camp = campagna.toLowerCase()
    const kE = r.email ? `${camp}|e|${r.email}` : null
    const kT = r.cellulare ? `${camp}|t|${soloCifre(r.cellulare)}` : null
    if ((kE && chiavi.has(kE)) || (kT && chiavi.has(kT))) {
      giaPresenti++
      continue
    }
    if (kE) chiavi.add(kE)
    if (kT) chiavi.add(kT)

    daInserire.push({
      origine: ORIGINE_META_LEAD,
      attivita: 'club-adulti',
      attivita_label: 'Abbonamento Club',
      azione: 'richiamami',
      nome: r.nome,
      cognome: r.cognome,
      email: r.email,
      cellulare: r.cellulare,
      messaggio: r.extra,
      // Il modulo di Meta ha la sua informativa privacy; il consenso marketing
      // resta spento finché non lo dà qualcuno a voce.
      privacy: true,
      marketing: false,
      utm_source: 'facebook',
      utm_medium: 'paid',
      utm_campaign: campagna,
      utm_term: r.gruppo,
      utm_content: r.inserzione,
      first_utm_source: 'facebook',
      first_utm_medium: 'paid',
      first_utm_campaign: campagna,
      pagina: 'meta-lead-ads',
      operatore: email,
      dettagli: { meta_caricato_da: email },
    })
  }

  if (daInserire.length > 0) {
    const { error } = await supabase.from('form_contatti').insert(daInserire)
    if (error) return { ok: false, errore: `Non sono riuscito a salvare i lead: ${error.message}` }
  }

  await registraLog(email, 'lead_meta_caricati', {
    entita: 'form_contatti',
    dettagli: { inseriti: daInserire.length, gia_presenti: giaPresenti, campagna: campagnaComune || null },
  })

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/lead-meta')
  revalidatePath('/dashboard/richieste/richieste-club')
  return { ok: true, inseriti: daInserire.length, giaPresenti, scartate }
}
