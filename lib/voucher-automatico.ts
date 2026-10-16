import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { registraLog } from '@/lib/audit'
import { emettiVoucher } from '@/lib/voucher-server'
import { dataScadenza, erroreDatiSocio } from '@/lib/voucher'

// Il voucher che parte da solo: ogni nuova vendita di un prodotto con la
// sigla "(cer000)" nel nome riceve il codice per email, senza passare dalla
// segreteria. Lo chiama il cron /api/cron/voucher-automatico; l'interruttore
// e il punto di partenza stanno in tabella `automazioni`
// (scripts/sql/2026-10-16-voucher-automatico-cer000.sql).
//
// Server-only: usa la service role key e manda email.

export const CHIAVE_AUTOMAZIONE = 'voucher_cer000'

// La sigla come la scrive il gestionale nel nome del prodotto, oggi
// «1.1 GOLD OVER 35 (cer000)». Il confronto ignora maiuscole e minuscole.
export const SIGLA_PRODOTTO = '(cer000)'

// Quanto indietro guarda ogni giro, oltre al limite di `attiva_dal`: la
// sincronizzazione porta le vendite entro pochi minuti, e una finestra
// stretta evita che un abbonamento vecchio, ricomparso per una correzione
// nel gestionale, faccia partire un codice fuori tempo.
const GIORNI_FINESTRA = 7

// Un voucher già intestato alla stessa email in questo intervallo attorno
// alla vendita vuol dire che la segreteria l'ha emesso a mano: non se ne
// manda un secondo.
const GIORNI_VOUCHER_ESISTENTE = 60

// Tetto per giro: con una ventina di vendite al mese non si raggiunge mai,
// ma impedisce che un errore di filtro faccia partire centinaia di email.
const MASSIMO_PER_GIRO = 25

const EMESSO_DA = 'Automatico (cer000)'

export type StatoAutomazione = { attiva: boolean; attivaDal: string | null }

// null se la tabella non esiste ancora (migration non lanciata): per chi
// chiama è come se l'automazione fosse spenta.
export async function leggiStatoAutomazione(): Promise<StatoAutomazione | null> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('automazioni')
    .select('attiva, attiva_dal')
    .eq('chiave', CHIAVE_AUTOMAZIONE)
    .maybeSingle()
  if (error || !data) return null
  return { attiva: data.attiva === true, attivaDal: data.attiva_dal }
}

type Vendita = {
  id: string
  abbonamento: string | null
  variante: string | null
  data_vendita: string
  persone: { nome: string | null; cognome: string | null; email: string | null; cellulare: string | null } | null
}

export type Candidato = {
  abbonamentoId: string
  prodotto: string
  dataVendita: string
  nome: string
  cognome: string
  email: string
  esito: 'da_emettere' | 'emesso' | 'gia_emesso' | 'voucher_esistente' | 'dati_mancanti' | 'errore'
  dettaglio?: string
}

export type EsitoGiro =
  | { attiva: false; motivo: string }
  | { attiva: true; prova: boolean; dal: string; candidati: Candidato[] }

// `prova`: elenca le vendite che riceverebbero il codice, senza emettere né
// inviare nulla, e funziona anche ad automazione spenta (guarda gli ultimi
// GIORNI_FINESTRA giorni). Serve a controllare il filtro prima di accendere.
export async function eseguiVoucherAutomatico(opzioni: { prova?: boolean } = {}): Promise<EsitoGiro> {
  const prova = opzioni.prova === true
  const stato = await leggiStatoAutomazione()

  if (!prova) {
    if (!stato) return { attiva: false, motivo: 'tabella automazioni assente: lanciare la migration' }
    if (!stato.attiva || !stato.attivaDal) return { attiva: false, motivo: 'automazione spenta' }
  }

  const finestra = new Date(Date.now() - GIORNI_FINESTRA * 24 * 60 * 60 * 1000)
  const attivaDal = !prova && stato?.attivaDal ? new Date(stato.attivaDal) : null
  const dal = (attivaDal && attivaDal > finestra ? attivaDal : finestra).toISOString()

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('abbonamenti')
    .select('id, abbonamento, variante, data_vendita, persone(nome, cognome, email, cellulare)')
    .ilike('abbonamento', `%${SIGLA_PRODOTTO}%`)
    .is('cancellato_il', null)
    .gte('data_vendita', dal)
    .order('data_vendita', { ascending: true })
    .limit(200)

  if (error) throw new Error(`Lettura abbonamenti non riuscita: ${error.message}`)
  const vendite = (data ?? []) as unknown as Vendita[]
  if (vendite.length === 0) return { attiva: true, prova, dal, candidati: [] }

  // Le vendite che hanno già il loro voucher escono subito: è il caso di
  // ogni giro dopo il primo, e non deve costare un tentativo d'emissione.
  const { data: gia } = await supabase
    .from('voucher')
    .select('abbonamento_id')
    .in('abbonamento_id', vendite.map((v) => v.id))
  const conVoucher = new Set((gia ?? []).map((r) => r.abbonamento_id as string))

  const candidati: Candidato[] = []
  let emessiInQuestoGiro = 0

  for (const v of vendite) {
    const p = v.persone
    const candidato: Candidato = {
      abbonamentoId: v.id,
      prodotto: [v.abbonamento, v.variante].filter(Boolean).join(' · '),
      dataVendita: v.data_vendita,
      nome: (p?.nome ?? '').trim(),
      cognome: (p?.cognome ?? '').trim(),
      email: (p?.email ?? '').trim().toLowerCase(),
      esito: 'da_emettere',
    }
    candidati.push(candidato)

    if (conVoucher.has(v.id)) {
      candidato.esito = 'gia_emesso'
      continue
    }

    const datiMancanti = erroreDatiSocio(candidato)
    if (datiMancanti) {
      candidato.esito = 'dati_mancanti'
      candidato.dettaglio = datiMancanti
      continue
    }

    const vendita = new Date(v.data_vendita).getTime()
    const giorni = GIORNI_VOUCHER_ESISTENTE * 24 * 60 * 60 * 1000
    const { data: esistenti } = await supabase
      .from('voucher')
      .select('id')
      // ilike per ignorare le maiuscole di chi l'ha scritta a mano; `_` e
      // `%` negli indirizzi vanno protetti, o diventano jolly.
      .ilike('email', candidato.email.replace(/[\\%_]/g, '\\$&'))
      .neq('stato', 'annullato')
      .gte('created_at', new Date(vendita - giorni).toISOString())
      .limit(1)
    if (esistenti && esistenti.length > 0) {
      candidato.esito = 'voucher_esistente'
      candidato.dettaglio = 'Il socio ha già un voucher emesso attorno a questa vendita.'
      continue
    }

    if (prova) continue
    if (emessiInQuestoGiro >= MASSIMO_PER_GIRO) continue

    const esito = await emettiVoucher({
      nome: candidato.nome,
      cognome: candidato.cognome,
      email: candidato.email,
      telefono: p?.cellulare?.trim() || null,
      note: `${candidato.prodotto} venduto il ${new Date(v.data_vendita).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}`,
      validoFino: dataScadenza(),
      emessoDa: EMESSO_DA,
      abbonamentoId: v.id,
    })

    if (!esito.ok) {
      candidato.esito = esito.giaEmesso ? 'gia_emesso' : 'errore'
      candidato.dettaglio = esito.errore
      continue
    }

    emessiInQuestoGiro++
    candidato.esito = 'emesso'
    if (!esito.emailInviata) candidato.dettaglio = `Email non partita: ${esito.erroreEmail ?? ''}`

    await registraLog(null, 'voucher_emesso', {
      entita: 'voucher',
      entitaId: esito.voucher.id,
      dettagli: {
        codice: esito.voucher.codice,
        destinatario: esito.voucher.email,
        email_inviata: esito.emailInviata,
        automatico: CHIAVE_AUTOMAZIONE,
        abbonamento_id: v.id,
      },
    })
  }

  return { attiva: true, prova, dal, candidati }
}
