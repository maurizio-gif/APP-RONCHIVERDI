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

  // Un segmentato, non due pulsanti: erano oro pieno e fantasma, identici ai
  // comandi che agiscono sui dati, e «Calendario» sembrava una cosa da fare
  // invece di un modo di guardare. `aria-current` dice quale vista è quella
  // aperta anche a chi non vede il fondo pieno.
  return (
    <div className="vista-tabs">
      {tabs.map((t) => (
        <Link
          key={t.chiave}
          className={`vista-tab${t.chiave === vista ? ' is-attivo' : ''}`}
          aria-current={t.chiave === vista ? 'page' : undefined}
          href={href(t.chiave)}
        >
          {t.etichetta}
          {!!t.contatore && (
            <span className="vista-tab-contatore" title="Ancora da fare">
              {t.contatore}
            </span>
          )}
        </Link>
      ))}
    </div>
  )
}
