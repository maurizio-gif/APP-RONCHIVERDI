'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/serverClient'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { registraLog } from '@/lib/audit'

export async function impostaPassword(formData: FormData) {
  const nome = String(formData.get('nome') ?? '').trim()
  const cognome = String(formData.get('cognome') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const conferma = String(formData.get('conferma') ?? '')

  if (!nome || !cognome) {
    redirect(`/imposta-password?error=${encodeURIComponent('Nome e cognome sono obbligatori.')}`)
  }
  if (password.length < 8) {
    redirect(
      `/imposta-password?error=${encodeURIComponent('La password deve avere almeno 8 caratteri.')}`
    )
  }
  if (password !== conferma) {
    redirect(`/imposta-password?error=${encodeURIComponent('Le due password non coincidono.')}`)
  }

  const supabase = createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    redirect('/login')
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    redirect(`/imposta-password?error=${encodeURIComponent(error.message)}`)
  }

  // Nome e cognome vivono in staff_users, non nei metadata di Supabase Auth:
  // è la tabella che Gestione utenti mostra e modifica.
  const supabaseService = createSupabaseServiceClient()
  await supabaseService.from('staff_users').update({ nome, cognome }).eq('email', user.email)

  await registraLog(user.email, 'password_impostata')
  redirect('/dashboard')
}
