import Link from 'next/link'
import { redirect } from 'next/navigation'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { SEZIONE_SEGNALAZIONI } from '@/lib/segnalazioni'
import { leggiElenchi } from '@/lib/segnalazioni-server'
import { NuovaSegnalazione } from './NuovaSegnalazione'

export const dynamic = 'force-dynamic'

// Registrare una segnalazione di un socio: pensato per la reception nei
// momenti di punta (le 18-19), con poche scelte obbligatorie e niente da
// scrivere se non cosa è successo.
export default async function NuovaSegnalazionePage() {
  if (!(await utenteHaSezione(SEZIONE_SEGNALAZIONI))) redirect('/dashboard')
  const { settori, motivi } = await leggiElenchi()

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">
          <Link href="/dashboard/segnalazioni">← Segnalazioni soci</Link>
        </p>
        <h1>Nuova segnalazione</h1>
        <p className="muted">Una lamentela o un disservizio riferito da un socio. Servono dove, cosa e cosa è successo.</p>
      </div>
      <NuovaSegnalazione settori={settori} motivi={motivi} />
    </>
  )
}
