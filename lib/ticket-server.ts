import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente } from '@/lib/auth/sezioni-server'
import { inviaEmail } from '@/lib/email'
import { SEZIONI } from '@/lib/auth/sezioni'
import { COLONNE_TICKET, type Ticket } from '@/lib/ticket'

// Le letture e le regole dei ticket che toccano il database. Server-only:
// service role key, e le tabelle hanno RLS senza policy.

export type Ruolo = { email: string; livello: 1 | 2 | null }

// Chi gestisce e a che livello sta in ticket_gestori: si cambia lì, senza
// toccare il codice. Chi non c'è è un utente che apre ticket.
export async function ruoloCorrente(): Promise<Ruolo | null> {
  const email = emailCorrente()
  if (!email) return null
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('ticket_gestori')
    .select('livello')
    .eq('email', email)
    .eq('attivo', true)
    .maybeSingle()
  return { email, livello: (data?.livello as 1 | 2 | undefined) ?? null }
}

export async function gestoreDiLivello(livello: 1 | 2): Promise<string | null> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('ticket_gestori')
    .select('email')
    .eq('livello', livello)
    .eq('attivo', true)
    .order('email')
    .limit(1)
    .maybeSingle()
  return (data?.email as string | undefined) ?? null
}

// Un ticket lo vede chi l'ha aperto e chi gestisce (tutti i livelli: il
// secondo livello controlla tutto il flusso, il primo ne è il punto d'ingresso).
export function puoVedere(t: Pick<Ticket, 'aperto_da'>, ruolo: Ruolo): boolean {
  return ruolo.livello !== null || t.aperto_da === ruolo.email
}

export async function leggiTicket(id: string): Promise<Ticket | null> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase.from('ticket').select(COLONNE_TICKET).eq('id', id).maybeSingle()
  return (data as Ticket | null) ?? null
}

// Nome e cognome dello staff per email: i ticket li scrive gente diversa e
// in pagina si legge «Simone Aggazio», non un indirizzo.
export async function nomiStaff(): Promise<Map<string, string>> {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase.from('staff_users').select('email, nome, cognome')
  const m = new Map<string, string>()
  for (const r of (data ?? []) as { email: string; nome: string | null; cognome: string | null }[]) {
    m.set(r.email, `${r.nome ?? ''} ${r.cognome ?? ''}`.trim() || r.email)
  }
  return m
}

export function etichettaSezione(chiave: string | null): string {
  if (!chiave) return 'In generale'
  return SEZIONI.find((s) => s.chiave === chiave)?.label ?? chiave
}

// ── il segnale «da leggere» ─────────────────────────────────────────────────

export type StatoTicketUtente = {
  daLeggere: number
  // Il primo ticket da leggere, per il link dell'avviso.
  primo: { id: string; numero: number; titolo: string; motivo: string } | null
}

// Nessun argomento: il browser non può chiedere i ticket di un altro.
export async function statoTicketCorrente(): Promise<StatoTicketUtente> {
  const email = emailCorrente()
  if (!email) return { daLeggere: 0, primo: null }
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('ticket_da_leggere')
    .select('ticket_id, motivo, dal, ticket(numero, titolo)')
    .eq('email', email)
    .order('dal', { ascending: true })
    .limit(20)
  const righe = (data ?? []) as unknown as {
    ticket_id: string
    motivo: string
    ticket: { numero: number; titolo: string } | null
  }[]
  const p = righe[0]
  return {
    daLeggere: righe.length,
    primo: p ? { id: p.ticket_id, numero: p.ticket?.numero ?? 0, titolo: p.ticket?.titolo ?? '', motivo: p.motivo } : null,
  }
}

export async function segnalaDaLeggere(ticketId: string, email: string, motivo: string) {
  const supabase = createSupabaseServiceClient()
  await supabase
    .from('ticket_da_leggere')
    .upsert({ ticket_id: ticketId, email, motivo, dal: new Date().toISOString() }, { onConflict: 'ticket_id,email' })
}

export async function togliDaLeggere(ticketId: string, email: string) {
  const supabase = createSupabaseServiceClient()
  await supabase.from('ticket_da_leggere').delete().eq('ticket_id', ticketId).eq('email', email)
}

// ── email ai gestori ────────────────────────────────────────────────────────

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// La mail a chi deve prendere in mano il ticket: apertura (primo livello) o
// passaggio al secondo livello. Il ticket si legge e si gestisce nel CRM: la
// mail dice cosa è arrivato e porta lì.
export async function avvisaGestore(
  t: Ticket,
  a: string,
  motivo: 'nuovo' | 'escalation',
  dettagli: { chi: string; nota?: string | null }
) {
  const sito = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://crm.ronchiverdi.it'
  const link = `${sito}/dashboard/ticket/${t.id}`
  const oggetto =
    motivo === 'nuovo'
      ? `Nuovo ticket #${t.numero}: ${t.titolo}`
      : `Ticket #${t.numero} passato a te: ${t.titolo}`
  const intro =
    motivo === 'nuovo'
      ? `${dettagli.chi} ha aperto un ticket di assistenza.`
      : `${dettagli.chi} ti ha passato un ticket al secondo livello.`
  const righe: [string, string][] = [
    ['Sezione', etichettaSezione(t.sezione)],
    ['Aperto da', t.aperto_da],
    ['Titolo', t.titolo],
  ]
  const descrizione = t.descrizione.length > 1200 ? `${t.descrizione.slice(0, 1200)}…` : t.descrizione

  const html = `<!doctype html><html lang="it"><body style="margin:0;padding:24px 12px;background:#f7f6f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1c18;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;background:#ffffff;border:1px solid rgba(0,0,0,0.12);border-radius:14px;"><tr><td style="padding:28px 32px;">
<p style="margin:0 0 18px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#8b6c14;">CRM Ronchiverdi · Ticket #${t.numero}</p>
<p style="margin:0 0 14px;font-size:16px;line-height:1.6;">${esc(intro)}</p>
${dettagli.nota ? `<p style="margin:0 0 14px;padding:12px 14px;background:#f7f2e1;border-left:3px solid #8b6c14;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(dettagli.nota)}</p>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;font-size:14px;line-height:1.7;">
${righe.map(([k, v]) => `<tr><td style="padding-right:14px;color:#6b6a60;">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}
</table>
<p style="margin:0 0 20px;padding:12px 14px;background:#f7f6f2;border-radius:8px;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(descrizione)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#1c1c18;border-radius:999px;"><a href="${esc(link)}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">Apri il ticket nel CRM</a></td></tr></table>
</td></tr></table></td></tr></table></body></html>`

  const testo = `${intro}
${dettagli.nota ? `\n${dettagli.nota}\n` : ''}
${righe.map(([k, v]) => `${k}: ${v}`).join('\n')}

${descrizione}

Apri il ticket nel CRM: ${link}`

  return inviaEmail({
    a,
    oggetto,
    html,
    testo,
    automazione: motivo === 'nuovo' ? 'Ticket: nuovo' : 'Ticket: secondo livello',
    inviataDa: emailCorrente(),
  })
}
