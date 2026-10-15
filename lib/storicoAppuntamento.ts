import { dataBreve, dataOra, normalizzaOra } from '@/lib/agenda'
import { nomeDiEmail } from '@/lib/staff'

// Lo storico di un appuntamento preso dal sito: ogni spostamento e
// l'annullamento, scritti dal trigger form_contatti_storico_appuntamento
// (scripts/sql/2026-10-15-storico-appuntamento.sql) nella colonna
// form_contatti.storico_appuntamento.
//
// Prima uno spostamento sovrascriveva giorno e ora, e un appuntamento
// annullato e riprenotato tre volte si leggeva come uno solo, preso così fin
// dall'inizio. Qui si legge quella colonna e la si trasforma in frasi.
//
// Nessun import server-only: lo usano i componenti client.

export type VoceStoricoAppuntamento = {
  azione: 'spostato' | 'fissato' | 'annullato'
  /** Quando è successo, in ISO. */
  il: string
  /** 'cliente' dal link nell'email, l'email dell'operatore dal CRM, null se non detto. */
  chi: string | null
  da: { data: string | null; ora: string | null } | null
  a: { data: string | null; ora: string | null } | null
}

/** Lo storico com'è sul database, già controllato: le voci che non si capiscono si saltano. */
export function vociStorico(valore: unknown): VoceStoricoAppuntamento[] {
  if (!Array.isArray(valore)) return []
  return valore.flatMap((v): VoceStoricoAppuntamento[] => {
    if (!v || typeof v !== 'object') return []
    const r = v as Record<string, any>
    if (r.azione !== 'spostato' && r.azione !== 'fissato' && r.azione !== 'annullato') return []
    if (typeof r.il !== 'string') return []
    return [
      {
        azione: r.azione,
        il: r.il,
        chi: typeof r.chi === 'string' ? r.chi : null,
        da: r.da && typeof r.da === 'object' ? { data: r.da.data ?? null, ora: r.da.ora ?? null } : null,
        a: r.a && typeof r.a === 'object' ? { data: r.a.data ?? null, ora: r.a.ora ?? null } : null,
      },
    ]
  })
}

function quando(m: { data: string | null; ora: string | null } | null): string {
  if (!m?.data) return 'senza giorno'
  const ora = normalizzaOra(m.ora)
  return `${dataBreve(String(m.data).slice(0, 10))}${ora ? ` alle ${ora}` : ''}`
}

function daChi(chi: string | null, nomi?: Record<string, string>): string {
  if (chi === 'cliente') return 'dal cliente'
  if (chi) return `da ${nomeDiEmail(chi, nomi)}`
  return ''
}

/**
 * «Spostato dal cliente: da gio 9 ott alle 16:00 a ven 10 ott alle 11:30»,
 * «Annullato dal cliente (era gio 9 ott alle 16:00)».
 */
export function fraseStorico(voce: VoceStoricoAppuntamento, nomi?: Record<string, string>): string {
  const chi = daChi(voce.chi, nomi)
  const spazio = chi ? ` ${chi}` : ''
  if (voce.azione === 'annullato') return `Annullato${spazio} (era ${quando(voce.da)})`
  if (voce.azione === 'fissato') return `Fissato${spazio} per ${quando(voce.a)}`
  return `Spostato${spazio}: da ${quando(voce.da)} a ${quando(voce.a)}`
}

/** Quando è successo, come si legge accanto alla frase. */
export function quandoStorico(voce: VoceStoricoAppuntamento): string {
  return dataOra(voce.il)
}

/** Quante volte è stato spostato: il numero che va sulla riga chiusa. */
export function quanteVolteSpostato(voci: VoceStoricoAppuntamento[]): number {
  return voci.filter((v) => v.azione === 'spostato').length
}
