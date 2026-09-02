import { redirect } from 'next/navigation'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { VistaTabs } from '@/components/VistaTabs'
import { AttivitaLog } from './AttivitaLog'
import { TimbratureReport } from './TimbratureReport'
import { StoricoTrattative } from './StoricoTrattative'

export const dynamic = 'force-dynamic'

const VISTE = ['attivita', 'timbrature', 'trattative'] as const

export default async function LogOperatoriPage({
  searchParams,
}: {
  searchParams: { vista?: string; operatore?: string; azione?: string; periodo?: string }
}) {
  if (!(await utenteHaSezione('log-operatori'))) {
    redirect('/dashboard')
  }

  const vista = (VISTE as readonly string[]).includes(searchParams.vista ?? '')
    ? (searchParams.vista as (typeof VISTE)[number])
    : 'attivita'

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Amministrazione</p>
        <h1>Controllo operatori</h1>
        <p className="muted">
          Cosa ha fatto chi, e quando. Il registro si scrive da sé a ogni azione nel pannello.
        </p>
      </div>

      <VistaTabs
        vista={vista}
        base="/dashboard/log-operatori"
        tabs={[
          { chiave: 'attivita', etichetta: 'Attività' },
          { chiave: 'timbrature', etichetta: 'Timbrature' },
          { chiave: 'trattative', etichetta: 'Trattative' },
        ]}
      />

      {vista === 'timbrature' && <TimbratureReport searchParams={searchParams} />}
      {vista === 'trattative' && <StoricoTrattative />}
      {vista === 'attivita' && <AttivitaLog searchParams={searchParams} />}
    </>
  )
}
