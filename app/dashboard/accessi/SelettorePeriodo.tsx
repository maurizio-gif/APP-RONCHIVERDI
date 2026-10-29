import Link from 'next/link'
import { PRESET, etichettaIntervallo, type Periodo } from '@/lib/accessi'

/**
 * La scelta del periodo, per la panoramica e per la ricerca: i preset sono
 * link, le date libere un form GET. Tutto passa dall'URL — nessuno stato —
 * quindi una vista si condivide copiando l'indirizzo. `altri` sono gli altri
 * parametri da mantenere (gruppo, persona, filtri della ricerca).
 */
export function SelettorePeriodo({
  periodo,
  percorso,
  altri = {},
}: {
  periodo: Periodo
  percorso: string
  altri?: Record<string, string | undefined>
}) {
  const conservati = Object.entries(altri).filter((e): e is [string, string] => !!e[1])
  const href = (chiave: string) => {
    const q = new URLSearchParams([...conservati, ['periodo', chiave]])
    return `${percorso}?${q.toString()}`
  }
  return (
    <div className="accessi-periodo">
      <div className="agenda-nav">
        {PRESET.map((p) => (
          <Link key={p.chiave} href={href(p.chiave)} className={`btn btn-sm ${periodo.preset === p.chiave ? '' : 'btn-ghost'}`}>
            {p.etichetta}
          </Link>
        ))}
      </div>
      <form method="get" action={percorso} className="accessi-periodo-form">
        {conservati.map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="muted">
          Dal <input type="date" name="dal" defaultValue={periodo.dal} min="2023-01-01" />
        </label>
        <label className="muted">
          al <input type="date" name="al" defaultValue={periodo.al} />
        </label>
        <button type="submit" className="btn btn-sm btn-ghost">
          Applica
        </button>
      </form>
      <p className="muted accessi-periodo-testo">{etichettaIntervallo(periodo.dal, periodo.al)}</p>
    </div>
  )
}
