'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { CHIAVI_SEZIONI, SEZIONI, type SezioneChiave } from '@/lib/auth/sezioni'
import { emailCorrente } from '@/lib/auth/sezioni-server'
import { puoAmministrare } from '@/lib/auth/permessi'
import { registraLog } from '@/lib/audit'

// Risultato come valore di ritorno, non un throw: in produzione Next.js
// oscura sempre il messaggio di un errore lanciato da una Server Action,
// quindi l'unico modo di far arrivare un messaggio leggibile al client è
// restituirlo come dato normale.
type Risultato = { ok: true } | { ok: false; errore: string }

// Solo chi ha puo_invitare può invitare o cambiare i permessi altrui. Il
// controllo è qui lato server e non solo nascondendo i comandi nell'interfaccia:
// una Server Action resta chiamabile a mano, e nasconderla non è proteggerla.
async function chiamanteAmministra(): Promise<boolean> {
  return puoAmministrare(emailCorrente())
}

function urlErrore(messaggio: string): string {
  return `/dashboard/utenti?error=${encodeURIComponent(messaggio)}`
}

export async function invitaStaff(formData: FormData) {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  const nome = String(formData.get('nome') ?? '').trim()
  const cognome = String(formData.get('cognome') ?? '').trim()

  if (!email || !nome || !cognome) {
    redirect(urlErrore('Nome, cognome ed email sono obbligatori.'))
  }

  if (!(await chiamanteAmministra())) {
    redirect(urlErrore('Non hai il permesso di invitare nuovi utenti.'))
  }

  // Controllo esplicito invece di scoprirlo dal link nell'email: senza questa
  // variabile il redirectTo qui sotto diventa la stringa "undefined/auth/
  // callback", Supabase non la trova in nessuna allowlist e l'invito parte
  // comunque, ma con un link che porta al Site URL di fallback invece che al
  // pannello.
  if (!process.env.NEXT_PUBLIC_SITE_URL) {
    redirect(
      urlErrore(
        'NEXT_PUBLIC_SITE_URL non è configurata su Vercel (Environment Variables, ambiente Production): il link di invito sarebbe rotto. Impostala e riprova.'
      )
    )
  }

  const supabase = createSupabaseServiceClient()

  const { data: esistente } = await supabase
    .from('staff_users')
    .select('email')
    .eq('email', email)
    .maybeSingle()

  if (esistente) {
    // Utente già presente (invito precedente scaduto, o stiamo solo rimandando
    // l'email): aggiorna nome e cognome ma non toccare permessi e sezioni, che
    // potrebbero essere stati personalizzati dopo il primo invito.
    const { error } = await supabase.from('staff_users').update({ nome, cognome }).eq('email', email)
    if (error) redirect(urlErrore(error.message))
  } else {
    // Nuovo invitato: parte senza permessi amministrativi e con le sole
    // sezioni operative. Il contrario di TCA, dove per policy del club chi
    // viene invitato parte con tutto: qui il pannello nasce con l'anagrafica
    // già popolata di persone diverse, e allargare un permesso è un gesto
    // consapevole mentre restringerlo dopo è una correzione che si dimentica.
    const { error } = await supabase.from('staff_users').insert({
      email,
      nome,
      cognome,
      puo_invitare: false,
      puo_cancellare: false,
      sezioni_consentite: SEZIONI.filter((s) => s.gruppo !== 'Amministrazione').map((s) => s.chiave),
    })
    if (error) redirect(urlErrore(error.message))
  }

  // redirectTo esplicito: senza, Supabase usa il "Site URL" del progetto (di
  // default localhost:3000) e il link non arriva mai al pannello vero.
  // Richiede che NEXT_PUBLIC_SITE_URL sia anche fra i Redirect URLs in
  // Supabase Auth → URL Configuration, altrimenti viene ignorato comunque.
  const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
  })

  // Se l'utente Supabase Auth esiste già (per esempio era stato rimosso solo
  // dalla allowlist) l'invito fallisce con "già registrato": va bene così, ora
  // è di nuovo in staff_users e accede con la password che ha già.
  if (inviteError && !/already been registered|already exists/i.test(inviteError.message)) {
    redirect(urlErrore(inviteError.message))
  }

  await registraLog(emailCorrente(), 'utente_invitato', {
    entita: 'staff_users',
    entitaId: email,
    dettagli: { email_target: email, nome, cognome },
  })

  revalidatePath('/dashboard/utenti')
  redirect('/dashboard/utenti?ok=invito')
}

export async function impostaPuoInvitare(email: string, valore: boolean): Promise<Risultato> {
  if (!(await chiamanteAmministra())) {
    return { ok: false, errore: 'Non hai il permesso di modificare i permessi degli altri utenti.' }
  }

  // Un amministratore non può togliersi da solo il permesso di amministrare:
  // se è l'ultimo rimasto, il pannello resterebbe senza nessuno in grado di
  // invitare o cambiare permessi, e si recupererebbe solo da SQL.
  const chiamante = emailCorrente()
  if (!valore && chiamante === email) {
    return {
      ok: false,
      errore: 'Non puoi togliere a te stesso il permesso di amministrare: chiedilo a un altro amministratore.',
    }
  }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('staff_users')
    .update({ puo_invitare: valore })
    .eq('email', email)
  if (error) return { ok: false, errore: error.message }

  await registraLog(chiamante, 'permesso_invitare_modificato', {
    entita: 'staff_users',
    entitaId: email,
    dettagli: { email_target: email, valore },
  })

  revalidatePath('/dashboard/utenti')
  return { ok: true }
}

export async function impostaPuoCancellare(email: string, valore: boolean): Promise<Risultato> {
  if (!(await chiamanteAmministra())) {
    return { ok: false, errore: 'Non hai il permesso di modificare i permessi degli altri utenti.' }
  }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('staff_users')
    .update({ puo_cancellare: valore })
    .eq('email', email)
  if (error) return { ok: false, errore: error.message }

  await registraLog(emailCorrente(), 'permesso_cancellare_modificato', {
    entita: 'staff_users',
    entitaId: email,
    dettagli: { email_target: email, valore },
  })

  revalidatePath('/dashboard/utenti')
  return { ok: true }
}

export async function impostaSezioni(email: string, sezioni: string[]): Promise<Risultato> {
  if (!(await chiamanteAmministra())) {
    return { ok: false, errore: 'Non hai il permesso di modificare le sezioni degli altri utenti.' }
  }

  // Filtra sulle chiavi esistenti: la lista arriva dal client, e una chiave
  // inventata resterebbe in tabella per sempre a sporcare i permessi.
  const pulite = sezioni.filter((s): s is SezioneChiave =>
    (CHIAVI_SEZIONI as readonly string[]).includes(s)
  )

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('staff_users')
    .update({ sezioni_consentite: pulite })
    .eq('email', email)
  if (error) return { ok: false, errore: error.message }

  await registraLog(emailCorrente(), 'sezioni_modificate', {
    entita: 'staff_users',
    entitaId: email,
    dettagli: { email_target: email, sezioni: pulite },
  })

  revalidatePath('/dashboard/utenti')
  return { ok: true }
}

export async function rimuoviStaff(email: string): Promise<Risultato> {
  if (!(await chiamanteAmministra())) {
    return { ok: false, errore: 'Non hai il permesso di rimuovere utenti.' }
  }

  const chiamante = emailCorrente()
  if (chiamante === email) {
    return { ok: false, errore: 'Non puoi rimuovere il tuo stesso accesso.' }
  }

  // Toglie l'accesso al pannello ma non cancella l'utente da Supabase Auth:
  // reinvitarlo lo rimette dentro con la password che ha già, e il suo storico
  // nel controllo operatori resta leggibile (audit_log conserva l'email).
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('staff_users').delete().eq('email', email)
  if (error) return { ok: false, errore: error.message }

  await registraLog(chiamante, 'utente_rimosso', {
    entita: 'staff_users',
    entitaId: email,
    dettagli: { email_target: email },
  })

  revalidatePath('/dashboard/utenti')
  return { ok: true }
}
