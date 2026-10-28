import { inviaEmail, type EsitoEmail } from '@/lib/email'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import type { Voucher } from '@/lib/voucher'
import { emailAssegnazione, emailUtilizzato } from '@/supabase/functions/_shared/voucher-email-testi'

// La spedizione delle email del voucher dal pannello. I testi stanno in
// supabase/functions/_shared/voucher-email-testi.ts, condivisi con la edge
// function che emette i voucher automatici: si cambiano là, una volta sola.
//
// Server-only: importa lib/email, che legge la chiave SendGrid.

export { emailAssegnazione, emailUtilizzato }

// Il «tipo» delle email del voucher nel tracking: la edge function
// voucher-automatico usa lo stesso testo per l'assegnazione.
export const AUTOMAZIONE_ASSEGNAZIONE = 'Voucher: codice assegnato'
export const AUTOMAZIONE_UTILIZZO = 'Voucher: codice utilizzato'
export const AUTOMAZIONE_REINVIO = 'Voucher: codice reinviato'

export async function inviaEmailAssegnazione(voucher: Voucher, inviataDa: string | null): Promise<EsitoEmail> {
  const { oggetto, html, testo } = emailAssegnazione(voucher)
  return inviaEmail({
    a: voucher.email,
    oggetto,
    html,
    testo,
    automazione: AUTOMAZIONE_ASSEGNAZIONE,
    traccia: true,
    voucherId: voucher.id,
    inviataDa,
  })
}

// Il reinvio per chi ha perso l'email: riparte la STESSA email partita
// all'assegnazione, con oggetto e testo letti dal tracking (immutabili), non
// una riscrittura dal template di oggi. Così il socio riceve il codice e le
// istruzioni che aveva avuto, anche se nel frattempo i testi o i recapiti del
// partner sono cambiati. Se l'originale non c'è (voucher emesso prima del
// tracking, o email mai partita) si ricompone dal template.
export async function inviaEmailReinvio(
  voucher: Voucher,
  inviataDa: string | null
): Promise<EsitoEmail & { identica: boolean }> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('email_inviate')
    .select('oggetto, corpo_html, corpo_testo')
    .eq('voucher_id', voucher.id)
    .eq('automazione', AUTOMAZIONE_ASSEGNAZIONE)
    .eq('esito', 'inviata')
    .order('inviata_il', { ascending: true })
    .limit(1)
    .maybeSingle()

  const originale = data?.corpo_html && data.corpo_testo ? data : null
  const { oggetto, html, testo } = originale
    ? { oggetto: originale.oggetto as string, html: originale.corpo_html as string, testo: originale.corpo_testo as string }
    : emailAssegnazione(voucher)

  const esito = await inviaEmail({
    a: voucher.email,
    oggetto,
    html,
    testo,
    automazione: AUTOMAZIONE_REINVIO,
    traccia: true,
    voucherId: voucher.id,
    inviataDa,
  })
  return { ...esito, identica: originale !== null }
}

// Parte quando il partner brucia il codice: chi l'ha fatta partire è il
// partner, ma l'invio è automatico.
export async function inviaEmailUtilizzato(voucher: Voucher, quando: string): Promise<EsitoEmail> {
  const { oggetto, html, testo } = emailUtilizzato(voucher, quando)
  return inviaEmail({
    a: voucher.email,
    oggetto,
    html,
    testo,
    automazione: AUTOMAZIONE_UTILIZZO,
    traccia: true,
    voucherId: voucher.id,
    inviataDa: 'automatico',
  })
}
