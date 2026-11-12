'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import {
  COLONNE_SEGNALAZIONE,
  SEZIONE_SEGNALAZIONI,
  URGENZE,
  scadenzeDa,
  type Canale,
  type Segnalazione,
  type StatoSegnalazione,
  type TipoEvento,
  type Urgenza,
} from '@/lib/segnalazioni'
import { avvisaAssegnatario, leggiSegnalazione, nomiElenchi, nomiStaff, operatoriSegnalazioni } from '@/lib/segnalazioni-server'

// Le azioni sulle segnalazioni. Ogni passo scrive un evento nella storia
// (segnalazioni_eventi). Restituiscono { ok, errore } invece di lanciare: in
// produzione Next nasconde il messaggio di un'eccezione.

export type Esito = { ok: true; id?: string } | { ok: false; errore: string }

const CANALI: Canale[] = ['reception', 'telefono', 'email', 'altro']

function aggiorna() {
  revalidatePath('/dashboard/segnalazioni', 'layout')
}

async function operatore(): Promise<string | null> {
  const email = emailCorrente()
  if (!email) return null
  return (await utenteHaSezione(SEZIONE_SEGNALAZIONI)) ? email : null
}

// ── registrazione ───────────────────────────────────────────────────────────

export async function registraSegnalazione(dati: {
  settore: string
  motivo: string
  urgenza: string
  canale: string
  descrizione: string
  socioNome: string
  richiamoRichiesto: boolean
}): Promise<Esito> {
  const email = await operatore()
  if (!email) return { ok: false, errore: 'Sessione scaduta o sezione non abilitata: rientra nel CRM.' }

  const descrizione = dati.descrizione.trim().slice(0, 4000)
  if (descrizione.length < 10) return { ok: false, errore: 'Descrivi cosa è successo, anche in poche parole.' }
  const urgenza = URGENZE.find((u) => u.chiave === dati.urgenza)?.chiave as Urgenza | undefined
  if (!urgenza) return { ok: false, errore: 'Scegli l’urgenza.' }
  const canale = CANALI.find((c) => c === dati.canale)
  if (!canale) return { ok: false, errore: 'Scegli come è arrivata la segnalazione.' }
  const socioNome = dati.socioNome.trim().slice(0, 160) || null
  if (dati.richiamoRichiesto && !socioNome)
    return { ok: false, errore: 'Se il socio vuole essere richiamato serve il suo nome.' }

  const supabase = createSupabaseServiceClient()
  const [{ data: settore }, { data: motivo }] = await Promise.all([
    supabase.from('segnalazioni_settori').select('chiave, nome, responsabile_email').eq('chiave', dati.settore).eq('attivo', true).maybeSingle(),
    supabase.from('segnalazioni_motivi').select('chiave, nome').eq('chiave', dati.motivo).eq('attivo', true).maybeSingle(),
  ])
  if (!settore) return { ok: false, errore: 'Scegli il settore.' }
  if (!motivo) return { ok: false, errore: 'Scegli il motivo.' }

  const adesso = new Date()
  const scadenze = scadenzeDa(urgenza, adesso)
  const responsabile = (settore.responsabile_email as string | null) ?? null

  const { data, error } = await supabase
    .from('segnalazioni')
    .insert({
      ricevuta_il: adesso.toISOString(),
      raccolta_da: email,
      canale,
      settore: settore.chiave,
      motivo: motivo.chiave,
      descrizione,
      socio_nome: socioNome,
      richiamo_richiesto: dati.richiamoRichiesto,
      urgenza,
      assegnato_a: responsabile,
      scadenza_presa_il: scadenze.presa.toISOString(),
      scadenza_risoluzione_il: scadenze.risoluzione.toISOString(),
    })
    .select(COLONNE_SEGNALAZIONE)
    .single()
  if (error || !data) {
    console.error('Segnalazione non registrata:', error?.message)
    return { ok: false, errore: 'Non sono riuscito a registrare la segnalazione. Riprova.' }
  }
  const s = data as Segnalazione

  await supabase.from('segnalazioni_eventi').insert([
    { segnalazione_id: s.id, autore: email, tipo: 'ricezione', testo: null },
    ...(responsabile
      ? [{ segnalazione_id: s.id, autore: email, tipo: 'assegnazione', testo: 'Assegnata al responsabile del settore.' }]
      : []),
  ])

  if (responsabile) {
    const nomi = await nomiStaff()
    const esito = await avvisaAssegnatario(s, responsabile, {
      settore: settore.nome as string,
      motivo: motivo.nome as string,
      chi: nomi.get(email) ?? email,
      assegnata: false,
    })
    if (!esito.ok) console.error('Email della nuova segnalazione non partita:', esito.errore)
  }

  await registraLog(email, 'segnalazione_registrata', { entita: 'segnalazione', entitaId: s.id, dettagli: { numero: s.numero } })
  aggiorna()
  return { ok: true, id: s.id }
}

// ── i passi ─────────────────────────────────────────────────────────────────

export type Passo = 'assegna' | 'prendi' | 'nota' | 'risolvi' | 'richiamato' | 'riapri' | 'archivia'

export async function passoSegnalazione(
  id: string,
  passo: Passo,
  testoGrezzo: string,
  assegnatario?: string
): Promise<Esito> {
  const io = await operatore()
  if (!io) return { ok: false, errore: 'Sessione scaduta o sezione non abilitata: rientra nel CRM.' }
  const s = await leggiSegnalazione(id)
  if (!s) return { ok: false, errore: 'Segnalazione non trovata.' }

  const testo = testoGrezzo.trim().slice(0, 4000) || null
  const adesso = new Date().toISOString()
  let patch: Partial<Segnalazione> = {}
  let tipo: TipoEvento
  let testoEvento = testo

  switch (passo) {
    case 'assegna': {
      if (s.stato === 'risolta' || s.stato === 'archiviata') return { ok: false, errore: 'La segnalazione è chiusa: riaprila prima.' }
      const operatori = await operatoriSegnalazioni()
      const scelto = operatori.find((o) => o.email === assegnatario)
      if (!scelto) return { ok: false, errore: 'Scegli a chi assegnarla fra chi lavora le segnalazioni.' }
      tipo = 'assegnazione'
      patch = { assegnato_a: scelto.email }
      testoEvento = `Assegnata a ${scelto.nome}.${testo ? ` ${testo}` : ''}`
      break
    }

    case 'prendi':
      if (s.stato !== 'ricevuta') return { ok: false, errore: 'È già stata presa in carico.' }
      tipo = 'presa_in_carico'
      patch = { stato: 'in_carico', assegnato_a: s.assegnato_a ?? io, presa_in_carico_il: adesso }
      break

    case 'nota':
      if (!testo) return { ok: false, errore: 'Scrivi la nota.' }
      tipo = 'nota'
      break

    case 'risolvi': {
      if (s.stato === 'risolta' || s.stato === 'archiviata') return { ok: false, errore: 'La segnalazione è già chiusa.' }
      if (!testo) return { ok: false, errore: 'Scrivi cosa è stato fatto: serve a chi la rilegge.' }
      tipo = 'risoluzione'
      // Il socio ha chiesto di essere richiamato: il problema è sistemato ma
      // la segnalazione non è chiusa finché non l'ha saputo.
      const daRichiamare = s.richiamo_richiesto && !s.richiamato_il
      patch = {
        stato: daRichiamare ? 'da_richiamare' : 'risolta',
        presa_in_carico_il: s.presa_in_carico_il ?? adesso,
        assegnato_a: s.assegnato_a ?? io,
        risolta_il: daRichiamare ? null : adesso,
      }
      break
    }

    case 'richiamato':
      if (s.stato !== 'da_richiamare') return { ok: false, errore: 'Non c’è un richiamo in attesa.' }
      if (!testo) return { ok: false, errore: 'Scrivi come è andata la telefonata.' }
      tipo = 'richiamo'
      patch = { stato: 'risolta', richiamato_il: adesso, risolta_il: adesso }
      break

    case 'riapri':
      if (s.stato !== 'risolta' && s.stato !== 'archiviata') return { ok: false, errore: 'È già aperta.' }
      tipo = 'riapertura'
      patch = { stato: s.presa_in_carico_il ? 'in_carico' : 'ricevuta', risolta_il: null, richiamato_il: null }
      break

    case 'archivia':
      if (s.stato === 'archiviata') return { ok: false, errore: 'È già archiviata.' }
      if (!testo) return { ok: false, errore: 'Scrivi perché la archivi (non pertinente, doppia…).' }
      tipo = 'archiviazione'
      patch = { stato: 'archiviata' as StatoSegnalazione }
      break

    default:
      return { ok: false, errore: 'Passo sconosciuto.' }
  }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('segnalazioni_eventi')
    .insert({ segnalazione_id: s.id, autore: io, tipo, testo: testoEvento })
  if (error) {
    console.error('Passo della segnalazione non registrato:', error.message)
    return { ok: false, errore: 'Non sono riuscito a salvare. Riprova.' }
  }
  await supabase.from('segnalazioni').update({ ...patch, aggiornato_il: adesso }).eq('id', s.id)

  // Assegnata a un collega: lo si avvisa per email.
  if (passo === 'assegna' && patch.assegnato_a && patch.assegnato_a !== io) {
    const [nomi, elenchi] = await Promise.all([nomiStaff(), nomiElenchi()])
    const esito = await avvisaAssegnatario({ ...s, ...patch } as Segnalazione, patch.assegnato_a, {
      settore: elenchi.settori.get(s.settore) ?? s.settore,
      motivo: elenchi.motivi.get(s.motivo) ?? s.motivo,
      chi: nomi.get(io) ?? io,
      assegnata: true,
    })
    if (!esito.ok) console.error('Email di assegnazione non partita:', esito.errore)
  }

  await registraLog(io, 'segnalazione_passo', { entita: 'segnalazione', entitaId: s.id, dettagli: { numero: s.numero, passo } })
  aggiorna()
  return { ok: true }
}
