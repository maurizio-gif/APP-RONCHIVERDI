'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { cartellaPiano, ruoloPiano } from '@/lib/piano-editoriale-server'
import {
  BUCKET_PIANO,
  LUNGHEZZA_MASSIMA_DESCRIZIONE,
  MASSIMO_FILE_PIANO,
  ORE_PER_TIPO,
  STATI,
  TIPI,
  dataValida,
  erroreFilePiano,
  inPreavviso,
  oggiRoma,
  primaDataConPreavviso,
  tipoFilePiano,
  type StatoVoce,
  type TipoVoce,
} from '@/lib/piano-editoriale'

// Le richieste del piano editoriale (vedi scripts/sql/2026-11-10-piano-editoriale.sql).
//
// Chiunque abbia la sezione scrive una richiesta. Il preavviso è di 14 giorni:
// con meno la richiesta entra «urgente», con un motivo obbligatorio, e resta
// una richiesta finché chi gestisce (Giada, gli amministratori) non la accetta.
// Chi gestisce può inserire una voce anche con meno preavviso: entra già
// presa in carico.

const PAGINA = '/dashboard/piano-editoriale'

export type FileDaCaricare = { nome: string; tipo: string; byte: number }
export type FileCaricato = { percorso: string; nome: string; tipo: string; byte: number }

// I file non passano dal server (Vercel limita il corpo di una richiesta a
// 4,5 MB, e un video arriva a 100): il server controlla tipo e peso e
// rilascia un URL firmato per ciascuno, il browser carica direttamente su
// Supabase Storage. Stessa logica degli allegati dei ticket.
export async function preparaFilePiano(
  file: FileDaCaricare[]
): Promise<{ ok: true; caricamenti: { percorso: string; token: string; tipo: string }[] } | { ok: false; errore: string }> {
  const ruolo = await ruoloPiano()
  if (!ruolo) return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  if (file.length > MASSIMO_FILE_PIANO) return { ok: false, errore: `Al massimo ${MASSIMO_FILE_PIANO} file.` }
  for (const f of file) {
    const errore = erroreFilePiano(f)
    if (errore) return { ok: false, errore }
  }
  const supabase = createSupabaseServiceClient()
  const caricamenti = []
  for (const f of file) {
    const tipo = tipoFilePiano(f.nome, f.tipo)!
    const estensione = (f.nome.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)
    const percorso = `${cartellaPiano(ruolo.email)}/${randomUUID()}${estensione ? `.${estensione}` : ''}`
    const { data, error } = await supabase.storage.from(BUCKET_PIANO).createSignedUploadUrl(percorso)
    if (error || !data) {
      console.error('Piano editoriale: caricamento non preparato', error?.message)
      return { ok: false, errore: 'Non riesco a preparare il caricamento. Riprova.' }
    }
    caricamenti.push({ percorso, token: data.token, tipo })
  }
  return { ok: true, caricamenti }
}

// Solo i file caricati da chi chiama, dentro la sua cartella.
function filePropri(email: string, file: FileCaricato[]): FileCaricato[] {
  const cartella = `${cartellaPiano(email)}/`
  return file.filter((f) => f.percorso.startsWith(cartella) && !f.percorso.includes('..')).slice(0, MASSIMO_FILE_PIANO)
}

export type DatiRichiesta = {
  data: string
  tipo: string
  titolo: string
  descrizione: string
  reparto: string
  link: string
  motivoUrgenza: string
  allegati: FileCaricato[]
}

export type EsitoRichiesta = { ok: true; urgente: boolean } | { ok: false; errore: string }

export async function creaRichiesta(dati: DatiRichiesta): Promise<EsitoRichiesta> {
  const esito = await salvaRichiesta(dati)
  // Un file caricato e non registrato resta nel bucket senza padrone: se il
  // salvataggio non è andato a buon fine lo si toglie.
  if (!esito.ok) {
    const ruolo = await ruoloPiano()
    const percorsi = ruolo ? filePropri(ruolo.email, dati.allegati).map((f) => f.percorso) : []
    if (percorsi.length) await createSupabaseServiceClient().storage.from(BUCKET_PIANO).remove(percorsi)
  }
  return esito
}

async function salvaRichiesta(dati: DatiRichiesta): Promise<EsitoRichiesta> {
  const ruolo = await ruoloPiano()
  if (!ruolo) return { ok: false, errore: 'Non hai accesso a questa sezione.' }

  const titolo = dati.titolo.trim()
  const descrizione = dati.descrizione.trim()
  const reparto = dati.reparto.trim()
  const link = dati.link.trim()
  const motivo = dati.motivoUrgenza.trim()

  if (!titolo) return { ok: false, errore: 'Scrivi un titolo.' }
  if (titolo.length > 160) return { ok: false, errore: 'Il titolo è troppo lungo (massimo 160 caratteri).' }
  if (descrizione.length > LUNGHEZZA_MASSIMA_DESCRIZIONE) {
    return { ok: false, errore: `La descrizione è troppo lunga (massimo ${LUNGHEZZA_MASSIMA_DESCRIZIONE} caratteri).` }
  }
  if (!descrizione && !link && !dati.allegati.length) {
    return { ok: false, errore: 'Descrivi cosa vuoi, oppure allega un file o un link.' }
  }
  if (reparto.length > 80) return { ok: false, errore: 'Il reparto è troppo lungo.' }
  if (link && !/^https?:\/\/\S+$/i.test(link)) return { ok: false, errore: 'Il link deve cominciare con http:// o https://.' }
  if (link.length > 500) return { ok: false, errore: 'Il link è troppo lungo.' }
  if (motivo.length > 500) return { ok: false, errore: 'Il motivo dell’urgenza è troppo lungo (massimo 500 caratteri).' }

  const tipo = TIPI.find((t) => t.chiave === dati.tipo)?.chiave
  if (!tipo) return { ok: false, errore: 'Scegli il tipo di contenuto.' }

  if (!dataValida(dati.data)) return { ok: false, errore: 'Scegli la data di pubblicazione.' }
  const oggi = oggiRoma()
  if (dati.data < oggi) return { ok: false, errore: 'La data è già passata.' }

  // Il preavviso: con meno di 14 giorni la richiesta è urgente e il motivo è
  // obbligatorio, salvo per chi gestisce il piano.
  const urgente = !inPreavviso(dati.data, oggi)
  if (urgente && !ruolo.gestisce && !motivo) {
    return {
      ok: false,
      errore: `Giada ha bisogno di almeno 14 giorni: dal ${primaDataConPreavviso(oggi).split('-').reverse().join('/')} in poi la richiesta entra normalmente. Per una data prima scrivi il motivo dell’urgenza: lei decide se è fattibile.`,
    }
  }

  const supabase = createSupabaseServiceClient()
  const { data: voce, error } = await supabase
    .from('piano_editoriale_voci')
    .insert({
      data_pubblicazione: dati.data,
      tipo,
      titolo,
      descrizione,
      reparto: reparto || null,
      link: link || null,
      stato: ruolo.gestisce ? 'in_carico' : 'richiesta',
      urgente,
      motivo_urgenza: urgente && motivo ? motivo : null,
      ore_stimate: ORE_PER_TIPO[tipo as TipoVoce],
      richiesto_da: ruolo.email,
    })
    .select('id')
    .single()
  if (error || !voce) {
    console.error('Piano editoriale: richiesta non salvata', error?.message)
    return { ok: false, errore: 'Non è stato possibile salvare la richiesta. Riprova.' }
  }

  const propri = filePropri(ruolo.email, dati.allegati)
  if (propri.length) {
    const { error: erroreFile } = await supabase.from('piano_editoriale_allegati').insert(
      propri.map((f) => ({
        voce_id: (voce as { id: string }).id,
        percorso: f.percorso,
        nome: f.nome.slice(0, 200),
        tipo: f.tipo,
        byte: f.byte,
        caricato_da: ruolo.email,
      }))
    )
    if (erroreFile) {
      // Senza i file la richiesta non è quella che chi scrive intendeva: si
      // annulla tutta, così può riprovare.
      console.error('Piano editoriale: file non registrati', erroreFile.message)
      await supabase.from('piano_editoriale_voci').delete().eq('id', (voce as { id: string }).id)
      return { ok: false, errore: 'I file non sono stati registrati: la richiesta non è stata salvata. Riprova.' }
    }
  }

  revalidatePath(PAGINA)
  return { ok: true, urgente }
}

export type EsitoSemplice = { ok: true } | { ok: false; errore: string }

// Chi gestisce risponde a una richiesta: la prende in carico, la fa avanzare,
// la sposta a una data possibile o la rifiuta (con una nota, sempre).
export async function aggiornaVoce(
  id: string,
  campi: { stato: string; nota: string; data?: string; ore?: number }
): Promise<EsitoSemplice> {
  const ruolo = await ruoloPiano()
  if (!ruolo?.gestisce) return { ok: false, errore: 'Solo chi gestisce il piano editoriale può farlo.' }

  const stato = STATI.find((s) => s.chiave === campi.stato)?.chiave as StatoVoce | undefined
  if (!stato) return { ok: false, errore: 'Stato non riconosciuto.' }
  const nota = campi.nota.trim()
  if (nota.length > 1000) return { ok: false, errore: 'La nota è troppo lunga (massimo 1000 caratteri).' }
  if (stato === 'rifiutata' && !nota) return { ok: false, errore: 'Scrivi perché non è realizzabile: chi l’ha chiesto lo leggerà.' }

  const aggiornamento: Record<string, unknown> = {
    stato,
    nota_gestione: nota || null,
    aggiornato_il: new Date().toISOString(),
  }
  if (campi.data !== undefined) {
    if (!dataValida(campi.data)) return { ok: false, errore: 'Data non valida.' }
    aggiornamento.data_pubblicazione = campi.data
  }
  if (campi.ore !== undefined) {
    if (!Number.isFinite(campi.ore) || campi.ore < 0 || campi.ore > 40) return { ok: false, errore: 'Ore non valide (da 0 a 40).' }
    aggiornamento.ore_stimate = Math.round(campi.ore * 2) / 2
  }

  const { data, error } = await createSupabaseServiceClient()
    .from('piano_editoriale_voci')
    .update(aggiornamento)
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) {
    console.error('Piano editoriale: voce non aggiornata', error.message)
    return { ok: false, errore: 'Non è stato possibile salvare. Riprova.' }
  }
  if (!data) return { ok: false, errore: 'Voce non trovata: potrebbe essere stata eliminata.' }

  revalidatePath(PAGINA)
  return { ok: true }
}

// Elimina una richiesta: chi l'ha scritta, finché è ancora «richiesta» (dopo
// che Giada l'ha presa in carico si discute con lei), e chi gestisce sempre.
export async function eliminaVoce(id: string): Promise<EsitoSemplice> {
  const ruolo = await ruoloPiano()
  if (!ruolo) return { ok: false, errore: 'Non hai accesso a questa sezione.' }

  const supabase = createSupabaseServiceClient()
  const { data: voce } = await supabase
    .from('piano_editoriale_voci')
    .select('id, richiesto_da, stato')
    .eq('id', id)
    .maybeSingle()
  const v = voce as { id: string; richiesto_da: string; stato: StatoVoce } | null
  if (!v) return { ok: false, errore: 'Voce non trovata: potrebbe essere già stata eliminata.' }
  const propria = v.richiesto_da === ruolo.email && v.stato === 'richiesta'
  if (!ruolo.gestisce && !propria) {
    return { ok: false, errore: 'Puoi eliminare solo le tue richieste non ancora prese in carico.' }
  }

  const { data: allegati } = await supabase.from('piano_editoriale_allegati').select('percorso').eq('voce_id', id)
  const { error } = await supabase.from('piano_editoriale_voci').delete().eq('id', id)
  if (error) {
    console.error('Piano editoriale: voce non eliminata', error.message)
    return { ok: false, errore: 'Non è stato possibile eliminare. Riprova.' }
  }
  const percorsi = ((allegati ?? []) as { percorso: string }[]).map((a) => a.percorso)
  if (percorsi.length) await supabase.storage.from(BUCKET_PIANO).remove(percorsi)

  revalidatePath(PAGINA)
  return { ok: true }
}

// Per vedere o scaricare un file: un URL firmato di breve durata. Il
// calendario è di tutti, quindi chi ha la sezione può aprire i file di ogni
// richiesta.
export async function urlFilePiano(
  allegatoId: string
): Promise<{ ok: true; url: string } | { ok: false; errore: string }> {
  const ruolo = await ruoloPiano()
  if (!ruolo) return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase.from('piano_editoriale_allegati').select('percorso, nome').eq('id', allegatoId).maybeSingle()
  const a = data as { percorso: string; nome: string } | null
  if (!a) return { ok: false, errore: 'File non trovato: potrebbe essere stato rimosso.' }
  const { data: firmato, error } = await supabase.storage.from(BUCKET_PIANO).createSignedUrl(a.percorso, 300, { download: a.nome })
  if (error || !firmato) {
    console.error('Piano editoriale: file non aperto', error?.message)
    return { ok: false, errore: 'Non riesco ad aprire il file. Riprova.' }
  }
  return { ok: true, url: firmato.signedUrl }
}
