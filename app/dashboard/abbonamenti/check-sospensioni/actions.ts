'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import {
  BUCKET_SOSPENSIONI,
  LUNGHEZZA_MASSIMA_MOTIVO,
  MASSIMO_DOCUMENTI,
  SEZIONE_CHECK_SOSPENSIONI,
  type DocumentoSospensione,
  type MotivoSospensione,
} from '@/lib/sospensioni'
import { erroreAllegato, tipoAllegato } from '@/lib/ticket'

// Il motivo di una sospensione (vedi scripts/sql/2026-10-22-check-sospensioni.sql).
// Si aggiunge e basta: la tabella rifiuta modifiche e cancellazioni, quindi
// la prima nota è il motivo e le successive sono rettifiche. Lo scrive
// chiunque abbia la sezione, anche per un collega: l'autore resta il suo.

// `avviso`: la nota è salva ma qualcosa dei documenti no.
export type EsitoMotivo = { ok: true; nota: MotivoSospensione; avviso?: string } | { ok: false; errore: string }

export type FileDaCaricare = { nome: string; tipo: string; byte: number }
export type DocumentoCaricato = { percorso: string; nome: string; tipo: string; byte: number }

// La cartella di ciascuno nel bucket: chi registra un documento può indicare
// solo file caricati da lui.
function cartellaDi(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9._-]/g, '_')
}

// I file non passano dal server (Vercel limita il corpo di una richiesta a
// 4,5 MB, e un documento può arrivare a 10): il server controlla tipo e peso
// e rilascia un URL firmato per ciascuno, il browser carica direttamente su
// Supabase Storage. Il bucket rifiuta comunque ciò che non è immagine o PDF
// o supera i 10 MB. Stessa logica degli allegati dei ticket.
export async function preparaDocumentiSospensione(
  file: FileDaCaricare[]
): Promise<{ ok: true; caricamenti: { percorso: string; token: string; tipo: string }[] } | { ok: false; errore: string }> {
  const email = emailCorrente()
  if (!email || !(await utenteHaSezione(SEZIONE_CHECK_SOSPENSIONI))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }
  if (file.length > MASSIMO_DOCUMENTI) return { ok: false, errore: `Al massimo ${MASSIMO_DOCUMENTI} documenti.` }
  for (const f of file) {
    const errore = erroreAllegato(f)
    if (errore) return { ok: false, errore }
  }
  const supabase = createSupabaseServiceClient()
  const caricamenti = []
  for (const f of file) {
    const tipo = tipoAllegato(f.nome, f.tipo)!
    const estensione = (f.nome.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)
    const percorso = `${cartellaDi(email)}/${randomUUID()}${estensione ? `.${estensione}` : ''}`
    const { data, error } = await supabase.storage.from(BUCKET_SOSPENSIONI).createSignedUploadUrl(percorso)
    if (error || !data) {
      console.error('Check sospensioni: caricamento non preparato', error?.message)
      return { ok: false, errore: 'Non riesco a preparare il caricamento. Riprova.' }
    }
    caricamenti.push({ percorso, token: data.token, tipo })
  }
  return { ok: true, caricamenti }
}

// Solo i file caricati da chi chiama, dentro la sua cartella.
function documentiPropri(email: string, documenti: DocumentoCaricato[]): DocumentoCaricato[] {
  const cartella = `${cartellaDi(email)}/`
  return documenti.filter((d) => d.percorso.startsWith(cartella) && !d.percorso.includes('..')).slice(0, MASSIMO_DOCUMENTI)
}

export async function aggiungiMotivoSospensione(
  sourceLogId: number,
  testo: string,
  documenti: DocumentoCaricato[] = []
): Promise<EsitoMotivo> {
  const esito = await salvaMotivo(sourceLogId, testo, documenti)
  // Un file caricato e non registrato è un dato sulla salute senza padrone:
  // se il salvataggio non è andato a buon fine lo si toglie dall'archivio.
  const email = emailCorrente()
  const nonRegistrati = !esito.ok || esito.avviso ? documenti : []
  if (email && nonRegistrati.length) {
    const percorsi = documentiPropri(email, nonRegistrati).map((d) => d.percorso)
    if (percorsi.length) await createSupabaseServiceClient().storage.from(BUCKET_SOSPENSIONI).remove(percorsi)
  }
  return esito
}

async function salvaMotivo(sourceLogId: number, testo: string, documenti: DocumentoCaricato[]): Promise<EsitoMotivo> {
  const email = emailCorrente()
  if (!email || !(await utenteHaSezione(SEZIONE_CHECK_SOSPENSIONI))) {
    return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  }
  if (!Number.isInteger(sourceLogId) || sourceLogId <= 0) return { ok: false, errore: 'Sospensione non riconosciuta.' }

  const pulito = testo.trim()
  if (!pulito) return { ok: false, errore: 'Scrivi il motivo.' }
  if (pulito.length > LUNGHEZZA_MASSIMA_MOTIVO) {
    return { ok: false, errore: `Il motivo è troppo lungo (massimo ${LUNGHEZZA_MASSIMA_MOTIVO} caratteri).` }
  }

  const supabase = createSupabaseServiceClient()
  // Si legge dalla vista, non dal registro intero: si può motivare solo una
  // sospensione che la pagina mostra.
  const { data: proroga, error: erroreProroga } = await supabase
    .from('check_sospensioni')
    .select('source_log_id, source_iscrizione_id')
    .eq('source_log_id', sourceLogId)
    .maybeSingle()
  if (erroreProroga) {
    console.error('Check sospensioni: proroga non letta', erroreProroga.message)
    return { ok: false, errore: 'Non riesco a salvare adesso. Riprova fra poco.' }
  }
  if (!proroga) return { ok: false, errore: 'Questa sospensione non è più nell’elenco.' }

  const { data, error } = await supabase
    .from('sospensioni_motivi')
    .insert({
      source_log_id: sourceLogId,
      source_iscrizione_id: (proroga as { source_iscrizione_id: number | null }).source_iscrizione_id,
      testo: pulito,
      autore: email.trim().toLowerCase(),
    })
    .select('id, testo, autore, creato_il')
    .single()
  if (error || !data) {
    console.error('Check sospensioni: motivo non salvato', error?.message)
    return { ok: false, errore: 'Non è stato possibile salvare il motivo.' }
  }

  const nota = data as MotivoSospensione

  // I documenti seguono la nota: se non si registrano la nota resta (non si
  // cancella) e chi scrive lo sa, per ricaricarli con una rettifica.
  let avviso: string | undefined
  const propri = documentiPropri(email, documenti)
  if (propri.length) {
    const { data: righe, error: erroreDocumenti } = await supabase
      .from('sospensioni_documenti')
      .insert(
        propri.map((d) => ({
          motivo_id: nota.id,
          source_log_id: sourceLogId,
          percorso: d.percorso,
          nome: d.nome.slice(0, 200),
          tipo: d.tipo,
          byte: d.byte,
          caricato_da: email.trim().toLowerCase(),
        }))
      )
      .select('id, nome, tipo, byte')
    if (erroreDocumenti) {
      console.error('Check sospensioni: documenti non registrati', erroreDocumenti.message)
      avviso = 'Il motivo è salvato, ma i documenti non sono stati registrati: aggiungi una rettifica e caricali di nuovo.'
    } else {
      nota.documenti = (righe ?? []) as DocumentoSospensione[]
    }
  }

  revalidatePath('/dashboard/abbonamenti/check-sospensioni')
  revalidatePath('/dashboard/abbonamenti/scadenze-spostate')
  return { ok: true, nota, avviso }
}
