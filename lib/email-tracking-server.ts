import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { COLONNE_ESITO, type EmailEsito } from '@/lib/email-tracking'

// Le letture del tracking email. Server-only: usa la service role key, e le
// tabelle hanno RLS senza policy.

// Le email di un socio: quelle collegate alla sua scheda e quelle mandate al
// suo indirizzo senza collegamento (un indirizzo condiviso in famiglia non
// dice di chi era: si mostra a tutti quelli che lo usano).
export async function emailDellaPersona(personaId: string, email: string | null): Promise<EmailEsito[]> {
  const supabase = createSupabaseServiceClient()
  const [collegate, perIndirizzo] = await Promise.all([
    supabase
      .from('email_inviate_esiti')
      .select(COLONNE_ESITO)
      .eq('persona_id', personaId)
      .order('inviata_il', { ascending: false })
      .limit(200),
    email
      ? supabase
          .from('email_inviate_esiti')
          .select(COLONNE_ESITO)
          .is('persona_id', null)
          // ilike per le maiuscole; `_` e `%` vanno protetti, o diventano jolly.
          .ilike('destinatario', email.trim().replace(/[\\%_]/g, '\\$&'))
          .order('inviata_il', { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (collegate.error || perIndirizzo.error) {
    console.error('Email della persona non lette:', (collegate.error ?? perIndirizzo.error)?.message)
  }
  return [...((collegate.data ?? []) as EmailEsito[]), ...((perIndirizzo.data ?? []) as EmailEsito[])].sort(
    (a, b) => b.inviata_il.localeCompare(a.inviata_il)
  )
}

// Le email di un gruppo di voucher, raggruppate per voucher, dalla più
// recente: è la colonna «Email» del riepilogo voucher.
export async function emailDeiVoucher(voucherIds: string[]): Promise<Map<string, EmailEsito[]>> {
  const perVoucher = new Map<string, EmailEsito[]>()
  if (voucherIds.length === 0) return perVoucher
  const supabase = createSupabaseServiceClient()
  // A blocchi: l'elenco può arrivare a qualche centinaio di id, e l'URL di
  // PostgREST ha un limite di lunghezza.
  for (let i = 0; i < voucherIds.length; i += 150) {
    const { data, error } = await supabase
      .from('email_inviate_esiti')
      .select(COLONNE_ESITO)
      .in('voucher_id', voucherIds.slice(i, i + 150))
      .order('inviata_il', { ascending: false })
    if (error) {
      console.error('Email dei voucher non lette:', error.message)
      continue
    }
    for (const e of (data ?? []) as EmailEsito[]) {
      const elenco = perVoucher.get(e.voucher_id!) ?? []
      elenco.push(e)
      perVoucher.set(e.voucher_id!, elenco)
    }
  }
  return perVoucher
}

// Tutte le email di un periodo, per la sezione Tracking email.
export async function emailDelPeriodo(dal: Date, limite = 2000): Promise<EmailEsito[]> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('email_inviate_esiti')
    .select(COLONNE_ESITO)
    .gte('inviata_il', dal.toISOString())
    .order('inviata_il', { ascending: false })
    .limit(limite)
  if (error) {
    console.error('Tracking email non letto:', error.message)
    return []
  }
  return (data ?? []) as EmailEsito[]
}

export type EventoEmail = {
  evento: string
  momento: string
  destinatario: string | null
  dettaglio: string | null
  firmato: boolean
}

export type ProvaDiInvio = {
  email: EmailEsito
  rispondiA: string | null
  corpoHtml: string | null
  corpoTesto: string | null
  impronta: { registrata: string | null; registrataIl: string | null; integra: boolean } | null
  eventi: EventoEmail[]
  persona: { id: string; nome: string | null; cognome: string | null } | null
  codiceVoucher: string | null
}

// Tutto quello che serve alla prova di invio di una email: il testo
// integrale, la verifica dell'impronta fatta adesso dal database e gli
// eventi di SendGrid in ordine di tempo.
export async function provaDiInvio(id: string): Promise<ProvaDiInvio | null> {
  const supabase = createSupabaseServiceClient()
  const { data: email } = await supabase.from('email_inviate_esiti').select(COLONNE_ESITO).eq('id', id).maybeSingle()
  if (!email) return null
  const e = email as EmailEsito

  const [{ data: corpo }, { data: impronta }, { data: eventi }, { data: persona }, { data: voucher }] = await Promise.all([
    supabase.from('email_inviate').select('rispondi_a, corpo_html, corpo_testo').eq('id', id).single(),
    supabase.rpc('verifica_impronta_email_inviata', { p_id: id }),
    e.provider_message_id
      ? supabase
          .from('email_eventi')
          .select('evento, momento, destinatario, dettaglio, firmato')
          .eq('provider_message_id', e.provider_message_id)
          .order('momento', { ascending: true })
          .limit(300)
      : Promise.resolve({ data: [] }),
    e.persona_id
      ? supabase.from('persone').select('id, nome, cognome').eq('id', e.persona_id).maybeSingle()
      : Promise.resolve({ data: null }),
    e.voucher_id
      ? supabase.from('voucher').select('codice').eq('id', e.voucher_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const verifica = Array.isArray(impronta) ? impronta[0] : null
  // Gli eventi di un messaggio con più destinatari (cc) arrivano tutti con
  // lo stesso id: si tengono quelli di questo destinatario.
  const destinatario = e.destinatario.toLowerCase()
  const propri = ((eventi ?? []) as EventoEmail[]).filter((x) => !x.destinatario || x.destinatario === destinatario)

  return {
    email: e,
    rispondiA: corpo?.rispondi_a ?? null,
    corpoHtml: corpo?.corpo_html ?? null,
    corpoTesto: corpo?.corpo_testo ?? null,
    impronta: verifica
      ? { registrata: verifica.registrata, registrataIl: verifica.registrata_il, integra: verifica.integra === true }
      : null,
    eventi: propri,
    persona: (persona as ProvaDiInvio['persona']) ?? null,
    codiceVoucher: (voucher as { codice: string } | null)?.codice ?? null,
  }
}
