'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { dividiTestoContatto } from '@/app/dashboard/agenda/nuovo-contatto'
import { dataRoma, dataScadenza, erroreDatiSocio, formattaCodice, statoEffettivo } from '@/lib/voucher'
import { emettiVoucher, impostaEmailEInvia, leggiVoucherPerId, reinviaVoucher } from '@/lib/voucher-server'

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

// L'emissione a mano è un permesso a parte (voucher-manuale), oltre a quello
// della sezione: l'elenco lo vedono in tanti, i codici li emette chi ha
// ricevuto questo.
async function operatoreManuale(): Promise<string | null> {
  const email = await operatoreAutorizzato()
  if (!email) return null
  if (!(await utenteHaSezione('voucher-manuale'))) return null
  return email
}

const NEGATO_MANUALE: { ok: false; errore: string } = { ok: false, errore: 'Non hai il permesso di inviare voucher a mano.' }

// ── invio manuale: il socio si cerca in anagrafica ─────────────────────────

export type AbbonamentoAttivo = { id: string; abbonamento: string; dataInizio: string | null; dataFine: string | null }
export type SocioVoucher = {
  id: string
  nome: string | null
  cognome: string | null
  email: string | null
  cellulare: string | null
  abbonamenti: AbbonamentoAttivo[]
}
export type EsitoRicercaSocio = { ok: true; soci: SocioVoucher[]; altri: boolean } | { ok: false; errore: string }

const RISULTATI_RICERCA = 20

// La stessa ricerca di Contatti e Segnalazioni (soci Info4U compresi): nome e
// cognome in qualsiasi ordine ed email da cerca_persone, il cellulare dalle
// ultime nove cifre. A ogni risultato si aggiungono gli abbonamenti attivi
// oggi, che sono la condizione per mandare il voucher.
export async function cercaSocioVoucher(testo: string): Promise<EsitoRicercaSocio> {
  if (!(await operatoreManuale())) return { ok: false, errore: NEGATO_MANUALE.errore }
  const cercato = testo.trim()
  if (cercato.length < 3) return { ok: false, errore: 'Scrivi almeno tre caratteri: nome e cognome, email o cellulare.' }

  const supabase = createSupabaseServiceClient()
  const campi = dividiTestoContatto(cercato)
  const { data, error } = campi.cellulare
    ? await supabase.rpc('cerca_persone_per_cellulare', {
        p_cifre: campi.cellulare.replace(/\D/g, '').slice(-9),
        p_limite: RISULTATI_RICERCA + 1,
      })
    : await supabase.rpc('cerca_persone', { p_query: cercato, p_limite: RISULTATI_RICERCA + 1 })
  if (error) {
    console.error('Ricerca del socio non riuscita:', error.message)
    return { ok: false, errore: 'La ricerca non è riuscita. Riprova.' }
  }
  const righe = ((data ?? []) as { id: string; nome: string | null; cognome: string | null; email: string | null; cellulare: string | null }[])
    .slice(0, RISULTATI_RICERCA + 1)
  const mostrate = righe.slice(0, RISULTATI_RICERCA)

  const attivi = new Map<string, AbbonamentoAttivo[]>()
  if (mostrate.length > 0) {
    const { data: ab, error: errAb } = await supabase
      .from('abbonamenti_attivi_oggi_dettaglio')
      .select('id, persona_id, abbonamento, data_inizio, data_fine')
      .in('persona_id', mostrate.map((r) => r.id))
      .order('data_fine', { ascending: false, nullsFirst: true })
    if (errAb) {
      console.error('Abbonamenti attivi non letti:', errAb.message)
      return { ok: false, errore: 'Non riesco a leggere gli abbonamenti. Riprova.' }
    }
    for (const a of (ab ?? []) as { id: string; persona_id: string; abbonamento: string; data_inizio: string | null; data_fine: string | null }[]) {
      const elenco = attivi.get(a.persona_id) ?? []
      elenco.push({ id: a.id, abbonamento: a.abbonamento, dataInizio: a.data_inizio, dataFine: a.data_fine })
      attivi.set(a.persona_id, elenco)
    }
  }

  return {
    ok: true,
    soci: mostrate.map((r) => ({ ...r, abbonamenti: attivi.get(r.id) ?? [] })),
    altri: righe.length > RISULTATI_RICERCA,
  }
}

// Un voucher già intestato alla stessa email (o allo stesso nome, se manca
// l'email) negli ultimi 60 giorni: come l'automazione, non se ne manda un
// secondo. Per rimandare il codice c'è «Reinvia email»; un voucher emesso per
// errore si annulla e poi se ne emette un altro.
const GIORNI_VOUCHER_ESISTENTE = 60

// Il voucher al socio scelto, a partire dal suo abbonamento attivo: nome,
// cognome, telefono ed email vengono dall'anagrafica e il codice parte subito
// per email. L'abbonamento si rilegge qui e non si crede al browser: deve
// essere di quella persona e in corso oggi.
export async function inviaVoucherASocio(dati: {
  personaId: string
  abbonamentoId: string
  email: string
}): Promise<EsitoAzione> {
  const operatore = await operatoreManuale()
  if (!operatore) return NEGATO_MANUALE

  const supabase = createSupabaseServiceClient()

  const { data: abbonamento } = await supabase
    .from('abbonamenti_attivi_oggi_dettaglio')
    .select('id, abbonamento')
    .eq('id', dati.abbonamentoId)
    .eq('persona_id', dati.personaId)
    .maybeSingle()
  if (!abbonamento) {
    return { ok: false, errore: 'Il socio non ha un abbonamento attivo oggi: il voucher non si può inviare.' }
  }

  const { data: persona } = await supabase
    .from('persone')
    .select('id, nome, cognome, email, cellulare')
    .eq('id', dati.personaId)
    .maybeSingle()
  if (!persona) return { ok: false, errore: 'Il socio non è più in anagrafica.' }

  const nome = (persona.nome ?? '').trim()
  const cognome = (persona.cognome ?? '').trim()
  const email = (dati.email || persona.email || '').trim().toLowerCase()
  const errore = erroreDatiSocio({ nome, cognome, email })
  if (errore) return { ok: false, errore }

  const protetto = (t: string) => t.replace(/[\\%_]/g, '\\$&')
  const dal = new Date(Date.now() - GIORNI_VOUCHER_ESISTENTE * 24 * 60 * 60 * 1000).toISOString()
  const { data: esistenti } = await supabase
    .from('voucher')
    .select('id, created_at')
    .ilike('email', protetto(email))
    .neq('stato', 'annullato')
    .gte('created_at', dal)
    .limit(1)
  if (esistenti && esistenti.length > 0) {
    return {
      ok: false,
      errore: `${nome} ${cognome} ha già un voucher emesso il ${dataRoma(esistenti[0].created_at)}: cercalo nell’elenco e usa «Reinvia email». Se era sbagliato, annullalo e riprova.`,
    }
  }

  const esito = await emettiVoucher({
    nome,
    cognome,
    email,
    telefono: persona.cellulare ?? null,
    note: `${abbonamento.abbonamento} · invio manuale`,
    validoFino: dataScadenza(),
    emessoDa: operatore,
  })
  if (!esito.ok) return esito

  await registraLog(operatore, 'voucher_emesso', {
    entita: 'voucher',
    entitaId: esito.voucher.id,
    dettagli: {
      codice: esito.voucher.codice,
      destinatario: esito.voucher.email,
      persona_id: dati.personaId,
      abbonamento_id: abbonamento.id,
      email_inviata: esito.emailInviata,
      manuale: true,
    },
  })

  revalidatePath('/dashboard/voucher')

  if (!esito.emailInviata) {
    return {
      ok: true,
      messaggio: `Voucher creato per ${nome} ${cognome}.`,
      avviso: `L’email non è partita (${esito.erroreEmail}). Il codice è valido: rimandala dall’elenco con «Reinvia email».`,
    }
  }
  return { ok: true, messaggio: `Voucher inviato a ${nome} ${cognome} (${esito.voucher.email}).` }
}

export async function creaVoucher(formData: FormData): Promise<EsitoAzione> {
  const email = await operatoreManuale()
  if (!email) return NEGATO_MANUALE

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

export async function reinviaEmail(id: string): Promise<EsitoAzione> {
  const email = await operatoreAutorizzato()
  if (!email) return NEGATO

  const esito = await reinviaVoucher(id, email)
  if (!esito.ok) return esito

  await registraLog(email, 'voucher_email_reinviata', {
    entita: 'voucher',
    entitaId: id,
    dettagli: {
      codice: esito.voucher.codice,
      destinatario: esito.voucher.email,
      invii: esito.voucher.email_invii,
      testo_originale: esito.identica,
    },
  })

  revalidatePath('/dashboard/voucher')
  return { ok: true, messaggio: `Email reinviata a ${esito.voucher.email}.` }
}

// Il socio senza email nel gestionale: l'operatore la inserisce qui e il codice
// parte subito (vedi impostaEmailEInvia).
export async function impostaEmail(id: string, emailInserita: string): Promise<EsitoAzione> {
  const email = await operatoreAutorizzato()
  if (!email) return NEGATO

  const esito = await impostaEmailEInvia(id, emailInserita, email)
  if (!esito.ok) return esito

  await registraLog(email, 'voucher_email_impostata', {
    entita: 'voucher',
    entitaId: id,
    dettagli: { codice: esito.voucher.codice, destinatario: esito.voucher.email, email_inviata: esito.emailInviata },
  })

  revalidatePath('/dashboard/voucher')
  if (!esito.emailInviata) {
    return {
      ok: true,
      messaggio: `Email salvata: ${esito.voucher.email}.`,
      avviso: `L’email non è partita (${esito.erroreEmail}). Riprova con «Reinvia email».`,
    }
  }
  return { ok: true, messaggio: `Email salvata e voucher inviato a ${esito.voucher.email}.` }
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
