'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { nomePersona } from '@/lib/persone'
import { dividiTestoContatto } from '@/app/dashboard/agenda/nuovo-contatto'
import {
  BUCKET_FOTO,
  COLONNE_SEGNALAZIONE,
  MASSIMO_FOTO,
  SEZIONE_MANUTENZIONE,
  SEZIONE_SEGNALAZIONI,
  URGENZE,
  eManutenzione,
  erroreFoto,
  giornoLeggibile,
  scadenzeDa,
  tipoFoto,
  type Canale,
  type Segnalazione,
  type StatoSegnalazione,
  type TipoEvento,
  type Urgenza,
} from '@/lib/segnalazioni'
import {
  avvisaAssegnatario,
  leggiSegnalazione,
  nomiElenchi,
  nomiStaff,
  operatoriManutenzione,
  operatoriSegnalazioni,
  responsabileManutenzione,
} from '@/lib/segnalazioni-server'

// Le azioni sulle segnalazioni. Ogni passo scrive un evento nella storia
// (segnalazioni_eventi). Restituiscono { ok, errore } invece di lanciare: in
// produzione Next nasconde il messaggio di un'eccezione.

export type Esito = { ok: true; id?: string } | { ok: false; errore: string }

// «interno» non si sceglie: lo mette il server alle richieste di manutenzione.
const CANALI: Canale[] = ['reception', 'telefono', 'email', 'altro']

function aggiorna() {
  revalidatePath('/dashboard/segnalazioni', 'layout')
}

// L'operatore che agisce, se ha almeno una delle sezioni indicate.
async function operatore(sezioni: ('segnalazioni' | 'manutenzione')[] = [SEZIONE_SEGNALAZIONI]): Promise<string | null> {
  const email = emailCorrente()
  if (!email) return null
  for (const sezione of sezioni) if (await utenteHaSezione(sezione)) return email
  return null
}


export type FileDaCaricare = { nome: string; tipo: string; byte: number }
export type FotoCaricata = { percorso: string; nome: string; tipo: string; byte: number }

// La cartella di ciascuno nel bucket: chi registra una foto può indicare solo
// file caricati da lui.
function cartellaDi(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9._-]/g, '_')
}

// I file non passano dal server (Vercel limita il corpo di una richiesta a
// 4,5 MB, e una foto può arrivare a 10): il server controlla tipo e peso e
// rilascia un URL firmato per ciascuna, il browser carica direttamente su
// Supabase Storage. Il bucket rifiuta comunque ciò che non è un'immagine o
// supera i 10 MB.
export async function preparaFoto(
  file: FileDaCaricare[]
): Promise<{ ok: true; caricamenti: { percorso: string; token: string; tipo: string }[] } | { ok: false; errore: string }> {
  const email = await operatore([SEZIONE_SEGNALAZIONI, SEZIONE_MANUTENZIONE])
  if (!email) return { ok: false, errore: 'Sessione scaduta o sezione non abilitata: rientra nel CRM.' }
  if (file.length > MASSIMO_FOTO) return { ok: false, errore: `Al massimo ${MASSIMO_FOTO} foto.` }
  for (const f of file) {
    const errore = erroreFoto(f)
    if (errore) return { ok: false, errore }
  }
  const supabase = createSupabaseServiceClient()
  const caricamenti = []
  for (const f of file) {
    const tipo = tipoFoto(f.nome, f.tipo)!
    const estensione = (f.nome.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)
    const percorso = `${cartellaDi(email)}/${randomUUID()}${estensione ? `.${estensione}` : ''}`
    const { data, error } = await supabase.storage.from(BUCKET_FOTO).createSignedUploadUrl(percorso)
    if (error || !data) return { ok: false, errore: 'Non riesco a preparare il caricamento. Riprova.' }
    caricamenti.push({ percorso, token: data.token, tipo })
  }
  return { ok: true, caricamenti }
}

async function registraFoto(segnalazioneId: string, eventoId: string | null, email: string, foto: FotoCaricata[]) {
  const proprie = foto.filter((f) => f.percorso.startsWith(`${cartellaDi(email)}/`)).slice(0, MASSIMO_FOTO)
  if (!proprie.length) return
  const supabase = createSupabaseServiceClient()
  await supabase.from('segnalazioni_allegati').insert(
    proprie.map((f) => ({
      segnalazione_id: segnalazioneId,
      evento_id: eventoId,
      percorso: f.percorso,
      nome: f.nome.slice(0, 200),
      tipo: f.tipo,
      byte: f.byte,
      caricato_da: email,
    }))
  )
}

// ── ricerca del socio ───────────────────────────────────────────────────────

export type SocioTrovato = { id: string; nome: string | null; cognome: string | null; email: string | null; cellulare: string | null }
export type EsitoRicerca = { ok: true; soci: SocioTrovato[]; altri: boolean } | { ok: false; errore: string }

const RISULTATI_RICERCA = 20

// La stessa ricerca sull'anagrafica che usano Contatti e Phone In (soci
// Info4U compresi), ma con il permesso delle segnalazioni: chi registra una
// lamentela alla reception può non avere l'agenda. Nome e cognome in qualsiasi
// ordine ed email passano da cerca_persone; il cellulare dalle ultime nove
// cifre (cerca_persone_per_cellulare).
export async function cercaSocio(testo: string): Promise<EsitoRicerca> {
  if (!(await operatore())) return { ok: false, errore: 'Sessione scaduta o sezione non abilitata: rientra nel CRM.' }
  const cercato = testo.trim()
  if (cercato.length < 3) return { ok: false, errore: 'Scrivi almeno tre caratteri: nome e cognome, email o cellulare.' }

  const supabase = createSupabaseServiceClient()
  const campi = dividiTestoContatto(cercato)
  const { data, error } = campi.cellulare
    ? await supabase.rpc('cerca_persone_per_cellulare', {
        p_cifre: campi.cellulare.replace(/\D/g, '').slice(-9),
        p_limite: RISULTATI_RICERCA + 1,
      })
    : await supabase.rpc('cerca_persone', { p_query: cercato, p_limite: RISULTATI_RICERCA + 1 })
  if (error) {
    console.error('Ricerca del socio non riuscita:', error.message)
    return { ok: false, errore: 'La ricerca non è riuscita. Riprova.' }
  }
  const righe = ((data ?? []) as SocioTrovato[]).map((r) => ({
    id: r.id,
    nome: r.nome,
    cognome: r.cognome,
    email: r.email,
    cellulare: r.cellulare,
  }))
  return { ok: true, soci: righe.slice(0, RISULTATI_RICERCA), altri: righe.length > RISULTATI_RICERCA }
}

// ── registrazione ───────────────────────────────────────────────────────────

export async function registraSegnalazione(dati: {
  settore: string
  motivo: string
  urgenza: string
  canale: string
  descrizione: string
  // Il socio scelto dall'anagrafica; se manca vale il nome scritto a mano.
  personaId: string | null
  socioNome: string
  richiamoRichiesto: boolean
  // Da 1 a 5, attribuito da chi registra.
  livelloUrgenza: number
  foto: FotoCaricata[]
}): Promise<Esito> {
  // Una richiesta di manutenzione la può inviare anche chi ha solo la vista
  // Manutenzione: è un operatore interno, non c'è un socio di mezzo.
  const email = await operatore([SEZIONE_SEGNALAZIONI, SEZIONE_MANUTENZIONE])
  if (!email) return { ok: false, errore: 'Sessione scaduta o sezione non abilitata: rientra nel CRM.' }

  const descrizione = dati.descrizione.trim().slice(0, 4000)
  if (descrizione.length < 10) return { ok: false, errore: 'Descrivi cosa è successo, anche in poche parole.' }
  const urgenza = URGENZE.find((u) => u.chiave === dati.urgenza)?.chiave as Urgenza | undefined
  if (!urgenza) return { ok: false, errore: 'Scegli la tipologia.' }
  const manutenzione = urgenza === 'manutenzione'
  // Le lamentele dei soci sono di chi ha la sezione Segnalazioni.
  if (!manutenzione && !(await utenteHaSezione(SEZIONE_SEGNALAZIONI)))
    return { ok: false, errore: 'Non hai accesso alle segnalazioni dei soci.' }
  const livello = Number(dati.livelloUrgenza)
  if (!Number.isInteger(livello) || livello < 1 || livello > 5) return { ok: false, errore: 'Scegli il livello di urgenza, da 1 a 5.' }
  const canale = manutenzione ? 'interno' : CANALI.find((c) => c === dati.canale)
  if (!canale) return { ok: false, errore: 'Scegli come è arrivata la segnalazione.' }
  const supabase = createSupabaseServiceClient()

  // Il socio scelto dall'anagrafica deve esistere (un id inventato
  // agganciava la segnalazione al nulla) e il suo nome si copia da lì; senza,
  // vale il nome scritto a mano.
  // La manutenzione non ha socio né richiamo: l'operatore segnala per sé.
  let socioNome = manutenzione ? null : dati.socioNome.trim().slice(0, 160) || null
  let personaId: string | null = null
  if (!manutenzione && dati.personaId) {
    const { data: persona } = await supabase
      .from('persone')
      .select('id, nome, cognome, email, cellulare')
      .eq('id', dati.personaId)
      .maybeSingle()
    if (!persona) return { ok: false, errore: 'Socio non trovato: cercalo di nuovo.' }
    personaId = persona.id as string
    socioNome = nomePersona(persona)
  }
  const richiamoRichiesto = !manutenzione && dati.richiamoRichiesto
  if (richiamoRichiesto && !socioNome)
    return { ok: false, errore: 'Se il socio vuole essere richiamato serve il suo nome.' }

  const [{ data: settore }, { data: motivo }] = await Promise.all([
    supabase.from('segnalazioni_settori').select('chiave, nome, responsabile_email').eq('chiave', dati.settore).eq('attivo', true).maybeSingle(),
    supabase.from('segnalazioni_motivi').select('chiave, nome').eq('chiave', dati.motivo).eq('attivo', true).maybeSingle(),
  ])
  if (!settore) return { ok: false, errore: 'Scegli il settore.' }
  if (!motivo) return { ok: false, errore: 'Scegli il motivo.' }

  const adesso = new Date()
  const scadenze = scadenzeDa(urgenza, adesso)
  // Lamentele: il responsabile del settore. Manutenzione: il responsabile della
  // manutenzione (segnalazioni_impostazioni), che poi la passa a un manutentore.
  const responsabile = manutenzione ? await responsabileManutenzione() : ((settore.responsabile_email as string | null) ?? null)

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
      persona_id: personaId,
      richiamo_richiesto: richiamoRichiesto,
      urgenza,
      livello_urgenza: livello,
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

  const { data: ev } = await supabase
    .from('segnalazioni_eventi')
    .insert({ segnalazione_id: s.id, autore: email, tipo: 'ricezione', testo: null })
    .select('id')
    .single()
  if (responsabile)
    await supabase
      .from('segnalazioni_eventi')
      .insert({ segnalazione_id: s.id, autore: email, tipo: 'assegnazione', testo: manutenzione ? 'Inviata al responsabile della manutenzione.' : 'Assegnata al responsabile del settore.' })
  await registraFoto(s.id, ev?.id ?? null, email, dati.foto)

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

export type Passo = 'assegna' | 'prendi' | 'nota' | 'risolvi' | 'richiamato' | 'riapri' | 'archivia' | 'programma'

export async function passoSegnalazione(
  id: string,
  passo: Passo,
  testoGrezzo: string,
  assegnatario?: string,
  foto: FotoCaricata[] = [],
  // Per «programma»: il giorno previsto (AAAA-MM-GG); vuoto = toglie la data.
  dataPrevista?: string
): Promise<Esito> {
  const s = await leggiSegnalazione(id)
  if (!s) return { ok: false, errore: 'Segnalazione non trovata.' }
  const manutenzione = eManutenzione(s)
  // Le lamentele le lavora chi ha Segnalazioni, la manutenzione chi ha la vista
  // Manutenzione.
  const io = await operatore([manutenzione ? SEZIONE_MANUTENZIONE : SEZIONE_SEGNALAZIONI])
  if (!io) return { ok: false, errore: 'Sessione scaduta o sezione non abilitata: rientra nel CRM.' }

  const testo = testoGrezzo.trim().slice(0, 4000) || null
  const adesso = new Date().toISOString()
  let patch: Partial<Segnalazione> = {}
  let tipo: TipoEvento
  let testoEvento = testo

  switch (passo) {
    case 'assegna': {
      if (s.stato === 'risolta' || s.stato === 'archiviata') return { ok: false, errore: 'La segnalazione è chiusa: riaprila prima.' }
      const operatori = manutenzione ? await operatoriManutenzione() : await operatoriSegnalazioni()
      const scelto = operatori.find((o) => o.email === assegnatario)
      if (!scelto) return { ok: false, errore: manutenzione ? 'Scegli a chi assegnarla fra i manutentori.' : 'Scegli a chi assegnarla fra chi lavora le segnalazioni.' }
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
      // Una lamentela si chiude spiegando cosa è stato fatto; per un intervento
      // di manutenzione basta segnarlo fatto, la nota è facoltativa.
      if (!testo && !manutenzione) return { ok: false, errore: 'Scrivi cosa è stato fatto: serve a chi la rilegge.' }
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
      if (manutenzione) return { ok: false, errore: 'Una richiesta di manutenzione non ha richiamo.' }
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

    case 'programma': {
      if (!manutenzione) return { ok: false, errore: 'Le date sono delle richieste di manutenzione.' }
      if (s.stato === 'risolta' || s.stato === 'archiviata') return { ok: false, errore: 'È chiusa: riaprila prima.' }
      const giorno = (dataPrevista ?? '').trim()
      if (giorno && (!/^\d{4}-\d{2}-\d{2}$/.test(giorno) || Number.isNaN(Date.parse(`${giorno}T00:00:00Z`))))
        return { ok: false, errore: 'La data non è valida.' }
      // Facoltativo: con la data si può anche indicare chi interviene.
      let scelto: { email: string; nome: string } | undefined
      if (assegnatario) {
        scelto = (await operatoriManutenzione()).find((o) => o.email === assegnatario)
        if (!scelto) return { ok: false, errore: 'Scegli chi interviene fra i manutentori.' }
      }
      tipo = 'programmazione'
      patch = {
        intervento_previsto_il: giorno || null,
        // Con una data l'intervento è preso in carico; togliendola torna da fare.
        stato: giorno && s.stato === 'ricevuta' ? 'in_carico' : s.stato,
        presa_in_carico_il: s.presa_in_carico_il ?? (giorno ? adesso : null),
        assegnato_a: scelto?.email ?? s.assegnato_a ?? io,
      }
      testoEvento = `${giorno ? `Intervento previsto il ${giornoLeggibile(giorno)}.` : 'Data prevista tolta.'}${scelto ? ` Interviene ${scelto.nome}.` : ''}${testo ? ` ${testo}` : ''}`
      break
    }

    default:
      return { ok: false, errore: 'Passo sconosciuto.' }
  }

  const supabase = createSupabaseServiceClient()
  const { data: ev, error } = await supabase
    .from('segnalazioni_eventi')
    .insert({ segnalazione_id: s.id, autore: io, tipo, testo: testoEvento })
    .select('id')
    .single()
  if (error) {
    console.error('Passo della segnalazione non registrato:', error.message)
    return { ok: false, errore: 'Non sono riuscito a salvare. Riprova.' }
  }
  await supabase.from('segnalazioni').update({ ...patch, aggiornato_il: adesso }).eq('id', s.id)
  await registraFoto(s.id, ev?.id ?? null, io, foto)

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
