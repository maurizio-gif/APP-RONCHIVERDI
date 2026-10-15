import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { mappaNomiStaff, nomeStaff, ordinaPerCognome, type RigaStaff } from '@/lib/staff'
import { oggiRoma, ultimoDelMese } from '@/lib/agenda'
import {
  COLONNE_SESSIONE,
  compensoAl,
  type ClienteScelto,
  type CompensoTrainer,
  type SessionePersonal,
} from '@/lib/personal'

// Server-only (usa il client service role): importare solo da Server
// Action/Server Component, mai da un file "use client".

/** Chi può comparire come trainer: gli account con la sezione `personal`. */
export async function leggiTrainer(): Promise<RigaStaff[]> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('staff_users')
    .select('email, nome, cognome')
    .contains('sezioni_consentite', ['personal'])
  return ordinaPerCognome((data ?? []) as RigaStaff[])
}

/** "Nome Cognome" di un account, da copiare sulla sessione. */
export async function nomeTrainer(email: string): Promise<string> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase.from('staff_users').select('email, nome, cognome').eq('email', email).maybeSingle()
  return nomeStaff((data as RigaStaff | null) ?? { email })
}

/** Le colonne del cliente da scrivere sulla sessione. */
export type DatiCliente = {
  persona_id: string
  abbonamento_id: string
  abbonamento_nome: string | null
  cliente_nome: string
  cliente_cognome: string
  corporate: boolean
  azienda: string | null
}

const LUNGHEZZA_MASSIMA_NOME = 80

/**
 * Ricontrolla sul database il cliente che arriva dal modulo e ne ricava le
 * colonne da salvare.
 *
 * Il browser manda solo gli id: nome, cognome e azienda si rileggono qui,
 * così una sessione non può essere intestata a un nome che l'anagrafica non
 * ha — tranne, per un corporate, il nome di chi si allena, che in anagrafica
 * non c'è ed è proprio quello che il trainer scrive.
 *
 * L'abbonamento deve essere della persona e attivo oggi, come nella ricerca:
 * altrimenti la Server Action chiamata a mano registrerebbe una lezione a
 * chiunque.
 */
export async function verificaCliente(
  cliente: ClienteScelto
): Promise<{ ok: true; dati: DatiCliente } | { ok: false; errore: string }> {
  if (!cliente?.personaId || !cliente?.abbonamentoId) {
    return { ok: false, errore: 'Scegli il cliente.' }
  }

  const supabase = createSupabaseServiceClient()
  const { data: abbonamento } = await supabase
    .from('abbonamenti')
    .select('id, persona_id, abbonamento, data_inizio, data_fine, cancellato_il, persone(nome, cognome, data_nascita)')
    .eq('id', cliente.abbonamentoId)
    .maybeSingle()

  const oggi = oggiRoma()
  const a = abbonamento as Record<string, any> | null
  if (
    !a ||
    a.persona_id !== cliente.personaId ||
    a.cancellato_il ||
    !a.data_inizio ||
    a.data_inizio > oggi ||
    (a.data_fine && a.data_fine < oggi)
  ) {
    return { ok: false, errore: 'L’abbonamento scelto non risulta attivo: cerca di nuovo il cliente.' }
  }

  const persona = (Array.isArray(a.persone) ? a.persone[0] : a.persone) as
    | { nome: string | null; cognome: string | null; data_nascita: string | null }
    | null

  if (cliente.tipo === 'corporate') {
    const nome = String(cliente.nome ?? '').trim().slice(0, LUNGHEZZA_MASSIMA_NOME)
    const cognome = String(cliente.cognome ?? '').trim().slice(0, LUNGHEZZA_MASSIMA_NOME)
    if (!nome || !cognome) {
      return { ok: false, errore: 'Scrivi nome e cognome di chi si allena con l’abbonamento corporate.' }
    }
    if (!/corporate/i.test(String(a.abbonamento ?? '')) || persona?.data_nascita) {
      return { ok: false, errore: 'L’abbonamento scelto non è un corporate aziendale.' }
    }
    return {
      ok: true,
      dati: {
        persona_id: cliente.personaId,
        abbonamento_id: cliente.abbonamentoId,
        abbonamento_nome: (a.abbonamento as string | null) ?? null,
        cliente_nome: nome,
        cliente_cognome: cognome,
        corporate: true,
        azienda: persona?.cognome?.trim() || null,
      },
    }
  }

  const nome = persona?.nome?.trim() || ''
  const cognome = persona?.cognome?.trim() || ''
  if (!nome && !cognome) {
    return { ok: false, errore: 'Il cliente scelto non ha nome e cognome in anagrafica.' }
  }
  return {
    ok: true,
    dati: {
      persona_id: cliente.personaId,
      abbonamento_id: cliente.abbonamentoId,
      abbonamento_nome: (a.abbonamento as string | null) ?? null,
      // Il vincolo della tabella vuole entrambi: una scheda con il solo
      // cognome (succede, fra gli importati) ripete il cognome invece di
      // restare senza nome.
      cliente_nome: nome || cognome,
      cliente_cognome: cognome || nome,
      corporate: false,
      azienda: null,
    },
  }
}

// ─────────────────────────────────────────────────── rendiconto del mese

export type SessioneConCompenso = SessionePersonal & { compenso: number | null }

export type RigaRendiconto = {
  trainerEmail: string
  trainerNome: string
  confermate: SessioneConCompenso[]
  inAttesa: number
  /** Il compenso in vigore l'ultimo giorno del mese: quello che la pagina mostra e propone di cambiare. */
  compensoFineMese: number | null
  /** Vero se nel mese il compenso è cambiato: il totale somma tariffe diverse. */
  compensoVariato: boolean
  /** Sessioni confermate senza un compenso in vigore nel loro giorno: contate, non pagate. */
  senzaCompenso: number
  totale: number
  storicoCompensi: (CompensoTrainer & { impostato_da: string | null; created_at: string | null })[]
}

/**
 * Il rendiconto di un mese, un trainer per riga: le sessioni confermate con
 * il compenso in vigore nel loro giorno, quante ne restano in attesa (non
 * entrano nel totale finché il responsabile non le conferma) e il totale.
 *
 * Compaiono i trainer con sessioni nel mese e quelli abilitati alla sezione,
 * anche a zero: l'amministrazione imposta il compenso prima che il trainer
 * cominci, non dopo.
 */
export async function rendicontoMese(mese: string): Promise<{ righe: RigaRendiconto[]; errore: string | null }> {
  const supabase = createSupabaseServiceClient()
  const fine = ultimoDelMese(mese)
  const [{ data: sessioni, error }, { data: compensi }, trainer, { data: staff }] = await Promise.all([
    supabase
      .from('personal_sessioni')
      .select(COLONNE_SESSIONE)
      .gte('data', mese)
      .lte('data', fine)
      .order('data', { ascending: true })
      .order('ora', { ascending: true })
      .limit(10000),
    supabase
      .from('personal_compensi')
      .select('trainer_email, valido_dal, compenso_sessione, impostato_da, created_at')
      .order('valido_dal', { ascending: false }),
    leggiTrainer(),
    supabase.from('staff_users').select('email, nome, cognome'),
  ])

  if (error) return { righe: [], errore: error.message }

  const tuttiCompensi = (compensi ?? []).map((c) => ({
    ...c,
    compenso_sessione: Number(c.compenso_sessione),
  })) as RigaRendiconto['storicoCompensi']
  const nomi = mappaNomiStaff((staff ?? []) as RigaStaff[])

  const perTrainer = new Map<string, RigaRendiconto>()
  const riga = (email: string, nomeSalvato?: string | null): RigaRendiconto => {
    let r = perTrainer.get(email)
    if (!r) {
      const compensoFineMese = compensoAl(tuttiCompensi, email, fine)
      r = {
        trainerEmail: email,
        trainerNome: nomi[email] ?? nomeSalvato ?? email,
        confermate: [],
        inAttesa: 0,
        compensoFineMese,
        compensoVariato: tuttiCompensi.some((c) => c.trainer_email === email && c.valido_dal > mese && c.valido_dal <= fine),
        senzaCompenso: 0,
        totale: 0,
        storicoCompensi: tuttiCompensi.filter((c) => c.trainer_email === email),
      }
      perTrainer.set(email, r)
    }
    return r
  }

  for (const t of trainer) riga(t.email, nomeStaff(t))
  for (const s of (sessioni ?? []) as unknown as SessionePersonal[]) {
    const r = riga(s.trainer_email, s.trainer_nome)
    if (s.stato !== 'confermata') {
      r.inAttesa += 1
      continue
    }
    const compenso = compensoAl(tuttiCompensi, s.trainer_email, s.data)
    r.confermate.push({ ...s, compenso })
    if (compenso == null) r.senzaCompenso += 1
    else r.totale += compenso
  }

  const righe = [...perTrainer.values()].sort((a, b) => a.trainerNome.localeCompare(b.trainerNome, 'it'))
  for (const r of righe) r.totale = Math.round(r.totale * 100) / 100
  return { righe, errore: null }
}
