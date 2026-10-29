'use client'

import { useEffect, useRef, useState } from 'react'

type GruppoScelta = { id: string; nome: string; colore: string }
type VarcoScelta = { chiave: string; descrizione: string; gruppoId: string | null; attivo: boolean }

/**
 * La scelta degli ingressi con le caselle: una per varco, e una per gruppo che
 * li (de)seleziona tutti. Le caselle hanno `name="varco"`, quindi il form GET
 * della pagina le porta nell'URL; nessuna spuntata = tutti gli ingressi.
 */
export function SelettoreVarchi({
  gruppi,
  varchi,
  selezionati,
  senzaGruppoNome,
  senzaGruppoColore,
}: {
  gruppi: GruppoScelta[]
  varchi: VarcoScelta[]
  selezionati: string[]
  senzaGruppoNome: string
  senzaGruppoColore: string
}) {
  const [scelti, setScelti] = useState<Set<string>>(new Set(selezionati))

  const commuta = (chiavi: string[], acceso: boolean) =>
    setScelti((prima) => {
      const dopo = new Set(prima)
      for (const c of chiavi) acceso ? dopo.add(c) : dopo.delete(c)
      return dopo
    })

  const sezioni = [
    ...gruppi.map((g) => ({ id: g.id, nome: g.nome, colore: g.colore, voci: varchi.filter((v) => v.gruppoId === g.id) })),
    { id: '-', nome: senzaGruppoNome, colore: senzaGruppoColore, voci: varchi.filter((v) => !v.gruppoId) },
  ].filter((s) => s.voci.length > 0)

  return (
    <div className="accessi-selettore">
      <div className="accessi-selettore-testa">
        <strong>Ingressi</strong>
        <span className="muted">
          {scelti.size === 0 ? 'nessuno spuntato = tutti gli ingressi' : `${scelti.size} ${scelti.size === 1 ? 'ingresso scelto' : 'ingressi scelti'}`}
        </span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => commuta(varchi.map((v) => v.chiave), true)}>
          Spunta tutti
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setScelti(new Set())}>
          Togli tutti
        </button>
      </div>
      <div className="accessi-selettore-gruppi">
        {sezioni.map((s) => (
          <fieldset key={s.id} className="accessi-selettore-gruppo">
            <legend>
              <CasellaGruppo
                chiavi={s.voci.map((v) => v.chiave)}
                scelti={scelti}
                onCambia={(acceso) => commuta(s.voci.map((v) => v.chiave), acceso)}
              >
                <i className="accessi-pallino" style={{ background: s.colore }} /> {s.nome}
              </CasellaGruppo>
            </legend>
            {s.voci.map((v) => (
              <label key={v.chiave} className={`accessi-selettore-varco ${v.attivo ? '' : 'muted'}`}>
                <input
                  type="checkbox"
                  name="varco"
                  value={v.chiave}
                  checked={scelti.has(v.chiave)}
                  onChange={(e) => commuta([v.chiave], e.target.checked)}
                />{' '}
                {v.descrizione}
                {!v.attivo && <span className="muted"> (non attivo)</span>}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
    </div>
  )
}

/** La casella del gruppo: piena se sono spuntati tutti i suoi varchi, a metà se solo alcuni. */
function CasellaGruppo({
  chiavi,
  scelti,
  onCambia,
  children,
}: {
  chiavi: string[]
  scelti: Set<string>
  onCambia: (acceso: boolean) => void
  children: React.ReactNode
}) {
  const conta = chiavi.filter((c) => scelti.has(c)).length
  const rif = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (rif.current) rif.current.indeterminate = conta > 0 && conta < chiavi.length
  }, [conta, chiavi.length])
  return (
    <label className="accessi-selettore-casella-gruppo">
      <input ref={rif} type="checkbox" checked={conta === chiavi.length} onChange={(e) => onCambia(e.target.checked)} /> {children}
    </label>
  )
}
