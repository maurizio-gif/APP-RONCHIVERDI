'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logout } from '@/app/login/actions'
import { SEZIONI, soloAccessoEsterno } from '@/lib/auth/sezioni'
import { SEZIONE_NOTIFICHE } from '@/lib/notifiche'
import { IconaMenu } from './IconeMenu'
import { useNotifiche } from './NotificheProvider'
import { PushToggleNavItem } from './PushToggleNavItem'
import { CampanelloToggle } from './CampanelloToggle'
import { TemaToggle } from './TemaToggle'

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
  riceveAvvisoSonoro,
}: {
  email: string
  nomeUtente: string | null
  sezioniConsentite: string[]
  riceveAvvisoSonoro: boolean
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  // Il conteggio arriva dallo stesso stato che alimenta l'avviso in evidenza,
  // così confermare la lettura da là aggiorna subito anche il badge qui.
  const { nonLette } = useNotifiche()

  // La Dashboard è visibile a chiunque sia autenticato e non fa parte delle
  // sezioni assegnabili per utente. Sta nel gruppo Core con le altre due voci
  // che si usano tutti i giorni.
  //
  // L'eccezione e' l'account di un partner esterno: il Riepilogo gli
  // rimanderebbe alla sua unica pagina (vedi app/dashboard/page.tsx), e una
  // voce di menu che gira a vuoto e' solo un invito a chiedersi cosa ci sia
  // dietro.
  const soloEsterno = soloAccessoEsterno(sezioniConsentite)
  const navItems: VoceMenu[] = [
    ...(soloEsterno
      ? []
      : [{ href: '/dashboard', label: 'Dashboard', chiave: 'dashboard', gruppo: 'Core' }]),
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
        {/* I tre interruttori del dispositivo stanno in cima e non nel piede:
            si toccano una volta sola per dispositivo, ma si toccano il primo
            giorno — e in fondo a un menu di quindici voci il primo giorno non
            li trova nessuno. Le push da sole su una riga, campanello e tema
            affiancati: le prime riguardano il telefono a pannello chiuso, gli
            altri due come si vede e come suona questo schermo adesso. */}
        {sezioniConsentite.includes(SEZIONE_NOTIFICHE) && <PushToggleNavItem />}
        <div className="riga-strumenti">
          {/* Il campanello solo a chi qualcosa può sentirlo: l'avviso suona
              per le trattative da prendere in carico, e un interruttore che
              governa un suono che non arriverà mai è una domanda senza
              risposta. */}
          {riceveAvvisoSonoro && <CampanelloToggle />}
          <TemaToggle />
        </div>
        {gruppiMenu.map((gruppo) => (
          <div className="nav-gruppo" key={gruppo.chiave || 'principale'}>
            {gruppo.chiave && <p className="nav-gruppo-label">{gruppo.chiave}</p>}
            {gruppo.voci.map((voce) =>
              voce.inArrivo ? (
                // Modulo non ancora costruito: la voce si vede — così chi ha
                // il permesso sa che gli spetta — ma non è un link.
                <span className="nav-item is-in-arrivo" key={voce.chiave}>
                  <IconaMenu chiave={voce.chiave} />
                  {voce.label}
                  <span className="nav-tag">in arrivo</span>
                </span>
              ) : (
                <Link
                  href={voce.href}
                  key={voce.chiave}
                  className={`nav-item${pathname === voce.href ? ' is-active' : ''}`}
                >
                  <IconaMenu chiave={voce.chiave} />
                  {voce.label}
                  {voce.chiave === SEZIONE_NOTIFICHE && nonLette > 0 && (
                    <span className="nav-badge" aria-label={`${nonLette} da confermare`}>
                      {nonLette}
                    </span>
                  )}
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
