import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Deve restare identico a HEADER_EMAIL in lib/auth/sezioni.ts, che è il lato
// che lo legge. È scritto due volte invece di importarlo di proposito: il
// middleware gira sull'Edge runtime, dove il grafo dei moduli è ristretto, e
// Vercel rifiuta il bundle di un'Edge Function che referenzia un modulo
// locale ("The Edge Function middleware is referencing unsupported modules").
// La build passa comunque, il deploy no: il prezzo di tenerlo in un solo
// posto sarebbe un deploy rotto.
const HEADER_EMAIL = 'x-rv-user-email'

// Gira su ogni richiesta a /dashboard/*: rinfresca il cookie di sessione
// Supabase e, se manca una sessione valida, rimanda a /login.
//
// L'email già validata qui viene propagata al layout via header di richiesta:
// così il layout non deve richiamare getUser() — un altro round-trip a
// Supabase Auth — su ogni singola pagina del pannello. L'header viene sempre
// sovrascritto qui sotto con il valore validato, quindi un client che
// provasse a impostarlo da sé non otterrebbe nulla.
export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete(HEADER_EMAIL)

  const pendingCookies: { name: string; value: string; options: CookieOptions }[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          pendingCookies.push(...cookiesToSet)
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  requestHeaders.set(HEADER_EMAIL, user.email.trim().toLowerCase())

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
  return response
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
