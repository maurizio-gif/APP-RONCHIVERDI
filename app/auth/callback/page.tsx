'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/browserClient'

// Punto d'arrivo del link nell'email di invito o di reset password. Supabase
// allega la sessione in due formati diversi a seconda della configurazione
// del progetto — hash con access_token/refresh_token, oppure query string con
// un "code" da scambiare — e li gestiamo entrambi invece di indovinare quale
// usa questo progetto.
export default function AuthCallbackPage() {
  const router = useRouter()
  const [errore, setErrore] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()

    async function completaAccesso() {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        if (error) {
          setErrore(error.message)
          return
        }
        router.replace('/imposta-password')
        return
      }

      const code = new URLSearchParams(window.location.search).get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          setErrore(error.message)
          return
        }
        router.replace('/imposta-password')
        return
      }

      setErrore('Link non valido o scaduto. Chiedi un nuovo invito alla segreteria.')
    }

    completaAccesso()
  }, [router])

  return (
    <main className="login-shell">
      <div className="login-card" style={{ textAlign: 'center' }}>
        {errore ? (
          <p className="error-banner">{errore}</p>
        ) : (
          <div className="spinner" style={{ margin: '0 auto' }} />
        )}
      </div>
    </main>
  )
}
