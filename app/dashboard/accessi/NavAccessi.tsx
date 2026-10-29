import Link from 'next/link'

const VOCI = [
  { chiave: 'panoramica', href: '/dashboard/accessi', etichetta: 'Panoramica' },
  { chiave: 'report', href: '/dashboard/accessi/report', etichetta: 'Report ingressi' },
  { chiave: 'ricerca', href: '/dashboard/accessi/ricerca', etichetta: 'Ricerca' },
  { chiave: 'gruppi', href: '/dashboard/accessi/gruppi', etichetta: 'Gruppi di varchi' },
] as const

/** Le pagine della sezione, una riga sotto il titolo; quella aperta è piena. */
export function NavAccessi({ attiva }: { attiva: (typeof VOCI)[number]['chiave'] }) {
  return (
    <nav className="agenda-nav accessi-nav" aria-label="Sezione Accessi">
      {VOCI.map((v) => (
        <Link
          key={v.chiave}
          href={v.href}
          className={`btn btn-sm ${v.chiave === attiva ? '' : 'btn-ghost'}`}
          aria-current={v.chiave === attiva ? 'page' : undefined}
        >
          {v.etichetta}
        </Link>
      ))}
    </nav>
  )
}
