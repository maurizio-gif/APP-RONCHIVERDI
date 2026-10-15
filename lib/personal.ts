// Personal training: le sessioni registrate dai trainer, confermate dal
// responsabile e pagate dall'amministrazione (vedi
// scripts/sql/2026-10-15-personal-training.sql).
//
// Nessun import server-only: il file è usato sia dai Server Component sia dai
// componenti client (il modulo del trainer, i comandi del responsabile).

import { giornoPiu } from './agenda'

export const STATI_SESSIONE = ['in_attesa', 'confermata'] as const
export type StatoSessione = (typeof STATI_SESSIONE)[number]

export const ETICHETTE_STATO_SESSIONE: Record<StatoSessione, string> = {
  in_attesa: 'In attesa',
  confermata: 'Confermata',
}

export const CLASSE_STATO_SESSIONE: Record<StatoSessione, string> = {
  in_attesa: 'badge badge-warn',
  confermata: 'badge badge-ok',
}

export function eStatoSessione(valore: string | null | undefined): valore is StatoSessione {
  return (STATI_SESSIONE as readonly string[]).includes(valore ?? '')
}

export type SessionePersonal = {
  id: string
  created_at: string
  trainer_email: string
  trainer_nome: string | null
  persona_id: string | null
  abbonamento_id: string | null
  abbonamento_nome: string | null
  cliente_nome: string
  cliente_cognome: string
  corporate: boolean
  azienda: string | null
  data: string
  ora: string
  stato: StatoSessione
  confermata_il: string | null
  confermata_da: string | null
  modificata_il: string | null
  modificata_da: string | null
}

export const COLONNE_SESSIONE =
  'id, created_at, trainer_email, trainer_nome, persona_id, abbonamento_id, abbonamento_nome, cliente_nome, cliente_cognome, corporate, azienda, data, ora, stato, confermata_il, confermata_da, modificata_il, modificata_da'

/** "Rossi Mario": l'ordine dei registri, che si scorrono per cognome. */
export function nomeCliente(s: Pick<SessionePersonal, 'cliente_nome' | 'cliente_cognome'>): string {
  return `${s.cliente_cognome} ${s.cliente_nome}`.trim()
}

// ─────────────────────────────────────────────────── il cliente scelto

/** Una persona con abbonamento attivo, come la restituisce personal_cerca_clienti. */
export type ClienteTrovato = {
  persona_id: string
  nome: string | null
  cognome: string | null
  data_nascita: string | null
  abbonamento_id: string
  abbonamenti: string[]
}

/** Un abbonamento corporate attivo, come lo restituisce personal_cerca_corporate. */
export type CorporateTrovato = {
  persona_id: string
  nome: string | null
  azienda: string | null
  abbonamento_id: string
  abbonamento: string
  data_fine: string | null
}

/**
 * Il cliente come lo manda il modulo: la persona e l'abbonamento scelti, e —
 * solo per un corporate — il nome di chi si allena, scritto a mano.
 *
 * `azienda_manuale` è il corporate la cui azienda non si trova fra gli
 * abbonamenti: il trainer scrive a mano azienda, nome e cognome, e la
 * sessione non si aggancia a nessuna scheda finché il responsabile non la
 * corregge scegliendo l'abbonamento giusto.
 */
export type ClienteScelto =
  | {
      tipo: 'socio'
      personaId: string
      abbonamentoId: string
      nome: string
      cognome: string
      dataNascita: string | null
      abbonamenti: string[]
    }
  | {
      tipo: 'corporate'
      personaId: string
      abbonamentoId: string
      azienda: string
      tessera: string
      abbonamento: string
      nome: string
      cognome: string
    }
  | {
      tipo: 'azienda_manuale'
      azienda: string
      nome: string
      cognome: string
    }

/** Vero quando il cliente è un corporate e mancano i dati da scrivere a mano. */
export function mancaNomeScritto(cliente: ClienteScelto | null): boolean {
  if (!cliente || cliente.tipo === 'socio') return false
  if (!cliente.nome.trim() || !cliente.cognome.trim()) return true
  return cliente.tipo === 'azienda_manuale' && !cliente.azienda.trim()
}

/** "12/03/1985": la data di nascita (o di scadenza) come la si legge su un documento. */
export function dataNumerica(giorno: string | null | undefined): string {
  if (!giorno) return '—'
  const [anno, mese, g] = giorno.split('-')
  return `${g}/${mese}/${anno}`
}

/** Il giorno di Roma di un istante, come "15/10/2026": quando è stata registrata o confermata. */
export function dataDiIstante(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('it-IT', {
    timeZone: 'Europe/Rome',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

// ─────────────────────────────────────────────────────── data e ora

/**
 * Le ore che il modulo propone: dalle 7 alle 22. Il club apre prima e chiude
 * dopo, ma una sessione di personal fuori da questa fascia non si è mai
 * vista — e una griglia più lunga sul telefono si scorre invece di toccarla.
 */
export const ORE_SESSIONE = Array.from({ length: 16 }, (_, i) => String(7 + i).padStart(2, '0'))

/** I quarti d'ora: le sessioni cominciano all'ora o al quarto. */
export const MINUTI_SESSIONE = ['00', '15', '30', '45'] as const

/** Quanti giorni indietro il trainer può registrare una sessione dimenticata. */
export const GIORNI_INDIETRO = 7

/**
 * Fin dove si può registrare all'indietro: una settimana. La sessione si
 * registra di regola il giorno stesso; la settimana serve a chi se ne
 * dimentica, non a ricostruire un mese a memoria.
 */
export function primaDataRegistrabile(oggi: string): string {
  return giornoPiu(oggi, -GIORNI_INDIETRO)
}

/** Fin dove si può registrare in avanti: oggi. Una sessione si registra quando c'è, non prima. */
export function ultimaDataRegistrabile(oggi: string): string {
  return oggi
}

export function oraValida(ora: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(ora)) return false
  const [ore, minuti] = ora.split(':')
  return ORE_SESSIONE.includes(ore) && (MINUTI_SESSIONE as readonly string[]).includes(minuti)
}

/** Il primo problema di data e ora, o null se vanno bene. */
export function erroreDataOra(data: string, ora: string, oggi: string, limitato = true): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return 'Scegli il giorno della sessione.'
  if (!oraValida(ora)) return 'Scegli l’orario d’inizio.'
  if (limitato && data < primaDataRegistrabile(oggi)) {
    return `La data è troppo indietro: si registrano le sessioni degli ultimi ${GIORNI_INDIETRO} giorni.`
  }
  if (limitato && data > ultimaDataRegistrabile(oggi)) {
    return 'Non si registrano sessioni nei giorni futuri: al massimo quella di oggi.'
  }
  return null
}

// ─────────────────────────────────────────── quote dovute dal trainer
//
// Non sono compensi: è il trainer a versare a Ronchiverdi. Per ognuno
// l'amministrazione sceglie una di due formule, con il mese da cui vale:
//
//   - oraria: un importo per ogni sessione confermata (la sessione è
//     un'ora);
//   - flat: un canone fisso al mese, qualunque sia il numero di sessioni.

export const TIPI_QUOTA = ['oraria', 'flat'] as const
export type TipoQuota = (typeof TIPI_QUOTA)[number]

export const ETICHETTE_TIPO_QUOTA: Record<TipoQuota, string> = {
  oraria: 'Oraria (a sessione)',
  flat: 'Flat (canone mensile)',
}

export function eTipoQuota(valore: string | null | undefined): valore is TipoQuota {
  return (TIPI_QUOTA as readonly string[]).includes(valore ?? '')
}

export type QuotaTrainer = {
  trainer_email: string
  /** Sempre il primo di un mese: la formula cambia solo a mese intero. */
  valido_dal: string
  tipo: TipoQuota
  importo: number
}

/**
 * La quota in vigore per un trainer in un mese: la riga con il valido_dal
 * più recente non successivo al primo del mese. Null se non ce n'è ancora
 * una — e allora le sessioni si contano ma non c'è niente da incassare,
 * finché l'amministrazione non la imposta.
 */
export function quotaDelMese(
  quote: readonly QuotaTrainer[],
  trainerEmail: string,
  mese: string
): QuotaTrainer | null {
  let scelta: QuotaTrainer | null = null
  for (const q of quote) {
    if (q.trainer_email !== trainerEmail || q.valido_dal > mese) continue
    if (!scelta || q.valido_dal > scelta.valido_dal) scelta = q
  }
  return scelta
}

/** Quanto deve il trainer nel mese, con la quota data e le sessioni confermate. */
export function dovutoDelMese(quota: QuotaTrainer | null, sessioniConfermate: number): number {
  if (!quota) return 0
  const importo = Number(quota.importo)
  return quota.tipo === 'flat' ? importo : Math.round(importo * sessioniConfermate * 100) / 100
}

/** "€ 35,00": le quote si leggono al centesimo, non arrotondate all'euro. */
export function euroCentesimi(valore: number | null | undefined): string {
  if (valore == null || !Number.isFinite(valore)) return '—'
  return valore.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
}
