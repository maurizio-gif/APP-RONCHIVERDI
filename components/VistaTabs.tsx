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
  altriParametri,
}: {
  vista: string
  base: string
  tabs: { chiave: string; etichetta: string; contatore?: number }[]
  /**
   * Gli altri parametri della pagina, da riportare nel link. Senza questi
   * cambiare vista azzererebbe i filtri e il mese che si stava guardando:
   * il link porterebbe alla pagina nuda, non alla stessa cosa vista in un
   * altro modo. I valori vuoti si scartano da soli.
   */
  altriParametri?: Record<string, string | null | undefined>
}) {
  function href(chiave: string) {
    const params = new URLSearchParams()
    params.set('vista', chiave)
    for (const [nome, valore] of Object.entries(altriParametri ?? {})) {
      if (valore) params.set(nome, valore)
    }
    return `${base}?${params.toString()}`
  }

  return (
    <div className="agenda-nav" style={{ marginBottom: '1.5rem' }}>
      {tabs.map((t) => (
        <Link
          key={t.chiave}
          className={`btn btn-sm ${t.chiave === vista ? '' : 'btn-ghost'}`}
          href={href(t.chiave)}
        >
          {t.etichetta}
          {!!t.contatore && <span className="vista-tab-contatore">{t.contatore}</span>}
        </Link>
      ))}
    </div>
  )
}
