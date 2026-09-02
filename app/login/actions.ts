'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/serverClient'
import { isStaffEmail } from '@/lib/auth/allowlist'
import { registraLog } from '@/lib/audit'

export async function login(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  // Prima l'allowlist: un utente Supabase Auth che non è in staff_users non
  // deve nemmeno arrivare a provare la password.
  if (!(await isStaffEmail(email))) {
    await registraLog(email, 'login_fallito', { dettagli: { motivo: 'email non autorizzata' } })
    redirect('/login?error=non-autorizzato')
  }

  const supabase = createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    await registraLog(email, 'login_fallito', { dettagli: { motivo: 'credenziali errate' } })
    redirect('/login?error=credenziali')
  }

  await registraLog(email, 'login')
  redirect('/dashboard')
}

export async function logout() {
  const supabase = createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  await registraLog(user?.email, 'logout')
  await supabase.auth.signOut()
  redirect('/login')
}
