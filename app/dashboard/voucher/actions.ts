'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { dataScadenza, erroreDatiSocio, formattaCodice, statoEffettivo } from '@/lib/voucher'
import { emettiVoucher, leggiVoucherPerId, reinviaVoucher } from '@/lib/voucher-server'

// Esito come valore di ritorno e non throw: in produzione Next.js oscura il
// messaggio di un errore lanciato da una Server Action, e qui la segreteria
// deve sapere se il voucher è nato ma l'email non è partita — che è una cosa
// da rimediare, non un fallimento.
export type EsitoAzione =
  | { ok: true; messaggio: string; avviso?: string }
  | { ok: false; errore: string }

const NEGATO: EsitoAzione = { ok: false, errore: 'Non hai il permesso di gestire i voucher.' }

async function operatoreAutorizzato(): Promise<string | null> {
  const email = emailCorrente()
  if (!email) return null
  if (!(await utenteHaSezione('voucher'))) return null
  return email
}

export async function creaVoucher(formData: FormData): Promise<EsitoAzione> {
  const email = await operatoreAutorizzato()
  if (!email) return NEGATO

  const dati = {
    nome: String(formData.get('nome') ?? '').trim(),
    cognome: String(formData.get('cognome') ?? '').trim(),
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
  }

  const errore = erroreDatiSocio(dati)
  if (errore) return { ok: false, errore }

  const esito = await emettiVoucher({
    ...dati,
    telefono: String(formData.get('telefono') ?? '').trim() || null,
    note: String(formData.get('note') ?? '').trim() || null,
    validoFino: dataScadenza(),
    emessoDa: email,
  })

  if (!esito.ok) return esito

  await registraLog(email, 'voucher_emesso', {
    entita: 'voucher',
    entitaId: esito.voucher.id,
    dettagli: {
      codice: esito.voucher.codice,
      destinatario: esito.voucher.email,
      email_inviata: esito.emailInviata,
    },
  })

  revalidatePath('/dashboard/voucher')

  const codice = formattaCodice(esito.voucher.codice)
  if (!esito.emailInviata) {
    return {
      ok: true,
      messaggio: `Voucher ${codice} creato.`,
      avviso: `L’email al socio non è partita (${esito.erroreEmail}). Il codice è valido: rimanda l’email dall’elenco.`,
    }
  }
  return { ok: true, messaggio: `Voucher ${codice} creato e inviato a ${esito.voucher.email}.` }
}

export async function rimandaEmail(id: string): Promise<EsitoAzione> {
  const email = await operatoreAutorizzato()
  if (!email) return NEGATO

  const esito = await reinviaVoucher(id)
  if (!esito.ok) return esito

  await registraLog(email, 'voucher_email_reinviata', {
    entita: 'voucher',
    entitaId: id,
    dettagli: { codice: esito.voucher.codice, destinatario: esito.voucher.email },
  })

  revalidatePath('/dashboard/voucher')
  return { ok: true, messaggio: `Email rimandata a ${esito.voucher.email}.` }
}

// Annullare, non cancellare: un voucher emesso per errore resta in tabella
// con il suo stato, perché il socio l'email l'ha comunque ricevuta e al
// telefono potrebbe dettare quel codice. Chi valida deve vedere "annullato",
// non "inesistente".
export async function annullaVoucher(id: string): Promise<EsitoAzione> {
  const email = await operatoreAutorizzato()
  if (!email) return NEGATO

  const voucher = await leggiVoucherPerId(id)
  if (!voucher) return { ok: false, errore: 'Voucher non trovato.' }
  if (voucher.stato === 'utilizzato') {
    return { ok: false, errore: 'Il voucher è già stato utilizzato: non si può annullare.' }
  }
  if (voucher.stato === 'annullato') return { ok: false, errore: 'Il voucher è già annullato.' }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('voucher')
    .update({ stato: 'annullato', annullato_il: new Date().toISOString(), annullato_da: email })
    .eq('id', id)
    .eq('stato', 'attivo')

  if (error) {
    console.error('Voucher non annullato:', error.message)
    return { ok: false, errore: 'Non siamo riusciti ad annullare il voucher. Riprova.' }
  }

  await registraLog(email, 'voucher_annullato', {
    entita: 'voucher',
    entitaId: id,
    dettagli: { codice: voucher.codice, stato_precedente: statoEffettivo(voucher) },
  })

  revalidatePath('/dashboard/voucher')
  return { ok: true, messaggio: `Voucher ${formattaCodice(voucher.codice)} annullato.` }
}
