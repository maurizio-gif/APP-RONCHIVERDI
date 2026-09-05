'use server'

import { redirect } from 'next/navigation'
import { registraLog } from '@/lib/audit'
import { ETICHETTE_STATO, formattaCodice, nomeCompleto, normalizzaCodice, statoEffettivo } from '@/lib/voucher'
import { bruciaVoucher, leggiVoucherPerCodice } from '@/lib/voucher-server'
import { accessoValido, apriSessione, chiudiSessione, codiceConfigurato } from './accesso'

// Chi risulta aver bruciato il codice: il partner, non una persona. Vedi
// app/chiron/accesso.ts sul perché l'accesso è condiviso.
const PARTNER = process.env.PARTNER_MEDICO_NOME ?? 'Chiron'

export async function entra(formData: FormData) {
  const inserito = String(formData.get('codice_accesso') ?? '').trim()
  const atteso = codiceConfigurato()

  if (!atteso) redirect('/chiron?error=non-configurato')
  if (inserito !== atteso) {
    await registraLog(null, 'chiron_accesso_rifiutato', { entita: 'voucher' })
    redirect('/chiron?error=credenziali')
  }

  apriSessione(inserito)
  redirect('/chiron')
}

export async function esci() {
  chiudiSessione()
  redirect('/chiron')
}

// Quello che il partner vede dopo aver digitato un codice. Il nominativo si
// mostra solo su un voucher che esiste: su un codice inesistente sarebbe un
// modo per pescare nomi di soci provando cifre a caso.
export type Verifica = {
  codice: string
  stato: 'attivo' | 'utilizzato' | 'annullato' | 'scaduto' | 'inesistente'
  etichetta: string
  intestatario?: string
  validoFino?: string
  utilizzatoIl?: string
}

export async function verificaCodice(inserito: string): Promise<Verifica | { errore: string }> {
  if (!accessoValido()) return { errore: 'Sessione scaduta: ricarica la pagina e rientra.' }

  const codice = normalizzaCodice(inserito)
  if (codice.length < 4) return { errore: 'Inserisci il codice numerico che ti detta il socio.' }

  const voucher = await leggiVoucherPerCodice(codice)
  if (!voucher) {
    return { codice: formattaCodice(codice), stato: 'inesistente', etichetta: 'Codice inesistente' }
  }

  const stato = statoEffettivo(voucher)
  return {
    codice: formattaCodice(voucher.codice),
    stato,
    etichetta: ETICHETTE_STATO[stato],
    intestatario: nomeCompleto(voucher),
    validoFino: voucher.valido_fino,
    utilizzatoIl: voucher.utilizzato_il ?? undefined,
  }
}

export type EsitoUso =
  | { ok: true; codice: string; intestatario: string; quando: string }
  | { ok: false; errore: string }

export async function usaCodice(inserito: string): Promise<EsitoUso> {
  if (!accessoValido()) return { ok: false, errore: 'Sessione scaduta: ricarica la pagina e rientra.' }

  const codice = normalizzaCodice(inserito)
  const esito = await bruciaVoucher(codice, PARTNER)

  if (!esito.ok) {
    await registraLog(null, 'voucher_uso_rifiutato', {
      entita: 'voucher',
      entitaId: esito.voucher?.id,
      dettagli: { codice, motivo: esito.motivo, partner: PARTNER },
    })

    const messaggi: Record<typeof esito.motivo, string> = {
      inesistente: 'Questo codice non esiste: controlla le cifre con il socio.',
      utilizzato: 'Questo codice risulta già utilizzato: la visita è già stata prenotata.',
      annullato: 'Questo codice è stato annullato dal Club: la visita non è più inclusa.',
      scaduto: 'Questo codice è scaduto: la visita non è più inclusa.',
      errore: esito.errore ?? 'Non siamo riusciti a registrare l’utilizzo. Riprova.',
    }
    return { ok: false, errore: messaggi[esito.motivo] }
  }

  await registraLog(null, 'voucher_utilizzato', {
    entita: 'voucher',
    entitaId: esito.voucher.id,
    dettagli: { codice: esito.voucher.codice, partner: PARTNER, destinatario: esito.voucher.email },
  })

  return {
    ok: true,
    codice: formattaCodice(esito.voucher.codice),
    intestatario: nomeCompleto(esito.voucher),
    quando: esito.voucher.utilizzato_il!,
  }
}
