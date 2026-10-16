import { inviaEmail, type EsitoEmail } from '@/lib/email'
import type { Voucher } from '@/lib/voucher'
import { emailAssegnazione, emailUtilizzato } from '@/supabase/functions/_shared/voucher-email-testi'

// La spedizione delle email del voucher dal pannello. I testi stanno in
// supabase/functions/_shared/voucher-email-testi.ts, condivisi con la edge
// function che emette i voucher automatici: si cambiano là, una volta sola.
//
// Server-only: importa lib/email, che legge la chiave SendGrid.

export { emailAssegnazione, emailUtilizzato }

export async function inviaEmailAssegnazione(voucher: Voucher): Promise<EsitoEmail> {
  const { oggetto, html, testo } = emailAssegnazione(voucher)
  return inviaEmail({ a: voucher.email, oggetto, html, testo })
}

export async function inviaEmailUtilizzato(voucher: Voucher, quando: string): Promise<EsitoEmail> {
  const { oggetto, html, testo } = emailUtilizzato(voucher, quando)
  return inviaEmail({ a: voucher.email, oggetto, html, testo })
}
