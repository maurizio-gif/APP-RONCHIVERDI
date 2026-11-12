import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { leggiPaginato } from '@/lib/supabase/leggiPaginato'
import { inviaEmail } from '@/lib/email'
import { emailCorrente } from '@/lib/auth/sezioni-server'
import {
  COLONNE_SEGNALAZIONE,
  ETICHETTE_URGENZA,
  SEZIONE_MANUTENZIONE,
  SEZIONE_SEGNALAZIONI,
  quando,
  type Segnalazione,
  type Voce,
} from '@/lib/segnalazioni'

// Le letture che toccano il database. Server-only: service role key, e le
// tabelle hanno RLS senza policy.

export type Elenchi = {
  settori: (Voce & { responsabile_email: string | null })[]
  motivi: Voce[]
}

export async function leggiElenchi(): Promise<Elenchi> {
  const supabase = createSupabaseServiceClient()
  const [{ data: settori }, { data: motivi }] = await Promise.all([
    supabase.from('segnalazioni_settori').select('chiave, nome, responsabile_email').eq('attivo', true),
    supabase.from('segnalazioni_motivi').select('chiave, nome').eq('attivo', true),
  ])
  return {
    settori: inOrdineAlfabetico((settori ?? []) as Elenchi['settori']),
    motivi: inOrdineAlfabetico((motivi ?? []) as Voce[]),
  }
}

const CONFRONTO = new Intl.Collator('it', { sensitivity: 'base', numeric: true })

// Alfabetico per nome, con «Altro» sempre in fondo: nelle tendine del form si
// cerca per lettera, e «Altro» è l'ultima spiaggia, non una voce come le
// altre. Si ordina qui e non nella query: l'ordine del database dipende dalla
// sua collazione, che non tratta bene accenti e maiuscole.
function inOrdineAlfabetico<T extends Voce>(voci: T[]): T[] {
  return [...voci].sort((a, b) => {
    if (a.chiave === 'altro') return 1
    if (b.chiave === 'altro') return -1
    return CONFRONTO.compare(a.nome, b.nome)
  })
}

// Anche le voci disattivate: servono a leggere le segnalazioni vecchie.
export async function nomiElenchi(): Promise<{ settori: Map<string, string>; motivi: Map<string, string> }> {
  const supabase = createSupabaseServiceClient()
  const [{ data: settori }, { data: motivi }] = await Promise.all([
    supabase.from('segnalazioni_settori').select('chiave, nome'),
    supabase.from('segnalazioni_motivi').select('chiave, nome'),
  ])
  return {
    settori: new Map(((settori ?? []) as Voce[]).map((v) => [v.chiave, v.nome])),
    motivi: new Map(((motivi ?? []) as Voce[]).map((v) => [v.chiave, v.nome])),
  }
}

// Chi può lavorare le segnalazioni, col nome da mostrare: la tendina
// dell'assegnazione e i nomi nelle liste.
export async function operatoriSegnalazioni(): Promise<{ email: string; nome: string }[]> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('staff_users')
    .select('email, nome, cognome')
    .contains('sezioni_consentite', [SEZIONE_SEGNALAZIONI])
    .order('nome')
  return ((data ?? []) as { email: string; nome: string | null; cognome: string | null }[]).map((r) => ({
    email: r.email,
    nome: `${r.nome ?? ''} ${r.cognome ?? ''}`.trim() || r.email,
  }))
}

// I manutentori: chi ha la vista Manutenzione. A loro si assegna un intervento.
export async function operatoriManutenzione(): Promise<{ email: string; nome: string }[]> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('staff_users')
    .select('email, nome, cognome')
    .contains('sezioni_consentite', [SEZIONE_MANUTENZIONE])
    .order('nome')
  return ((data ?? []) as { email: string; nome: string | null; cognome: string | null }[]).map((r) => ({
    email: r.email,
    nome: `${r.nome ?? ''} ${r.cognome ?? ''}`.trim() || r.email,
  }))
}

// Chi riceve le nuove richieste di manutenzione (segnalazioni_impostazioni);
// null finché non è impostato: le richieste si vedono comunque in Manutenzione.
export async function responsabileManutenzione(): Promise<string | null> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('segnalazioni_impostazioni')
    .select('valore')
    .eq('chiave', 'responsabile_manutenzione')
    .maybeSingle()
  return ((data?.valore as string | null | undefined) ?? '').trim().toLowerCase() || null
}

// Nome e cognome per email, anche di chi non ha più la sezione: la storia
// delle segnalazioni dice chi ha fatto cosa.
export async function nomiStaff(): Promise<Map<string, string>> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase.from('staff_users').select('email, nome, cognome')
  const m = new Map<string, string>()
  for (const r of (data ?? []) as { email: string; nome: string | null; cognome: string | null }[]) {
    m.set(r.email, `${r.nome ?? ''} ${r.cognome ?? ''}`.trim() || r.email)
  }
  return m
}

export async function leggiSegnalazione(id: string): Promise<Segnalazione | null> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase.from('segnalazioni').select(COLONNE_SEGNALAZIONE).eq('id', id).maybeSingle()
  return (data as Segnalazione | null) ?? null
}

// Tutte le segnalazioni, dalla più recente: a poche centinaia l'anno si
// leggono intere e i filtri si fanno in pagina.
export async function leggiSegnalazioni(dal?: string): Promise<Segnalazione[]> {
  const supabase = createSupabaseServiceClient()
  const { righe, error } = await leggiPaginato<Segnalazione>((da) => {
    let q = supabase.from('segnalazioni').select(COLONNE_SEGNALAZIONE).order('ricevuta_il', { ascending: false })
    if (dal) q = q.gte('ricevuta_il', dal)
    return q.range(da, da + 999)
  })
  if (error) console.error('Segnalazioni non lette:', error.message)
  return righe
}

export function utente(): string | null {
  return emailCorrente()
}

// ── email al responsabile ───────────────────────────────────────────────────

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Avvisa chi deve prendere in mano una segnalazione: nuova nel suo settore o
// assegnata da un collega. Dice cosa è successo e porta nel CRM.
export async function avvisaAssegnatario(
  s: Segnalazione,
  a: string,
  dettagli: { settore: string; motivo: string; chi: string; assegnata: boolean }
) {
  const manutenzione = s.urgenza === 'manutenzione'
  const sito = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://crm.ronchiverdi.it'
  const link = `${sito}/dashboard/segnalazioni/${s.id}`
  const cosa = manutenzione ? 'Richiesta di manutenzione' : 'Segnalazione'
  const oggetto = `${dettagli.assegnata ? `${cosa} assegnata a te` : manutenzione ? 'Nuova richiesta di manutenzione' : 'Nuova segnalazione'} #${s.numero}: ${dettagli.settore}`
  const intro = dettagli.assegnata
    ? `${dettagli.chi} ti ha assegnato ${manutenzione ? 'una richiesta di manutenzione' : 'una segnalazione'}.`
    : manutenzione
      ? `${dettagli.chi} ha inviato una richiesta di manutenzione.`
      : `${dettagli.chi} ha registrato una segnalazione nel tuo settore.`
  const righe: [string, string][] = [
    ['Settore', dettagli.settore],
    ['Motivo', dettagli.motivo],
    ['Tipologia', ETICHETTE_URGENZA[s.urgenza]],
    ['Urgenza', `${s.livello_urgenza} su 5`],
    ['Da prendere in carico entro', quando(s.scadenza_presa_il)],
  ]
  if (s.socio_nome && !manutenzione) righe.push(['Socio', s.socio_nome])
  const descrizione = s.descrizione.length > 1200 ? `${s.descrizione.slice(0, 1200)}…` : s.descrizione

  const html = `<!doctype html><html lang="it"><body style="margin:0;padding:24px 12px;background:#f7f6f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1c18;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;background:#ffffff;border:1px solid rgba(0,0,0,0.12);border-radius:14px;"><tr><td style="padding:28px 32px;">
<p style="margin:0 0 18px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#8b6c14;">CRM Ronchiverdi · Segnalazione #${s.numero}</p>
<p style="margin:0 0 14px;font-size:16px;line-height:1.6;">${esc(intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;font-size:14px;line-height:1.7;">
${righe.map(([k, v]) => `<tr><td style="padding-right:14px;color:#6b6a60;">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}
</table>
<p style="margin:0 0 20px;padding:12px 14px;background:#f7f6f2;border-radius:8px;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(descrizione)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#1c1c18;border-radius:999px;"><a href="${esc(link)}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">Apri nel CRM</a></td></tr></table>
</td></tr></table></td></tr></table></body></html>`

  const testo = `${intro}

${righe.map(([k, v]) => `${k}: ${v}`).join('\n')}

${descrizione}

Apri nel CRM: ${link}`

  return inviaEmail({
    a,
    oggetto,
    html,
    testo,
    automazione: manutenzione
      ? dettagli.assegnata
        ? 'Manutenzione: assegnata'
        : 'Manutenzione: nuova richiesta'
      : dettagli.assegnata
        ? 'Segnalazione: assegnata'
        : 'Segnalazione: nuova',
    inviataDa: emailCorrente(),
  })
}
