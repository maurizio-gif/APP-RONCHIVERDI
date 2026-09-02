'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logout } from '@/app/login/actions'
import { SEZIONI } from '@/lib/auth/sezioni'

type VoceMenu = {
  href: string
  label: string
  chiave: string
  gruppo?: string
  inArrivo?: boolean
}

// Le voci sono raggruppate per "gruppo" (vedi lib/auth/sezioni.ts): una voce
// senza gruppo esplicito finisce in cima, senza altre modifiche qui.
function raggruppaVoci(voci: VoceMenu[]) {
  const gruppi = new Map<string, VoceMenu[]>()
  const ordine: string[] = []

  for (const voce of voci) {
    const chiaveGruppo = voce.gruppo ?? ''
    if (!gruppi.has(chiaveGruppo)) {
      gruppi.set(chiaveGruppo, [])
      ordine.push(chiaveGruppo)
    }
    gruppi.get(chiaveGruppo)!.push(voce)
  }

  return ordine.map((chiave) => ({ chiave, voci: gruppi.get(chiave)! }))
}

function iniziali(nomeUtente: string | null, email: string): string {
  if (nomeUtente) {
    const parti = nomeUtente.split(/\s+/).filter(Boolean)
    return (parti[0]?.[0] ?? '').concat(parti[1]?.[0] ?? '').toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

export function Sidebar({
  email,
  nomeUtente,
  sezioniConsentite,
}: {
  email: string
  nomeUtente: string | null
  sezioniConsentite: string[]
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // Il Riepilogo è visibile a chiunque sia autenticato e non fa parte delle
  // sezioni assegnabili per utente.
  const navItems: VoceMenu[] = [
    { href: '/dashboard', label: 'Riepilogo', chiave: 'riepilogo' },
    ...SEZIONI.filter((s) => sezioniConsentite.includes(s.chiave)),
  ]
  const gruppiMenu = raggruppaVoci(navItems)

  // Chiude il menu mobile a ogni cambio pagina: resterebbe aperto sopra il
  // contenuto della sezione appena raggiunta.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <aside className={`sidebar${open ? ' is-open' : ''}`}>
      <div className="sidebar-brand">
        <img src="/logo-ronchiverdi-sport.png" alt="Ronchiverdi" className="brand-logo" />
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? 'Chiudi' : 'Menu'}
        </button>
        <div className="user-row">
          <span className="user-badge" aria-hidden="true">
            {iniziali(nomeUtente, email)}
          </span>
          <span className="user-meta">
            {nomeUtente && <span className="user-name">{nomeUtente}</span>}
            <span className="user-email">{email}</span>
          </span>
        </div>
      </div>

      <nav className="nav">
        {gruppiMenu.map((gruppo) => (
          <div className="nav-gruppo" key={gruppo.chiave || 'principale'}>
            {gruppo.chiave && <p className="nav-gruppo-label">{gruppo.chiave}</p>}
            {gruppo.voci.map((voce) =>
              voce.inArrivo ? (
                // Modulo non ancora costruito: la voce si vede — così chi ha
                // il permesso sa che gli spetta — ma non è un link.
                <span className="nav-item is-in-arrivo" key={voce.chiave}>
                  {voce.label}
                  <span className="nav-tag">in arrivo</span>
                </span>
              ) : (
                <Link
                  href={voce.href}
                  key={voce.chiave}
                  className={`nav-item${pathname === voce.href ? ' is-active' : ''}`}
                >
                  {voce.label}
                </Link>
              )
            )}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <form action={logout}>
          <button type="submit" className="btn btn-ghost btn-block btn-sm">
            Esci
          </button>
        </form>
      </div>
    </aside>
  )
}
