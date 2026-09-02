import Link from 'next/link'

/**
 * Tab di vista che cambiano un parametro nell'URL invece di uno stato locale:
 * così la vista si può mandare a qualcuno per link, e il tasto indietro fa
 * quello che ci si aspetta.
 */
export function VistaTabs({
  vista,
  base,
  tabs,
}: {
  vista: string
  base: string
  tabs: { chiave: string; etichetta: string }[]
}) {
  return (
    <div className="agenda-nav" style={{ marginBottom: '1.5rem' }}>
      {tabs.map((t) => (
        <Link
          key={t.chiave}
          className={`btn btn-sm ${t.chiave === vista ? '' : 'btn-ghost'}`}
          href={`${base}?vista=${t.chiave}`}
        >
          {t.etichetta}
        </Link>
      ))}
    </div>
  )
}
