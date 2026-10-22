import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { SEZIONE_CHECK_SOSPENSIONI, type MotivoSospensione } from '@/lib/sospensioni'

// Server-only (client service role): le letture della pagina Check
// sospensioni e del badge nel menu.

type Supabase = ReturnType<typeof createSupabaseServiceClient>

/**
 * Il nome con cui l'operatore compare in Info4U (staff_users.operatore_info4u),
 * o null se non è collegato. Letto a parte e non dentro rigaStaffCorrente:
 * finché la migration non è passata la colonna non esiste, e una select che
 * la nomina farebbe fallire il controllo d'accesso di tutto il pannello.
 */
export async function operatoreInfo4uDi(email: string | null | undefined): Promise<string | null> {
  if (!email) return null
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('staff_users')
    .select('operatore_info4u')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle()
  if (error) return null
  return ((data as { operatore_info4u: string | null } | null)?.operatore_info4u ?? '').trim() || null
}

/**
 * Le sospensioni dell'operatore corrente ancora senza motivo: il numero sulla
 * voce di menu. 0 a chi non ha la sezione o non è un operatore Info4U, e 0 se
 * la lettura non riesce — un badge mancante non deve rompere il menu.
 */
export async function contaSospensioniDaMotivare(email: string | null | undefined): Promise<number> {
  if (!email) return 0
  const sezioni = await getSezioniConsentite(email)
  if (!sezioni.includes(SEZIONE_CHECK_SOSPENSIONI)) return 0
  const operatore = await operatoreInfo4uDi(email)
  if (!operatore) return 0
  const supabase = createSupabaseServiceClient()
  const { count, error } = await supabase
    .from('check_sospensioni')
    .select('source_log_id', { count: 'exact', head: true })
    .eq('operatore_nome', operatore)
    .eq('motivata', false)
  if (error) return 0
  return count ?? 0
}

// 150 id a richiesta: l'elenco va nell'URL della GET di PostgREST.
const BLOCCO = 150

/**
 * Le note sul motivo, raggruppate per la chiave scelta (la proroga o
 * l'abbonamento), la più recente in cima. Se la tabella non c'è ancora
 * ritorna vuoto: la pagina resta usabile.
 */
export async function caricaMotivi(
  supabase: Supabase,
  per: 'source_log_id' | 'source_iscrizione_id',
  ids: number[]
): Promise<Record<number, MotivoSospensione[]>> {
  const risultato: Record<number, MotivoSospensione[]> = {}
  const unici = Array.from(new Set(ids))
  const blocchi: number[][] = []
  for (let i = 0; i < unici.length; i += BLOCCO) blocchi.push(unici.slice(i, i + BLOCCO))
  const risposte = await Promise.all(
    blocchi.map((blocco) =>
      supabase
        .from('sospensioni_motivi')
        .select(`id, testo, autore, creato_il, ${per}`)
        .in(per, blocco)
        .order('creato_il', { ascending: false })
    )
  )
  for (const { data, error } of risposte) {
    if (error) {
      console.error('Motivi delle sospensioni non letti:', error.message)
      continue
    }
    for (const riga of (data ?? []) as unknown as (MotivoSospensione & Record<string, number>)[]) {
      const chiave = riga[per]
      ;(risultato[chiave] ??= []).push({ id: riga.id, testo: riga.testo, autore: riga.autore, creato_il: riga.creato_il })
    }
  }
  return risultato
}
