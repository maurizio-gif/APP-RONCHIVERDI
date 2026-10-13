'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/serverClient'
import { isStaffEmail } from '@/lib/auth/allowlist'
import { registraLog } from '@/lib/audit'
import { dettagliOrigine, origineRichiesta, segnalaAccessoInusuale } from '@/lib/auth/origine'

export async function login(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const origine = dettagliOrigine(origineRichiesta())

  // Prima l'allowlist: un utente Supabase Auth che non è in staff_users non
  // deve nemmeno arrivare a provare la password.
  //
  // Il controllo sta fuori dal try/catch che segue perché redirect() funziona
  // lanciando: chiamarlo dentro un catch lo intercetterebbe come se fosse un
  // guasto.
  let autorizzata: boolean
  try {
    autorizzata = await isStaffEmail(email)
  } catch (e) {
    console.error('login: allowlist non verificabile', e)
    await registraLog(email, 'login_fallito', {
      dettagli: { motivo: 'controllo allowlist non riuscito', ...origine },
    })
    redirect('/login?error=servizio')
  }

  if (!autorizzata) {
    await registraLog(email, 'login_fallito', {
      dettagli: { motivo: 'email non autorizzata', ...origine },
    })
    redirect('/login?error=non-autorizzato')
  }

  const supabase = createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    await registraLog(email, 'login_fallito', {
      dettagli: { motivo: 'credenziali errate', ...origine },
    })
    redirect('/login?error=credenziali')
  }

  // Prima del confronto con gli accessi passati, che non deve includere questo.
  await segnalaAccessoInusuale(email, origineRichiesta())
  await registraLog(email, 'login', { dettagli: origine })
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

// Uscita automatica dopo un periodo senza attività (vedi
// app/dashboard/LogoutInattivita.tsx): stessa uscita di logout, ma nel
// registro si distingue e il login spiega perché si è tornati lì.
export async function logoutPerInattivita() {
  const supabase = createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  await registraLog(user?.email, 'logout_inattivita')
  await supabase.auth.signOut()
  redirect('/login?error=inattivita')
}
