import { inviaEmail, type EsitoEmail } from '@/lib/email'
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
