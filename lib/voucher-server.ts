import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { inviaEmailAssegnazione, inviaEmailUtilizzato } from '@/lib/voucher-email'
import { dataOraRoma, generaCodice, statoEffettivo, type Voucher } from '@/lib/voucher'

// Le operazioni sul voucher che toccano il database, in un posto solo: le
// usano sia il pannello (emissione, reinvio, annullamento) sia l'interfaccia
// di validazione del partner (verifica e bruciatura). Il partner non parla
// con una copia diversa di queste regole — è la stessa funzione.
//
// Server-only: usa la service role key.

export const COLONNE =
  'id, codice, tipo, nome, cognome, email, telefono, note, stato, emesso_da, created_at, valido_fino, utilizzato_il, utilizzato_da, annullato_il, annullato_da, email_inviata_il, email_invii, email_errore'

// Quanti codici provare prima di arrendersi: con otto cifre una collisione è
// già improbabile, ma l'unique in tabella la rende un errore vero e qui si
// riprova invece di far fallire un'emissione.
const TENTATIVI_CODICE = 5

export type EsitoEmissione =
  | { ok: true; voucher: Voucher; emailInviata: boolean; erroreEmail?: string }
  | { ok: false; errore: string }

export async function emettiVoucher(dati: {
  nome: string
  cognome: string
  email: string
  telefono: string | null
  note: string | null
  validoFino: string
  emessoDa: string | null
  tipo?: string
}): Promise<EsitoEmissione> {
  const supabase = createSupabaseServiceClient()

  let voucher: Voucher | null = null
  let ultimoErrore = ''

  for (let tentativo = 0; tentativo < TENTATIVI_CODICE; tentativo++) {
    const { data, error } = await supabase
      .from('voucher')
      .insert({
        codice: generaCodice(),
        tipo: dati.tipo ?? 'visita_medica',
        nome: dati.nome,
        cognome: dati.cognome,
        email: dati.email,
        telefono: dati.telefono,
        note: dati.note,
        valido_fino: dati.validoFino,
        emesso_da: dati.emessoDa,
      })
      .select(COLONNE)
      .single()

    if (!error) {
      voucher = data as Voucher
      break
    }

    // 23505 = violazione di unique: è la collisione sul codice, l'unico caso
    // in cui riprovare ha senso. Qualsiasi altro errore si ferma subito.
    ultimoErrore = error.message
    if (error.code !== '23505') break
  }

  if (!voucher) {
    console.error('Voucher non emesso:', ultimoErrore)
    return { ok: false, errore: 'Non siamo riusciti a creare il voucher. Riprova.' }
  }

  // L'email parte subito e il suo esito viene salvato accanto al voucher: se
  // SendGrid è giù, il codice esiste comunque ed è già valido, e la
  // segreteria lo vede segnato "email non partita" con il pulsante per
  // rimandarla. Perdere il voucher per colpa dell'email sarebbe peggio.
  const aggiornato = await registraInvio(voucher, await inviaEmailAssegnazione(voucher))

  return {
    ok: true,
    voucher: aggiornato,
    emailInviata: aggiornato.email_errore === null,
    erroreEmail: aggiornato.email_errore ?? undefined,
  }
}

// Scrive sul voucher com'è andato l'invio e restituisce la riga aggiornata.
async function registraInvio(
  voucher: Voucher,
  esito: { ok: true } | { ok: false; errore: string }
): Promise<Voucher> {
  const supabase = createSupabaseServiceClient()
  const patch = esito.ok
    ? {
        email_inviata_il: new Date().toISOString(),
        email_invii: voucher.email_invii + 1,
        email_errore: null,
      }
    : { email_errore: esito.errore }

  const { data } = await supabase
    .from('voucher')
    .update(patch)
    .eq('id', voucher.id)
    .select(COLONNE)
    .single()

  return (data as Voucher) ?? { ...voucher, ...patch }
}

export type EsitoReinvio = { ok: true; voucher: Voucher } | { ok: false; errore: string }

export async function reinviaVoucher(id: string): Promise<EsitoReinvio> {
  const voucher = await leggiVoucherPerId(id)
  if (!voucher) return { ok: false, errore: 'Voucher non trovato.' }

  const stato = statoEffettivo(voucher)
  // Si rimanda solo un codice ancora spendibile: rispedire un voucher
  // bruciato o annullato manderebbe al socio un codice che al telefono si
  // sentirà rifiutare.
  if (stato !== 'attivo') {
    return { ok: false, errore: `Il voucher è ${stato}: non ha senso rimandarlo al socio.` }
  }

  const esito = await inviaEmailAssegnazione(voucher)
  const aggiornato = await registraInvio(voucher, esito)
  if (!esito.ok) return { ok: false, errore: esito.errore }
  return { ok: true, voucher: aggiornato }
}

export async function leggiVoucherPerId(id: string): Promise<Voucher | null> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase.from('voucher').select(COLONNE).eq('id', id).maybeSingle()
  return (data as Voucher) ?? null
}

export async function leggiVoucherPerCodice(codice: string): Promise<Voucher | null> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase.from('voucher').select(COLONNE).eq('codice', codice).maybeSingle()
  return (data as Voucher) ?? null
}

export type EsitoBruciatura =
  | { ok: true; voucher: Voucher }
  | { ok: false; motivo: 'inesistente' | 'utilizzato' | 'annullato' | 'scaduto' | 'errore'; voucher?: Voucher; errore?: string }

// La bruciatura: è l'operazione che vale soldi, e l'unica che il partner può
// fare sul nostro database.
export async function bruciaVoucher(codice: string, chi: string): Promise<EsitoBruciatura> {
  const voucher = await leggiVoucherPerCodice(codice)
  if (!voucher) return { ok: false, motivo: 'inesistente' }

  const stato = statoEffettivo(voucher)
  if (stato !== 'attivo') {
    return { ok: false, motivo: stato as 'utilizzato' | 'annullato' | 'scaduto', voucher }
  }

  const supabase = createSupabaseServiceClient()
  const adesso = new Date().toISOString()

  // Il filtro `.eq('stato', 'attivo')` è la guardia contro la doppia
  // bruciatura: due click ravvicinati, o due postazioni del partner sullo
  // stesso codice, arrivano qui insieme e uno solo trova la riga ancora
  // attiva. Senza, il secondo sovrascriverebbe il timestamp del primo.
  const { data, error } = await supabase
    .from('voucher')
    .update({ stato: 'utilizzato', utilizzato_il: adesso, utilizzato_da: chi })
    .eq('id', voucher.id)
    .eq('stato', 'attivo')
    .select(COLONNE)
    .maybeSingle()

  if (error) {
    console.error('Bruciatura non riuscita:', error.message)
    return { ok: false, motivo: 'errore', errore: 'Non siamo riusciti a registrare l’utilizzo. Riprova.' }
  }

  if (!data) {
    // Qualcuno è arrivato un istante prima: si rilegge lo stato vero invece
    // di dire che è andata bene.
    const riletto = await leggiVoucherPerCodice(codice)
    return { ok: false, motivo: 'utilizzato', voucher: riletto ?? voucher }
  }

  const bruciato = data as Voucher

  // La notifica al socio parte solo dopo che l'utilizzo è registrato, e un
  // suo fallimento non annulla la bruciatura: il codice è speso comunque, e
  // la traccia resta sul database del Club.
  const esitoEmail = await inviaEmailUtilizzato(bruciato, dataOraRoma(adesso))
  if (!esitoEmail.ok) {
    console.error('Notifica "voucher utilizzato" non inviata:', esitoEmail.errore)
  }

  return { ok: true, voucher: bruciato }
}
