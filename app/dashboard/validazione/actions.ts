'use server'

import { registraLog } from '@/lib/audit'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { ETICHETTE_STATO, formattaCodice, nomeCompleto, normalizzaCodice, statoEffettivo } from '@/lib/voucher'
import { bruciaVoucher, leggiVoucherPerCodice } from '@/lib/voucher-server'

// Le azioni della pagina di validazione, quella che usa il centro medico.
//
// L'accesso è un account del pannello con la sola sezione
// 'validazione-voucher': chi brucia un codice ha un nome e cognome, e resta
// scritto accanto al voucher. Revocare l'accesso a una persona che cambia
// lavoro è togliere una riga da Gestione utenti, non cambiare un codice
// condiviso a tutti.

const NEGATO = 'Non hai il permesso di validare i voucher.'

async function operatore(): Promise<string | null> {
  const email = emailCorrente()
  if (!email) return null
  if (!(await utenteHaSezione('validazione-voucher'))) return null
  return email
}

// Quello che si vede dopo aver digitato un codice. Il nominativo si mostra
// solo su un voucher che esiste: su un codice inesistente sarebbe un modo per
// pescare nomi di soci provando cifre a caso.
export type Verifica = {
  codice: string
  stato: 'attivo' | 'utilizzato' | 'annullato' | 'scaduto' | 'inesistente'
  etichetta: string
  intestatario?: string
  validoFino?: string
  utilizzatoIl?: string
}

export async function verificaCodice(inserito: string): Promise<Verifica | { errore: string }> {
  if (!(await operatore())) return { errore: NEGATO }

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
  const email = await operatore()
  if (!email) return { ok: false, errore: NEGATO }

  const codice = normalizzaCodice(inserito)
  const esito = await bruciaVoucher(codice, email)

  if (!esito.ok) {
    await registraLog(email, 'voucher_uso_rifiutato', {
      entita: 'voucher',
      entitaId: esito.voucher?.id,
      dettagli: { codice, motivo: esito.motivo },
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

  await registraLog(email, 'voucher_utilizzato', {
    entita: 'voucher',
    entitaId: esito.voucher.id,
    dettagli: { codice: esito.voucher.codice, destinatario: esito.voucher.email },
  })

  return {
    ok: true,
    codice: formattaCodice(esito.voucher.codice),
    intestatario: nomeCompleto(esito.voucher),
    quando: esito.voucher.utilizzato_il!,
  }
}
