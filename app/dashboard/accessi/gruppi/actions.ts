'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { COLORI_GRUPPO, leggiChiaveVarco } from '@/lib/accessi'

export type Esito = { ok: true } | { ok: false; errore: string }

const COLORE = /^#[0-9a-f]{6}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_NOME = 40

function rivalida() {
  revalidatePath('/dashboard/accessi')
  revalidatePath('/dashboard/accessi/ricerca')
  revalidatePath('/dashboard/accessi/gruppi')
}

async function consentito(): Promise<boolean> {
  return utenteHaSezione('accessi')
}

function nomePulito(nome: string): string {
  return nome.replace(/\s+/g, ' ').trim()
}

function errorePerNomeDoppio(messaggio: string): string | null {
  return /duplicate key|accessi_gruppi_nome_key/.test(messaggio) ? 'Esiste già un gruppo con questo nome.' : null
}

export async function creaGruppoAccessi(nome: string, colore: string): Promise<Esito> {
  if (!(await consentito())) return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  const pulito = nomePulito(nome)
  if (!pulito) return { ok: false, errore: 'Il nome del gruppo non può essere vuoto.' }
  if (pulito.length > MAX_NOME) return { ok: false, errore: `Il nome è troppo lungo (massimo ${MAX_NOME} caratteri).` }
  const tinta = COLORE.test(colore) ? colore : COLORI_GRUPPO[0]

  const db = createSupabaseServiceClient()
  // In fondo alla lista: l'ordine si sceglie a mano, non è alfabetico.
  const { data: esistenti } = await db.from('accessi_gruppi').select('ordine')
  const ordine = (esistenti ?? []).reduce((max, r) => Math.max(max, r.ordine ?? 0), 0) + 1
  const { error } = await db.from('accessi_gruppi').insert({ nome: pulito, colore: tinta, ordine })
  if (error) return { ok: false, errore: errorePerNomeDoppio(error.message) ?? error.message }

  await registraLog(emailCorrente(), 'accessi_gruppo_creato', { dettagli: { nome: pulito } })
  rivalida()
  return { ok: true }
}

export async function aggiornaGruppoAccessi(id: string, nome: string, colore: string): Promise<Esito> {
  if (!(await consentito())) return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  if (!UUID.test(id)) return { ok: false, errore: 'Gruppo non valido.' }
  const pulito = nomePulito(nome)
  if (!pulito) return { ok: false, errore: 'Il nome del gruppo non può essere vuoto.' }
  if (pulito.length > MAX_NOME) return { ok: false, errore: `Il nome è troppo lungo (massimo ${MAX_NOME} caratteri).` }
  if (!COLORE.test(colore)) return { ok: false, errore: 'Colore non valido.' }

  const db = createSupabaseServiceClient()
  const { error } = await db.from('accessi_gruppi').update({ nome: pulito, colore }).eq('id', id)
  if (error) return { ok: false, errore: errorePerNomeDoppio(error.message) ?? error.message }

  await registraLog(emailCorrente(), 'accessi_gruppo_modificato', { entitaId: id, dettagli: { nome: pulito } })
  rivalida()
  return { ok: true }
}

// Un gruppo con dei varchi dentro si può cancellare: i varchi tornano «senza
// gruppo» (la colonna è on delete cascade, vedi lo script SQL) e i numeri
// passati si ricalcolano da soli, perché i gruppi si applicano in lettura.
export async function eliminaGruppoAccessi(id: string): Promise<Esito> {
  if (!(await consentito())) return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  if (!UUID.test(id)) return { ok: false, errore: 'Gruppo non valido.' }
  const db = createSupabaseServiceClient()
  const { data: gruppo } = await db.from('accessi_gruppi').select('nome').eq('id', id).maybeSingle()
  const { error } = await db.from('accessi_gruppi').delete().eq('id', id)
  if (error) return { ok: false, errore: error.message }

  await registraLog(emailCorrente(), 'accessi_gruppo_eliminato', { entitaId: id, dettagli: { nome: gruppo?.nome ?? '' } })
  rivalida()
  return { ok: true }
}

/** Le assegnazioni dei varchi ai gruppi: `gruppoId` nullo = senza gruppo. */
export async function salvaAssegnazioniVarchi(assegnazioni: { chiave: string; gruppoId: string | null }[]): Promise<Esito> {
  if (!(await consentito())) return { ok: false, errore: 'Non hai accesso a questa sezione.' }
  const db = createSupabaseServiceClient()

  const [{ data: gruppi }, { data: terminali }] = await Promise.all([
    db.from('accessi_gruppi').select('id'),
    db.from('terminali_info4u').select('source_terminale_id, indirizzo, source_concentratore_id'),
  ])
  const gruppiValidi = new Set((gruppi ?? []).map((g) => g.id as string))
  const varchiValidi = new Set(
    (terminali ?? []).map((t) => `${t.source_terminale_id}-${t.indirizzo}-${t.source_concentratore_id}`)
  )

  const daAssegnare: { source_terminale_id: number; indirizzo: number; source_concentratore_id: number; gruppo_id: string }[] = []
  const daLiberare: { terminale: number; indirizzo: number; concentratore: number }[] = []
  for (const a of assegnazioni) {
    const varco = leggiChiaveVarco(a.chiave)
    if (!varco || !varchiValidi.has(a.chiave)) return { ok: false, errore: 'Varco non valido.' }
    if (a.gruppoId === null) daLiberare.push(varco)
    else if (gruppiValidi.has(a.gruppoId)) {
      daAssegnare.push({
        source_terminale_id: varco.terminale,
        indirizzo: varco.indirizzo,
        source_concentratore_id: varco.concentratore,
        gruppo_id: a.gruppoId,
      })
    } else return { ok: false, errore: 'Gruppo non valido.' }
  }

  if (daAssegnare.length > 0) {
    const { error } = await db
      .from('accessi_gruppi_varchi')
      .upsert(daAssegnare, { onConflict: 'source_terminale_id,indirizzo,source_concentratore_id' })
    if (error) return { ok: false, errore: error.message }
  }
  for (const v of daLiberare) {
    const { error } = await db
      .from('accessi_gruppi_varchi')
      .delete()
      .eq('source_terminale_id', v.terminale)
      .eq('indirizzo', v.indirizzo)
      .eq('source_concentratore_id', v.concentratore)
    if (error) return { ok: false, errore: error.message }
  }

  await registraLog(emailCorrente(), 'accessi_varchi_assegnati', {
    dettagli: { assegnati: daAssegnare.length, liberati: daLiberare.length },
  })
  rivalida()
  return { ok: true }
}
