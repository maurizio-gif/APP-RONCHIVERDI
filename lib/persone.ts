// Anagrafica deduplicata: la stessa persona compila più form nel tempo e qui
// ha una riga sola. La deduplicazione la fa il database
// (trova_o_crea_persona, chiamata dal trigger su form_contatti): questo file
// contiene solo ciò che serve a mostrarla e cercarla.
//
// Nessun import server-only: usato sia dai Server Component sia dai client.

export type Persona = {
  id: string
  nome: string | null
  cognome: string | null
  email: string | null
  cellulare: string | null
  note: string | null
  richieste: number
  richieste_da_lavorare: number
  prima_richiesta: string | null
  ultima_richiesta: string | null
}

/**
 * Nome e cognome quando ci sono, altrimenti l'email o il cellulare: una
 * persona senza nome esiste — un form compilato in fretta — e deve restare
 * riconoscibile in elenco.
 */
export function nomePersona(p: {
  nome?: string | null
  cognome?: string | null
  email?: string | null
  cellulare?: string | null
}): string {
  const nome = `${p.nome ?? ''} ${p.cognome ?? ''}`.trim()
  return nome || p.email || p.cellulare || 'Senza nome'
}

/** Iniziali per il pallino in elenco. */
export function inizialiPersona(p: { nome?: string | null; cognome?: string | null; email?: string | null }): string {
  const n = (p.nome ?? '').trim()
  const c = (p.cognome ?? '').trim()
  if (n || c) return ((n[0] ?? '') + (c[0] ?? '')).toUpperCase()
  return (p.email ?? '?').slice(0, 2).toUpperCase()
}

/**
 * Testo su cui cerca l'elenco: nome, cognome, "nome cognome" insieme —
 * altrimenti cercando "mario rossi" non si troverebbe una riga con il nome e
 * il cognome in due campi separati — email e cellulare, tutto in minuscolo.
 */
export function testoRicerca(p: {
  nome?: string | null
  cognome?: string | null
  email?: string | null
  cellulare?: string | null
}): string {
  const pulito = (v: string | null | undefined) => (v ?? '').trim()
  const n = pulito(p.nome)
  const c = pulito(p.cognome)
  return [n, c, n && c ? `${n} ${c}` : '', pulito(p.email), pulito(p.cellulare)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function dataBreve(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function dataOra(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
