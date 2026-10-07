'use client'

import { useMemo, useState } from 'react'

// Il multi-select per ESCLUDERE abbonamenti dal report: una lista a spunte,
// non un <select multiple> (che per sceglierne più d'uno vuole Ctrl/Cmd
// premuto). Ha un campo per restringere la lista scrivendo («corporate») e
// un pulsante che spunta tutti i visibili in un colpo. Le voci nascoste dal
// campo restano nel modulo e, se spuntate, partono comunque.
export function EscludiAbbonamenti({
  prodotti,
  iniziali,
}: {
  prodotti: { nome: string; n: number }[]
  iniziali: string[]
}) {
  const [cerca, setCerca] = useState('')
  const [scelti, setScelti] = useState<Set<string>>(() => new Set(iniziali))

  const visibili = useMemo(() => {
    const t = cerca.trim().toLowerCase()
    return t ? prodotti.filter((p) => p.nome.toLowerCase().includes(t)) : prodotti
  }, [cerca, prodotti])

  const cambia = (nome: string, acceso: boolean) =>
    setScelti((prima) => {
      const dopo = new Set(prima)
      if (acceso) dopo.add(nome)
      else dopo.delete(nome)
      return dopo
    })

  return (
    <div className="escludi-abb">
      <div className="escludi-abb-barra">
        <input
          type="search"
          value={cerca}
          onChange={(e) => setCerca(e.target.value)}
          placeholder="Restringi l’elenco (es. corporate)"
          aria-label="Restringi l’elenco degli abbonamenti"
          autoComplete="off"
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() =>
            setScelti((prima) => {
              const dopo = new Set(prima)
              for (const p of visibili) dopo.add(p.nome)
              return dopo
            })
          }
        >
          Spunta i {visibili.length} visibili
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setScelti(new Set())}>
          Togli tutte
        </button>
        <span className="muted">{scelti.size === 0 ? 'Nessuno escluso' : `${scelti.size} esclusi`}</span>
      </div>

      <div className="escludi-abb-lista">
        {prodotti.map((p) => (
          <label
            key={p.nome}
            className="escludi-abb-voce"
            hidden={!visibili.includes(p)}
            title={p.nome}
          >
            <input
              type="checkbox"
              name="escludi"
              value={p.nome}
              checked={scelti.has(p.nome)}
              onChange={(e) => cambia(p.nome, e.target.checked)}
            />
            <span className="escludi-abb-nome">{p.nome}</span>
            <span className="muted">{p.n}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
