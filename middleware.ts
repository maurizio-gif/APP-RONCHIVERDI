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

// Gira su ogni richiesta a /dashboard/* e /api/interno/*: rinfresca il cookie
// di sessione Supabase e, se manca una sessione valida, rimanda a /login.
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

  // getClaims e non getUser: getUser è un'andata e ritorno verso Supabase Auth
  // su ogni richiesta del pannello — navigazioni, prefetch dei link e i due
  // polling ogni venti secondi — ed è il primo tempo che si paga prima che la
  // pagina cominci a caricare. getClaims verifica la firma del token in locale
  // con la chiave pubblica del progetto (JWKS, tenuta in memoria da auth-js per
  // dieci minuti); se il progetto firmasse ancora con il segreto simmetrico
  // (HS256) ricade da solo su getUser, quindi non è mai meno sicuro di prima.
  // Come getUser, rinfresca la sessione scaduta e riscrive i cookie via setAll.
  //
  // Cosa non vede più: un utente revocato lato Auth con un token ancora valido
  // (al massimo un'ora). Il controllo che conta per il pannello è comunque
  // staff_users, che il layout e le rotte interne verificano a ogni richiesta
  // — e che Gestione utenti, togliendo un accesso, invalida all'istante (vedi
  // invalidaRigheStaff in lib/auth/staff-server.ts).
  const { data } = await supabase.auth.getClaims()
  const email = typeof data?.claims?.email === 'string' ? data.claims.email : null

  if (!email) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  requestHeaders.set(HEADER_EMAIL, email.trim().toLowerCase())

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
  return response
}

export const config = {
  // /api/interno/* sta qui e non fuori per due ragioni, entrambe necessarie:
  // le rotte interrogate dal pannello (il conteggio dei messaggi non letti)
  // leggono l'operatore corrente da HEADER_EMAIL, che è il middleware a
  // scrivere; e senza passare da qui l'header non verrebbe ripulito, quindi
  // un client potrebbe impostarselo da sé e farsi passare per un altro
  // operatore. Le rotte pubbliche del pannello restano fuori da /api/interno.
  matcher: ['/dashboard/:path*', '/api/interno/:path*'],
}
