'use client'

// Il filtro gruppi delle pagine abbonamenti (/dashboard/abbonamenti e la
// Dashboard direzionale), applicato nel browser invece che dal server. Prima
// ogni chip era un <Link> a ?gruppi=…: cambiare filtro rifaceva l'intera
// pagina sul server — anche le sezioni che dal filtro non dipendono — e ogni
// vista abbonamenti tornava ad aggregare la tabella `abbonamenti` (oltre
// 160.000 righe) per un sottoinsieme di gruppi, alcune viste più secondi
// l'una. Qui il server manda UNA volta i dati già spezzati per gruppo (poche
// centinaia di righe) e il filtro è solo una somma sui gruppi scelti: nessuna
// richiesta di rete, risposta immediata.
//
// La selezione resta nell'URL (?gruppi=id1,id2), come prima: condivisibile,
// sopravvive al ricaricamento della pagina, e "indietro" annulla l'ultimo
// cambio. window.history.pushState è integrato nel router di Next (da 14.1):
// useSearchParams si aggiorna senza nessuna navigazione verso il server.
//
// Qui solo i pezzi comuni (contesto, chip, grafico per gruppo); le card
// specifiche di ciascuna pagina stanno accanto alla pagina (vedi
// SezioniFiltrate.tsx qui e direzione/StatAbbonamenti.tsx) e leggono la
// selezione con useFiltroGruppi.

import { createContext, useContext, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { euro } from '@/lib/pipeline'
import { GraficoPerGruppo, type VoceLegendaStack, type VoceMeseStack } from './GraficoPerGruppo'

export type GruppoFiltro = { id: string; nome: string }

type Contesto = {
  gruppi: GruppoFiltro[]
  // Vuoto = "Tutti": nessun filtro, "Non categorizzato" compreso.
  selezionati: string[]
  cambia: (id: string | null) => void
}

const ContestoFiltroGruppi = createContext<Contesto | null>(null)

export function useFiltroGruppi(): Contesto {
  const contesto = useContext(ContestoFiltroGruppi)
  if (!contesto) throw new Error('FiltroGruppi mancante attorno a un componente filtrato per gruppo')
  return contesto
}

// Stessa regola dei filtri lato database di prima: senza filtro conta tutto,
// con un filtro solo i gruppi scelti — "Non categorizzato" (gruppo_id null)
// resta fuori, come faceva `.in('gruppo_id', …)`.
export function nellaSelezione(gruppoId: string | null, selezionati: string[]): boolean {
  return selezionati.length === 0 || (gruppoId !== null && selezionati.includes(gruppoId))
}

export function FiltroGruppi({ gruppi, children }: { gruppi: GruppoFiltro[]; children: ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const validi = new Set(gruppi.map((g) => g.id))
  const selezionati = (searchParams.get('gruppi') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((id) => validi.has(id))

  // "Tutti" azzera la selezione; ogni gruppo si accende/spegne senza toccare
  // gli altri già selezionati.
  function cambia(id: string | null) {
    const attivi = new Set(id === null ? [] : selezionati)
    if (id !== null) {
      if (attivi.has(id)) attivi.delete(id)
      else attivi.add(id)
    }
    const params = new URLSearchParams(searchParams.toString())
    if (attivi.size > 0) params.set('gruppi', Array.from(attivi).join(','))
    else params.delete('gruppi')
    const query = params.toString()
    window.history.pushState(null, '', `${pathname}${query ? `?${query}` : ''}`)
  }

  return (
    <ContestoFiltroGruppi.Provider value={{ gruppi, selezionati, cambia }}>{children}</ContestoFiltroGruppi.Provider>
  )
}

export function ChipGruppi() {
  const { gruppi, selezionati, cambia } = useFiltroGruppi()
  const filtroAttivo = selezionati.length > 0
  return (
    <fieldset className="filtro-gruppo">
      <button
        type="button"
        className={`chip${!filtroAttivo ? ' is-attivo' : ''}`}
        aria-pressed={!filtroAttivo}
        onClick={() => cambia(null)}
      >
        Tutti
      </button>
      {gruppi.map((g) => {
        const attivo = selezionati.includes(g.id)
        return (
          <button
            key={g.id}
            type="button"
            className={`chip${attivo ? ' is-attivo' : ''}`}
            aria-pressed={attivo}
            onClick={() => cambia(g.id)}
          >
            {g.nome}
          </button>
        )
      })}
    </fieldset>
  )
}

/**
 * GraficoPerGruppo con il filtro applicato: `serie`/`legenda` arrivano dal
 * server SENZA filtro (tutti i gruppi, più "Non categorizzato"), qui restano
 * solo i gruppi scelti e il totale del mese si ricalcola su di loro. Colori e
 * ordine non cambiano: li ha già decisi caricaAndamentoPerGruppo sulla lista
 * completa dei gruppi, non sulla selezione. `formato` e non una funzione: una
 * prop di un Client Component non può essere una funzione.
 */
export function GraficoPerGruppoFiltrato({
  serie,
  legenda,
  formato,
  etichettaAria,
}: {
  serie: VoceMeseStack[]
  legenda: VoceLegendaStack[]
  formato: 'euro' | 'numero'
  etichettaAria: string
}) {
  const { selezionati } = useFiltroGruppi()
  if (selezionati.length === 0) return <GraficoPerGruppo serie={serie} legenda={legenda} etichettaAria={etichettaAria} />

  const formatta = (n: number) => (formato === 'euro' ? (euro(n) ?? '—') : String(n))
  const serieFiltrata = serie.map((m) => {
    const gruppi = m.gruppi.filter((g) => nellaSelezione(g.gruppoId, selezionati))
    const totale = gruppi.reduce((tot, g) => tot + g.valore, 0)
    return { ...m, gruppi, totale, totaleTesto: formatta(totale) }
  })
  const legendaFiltrata = legenda.filter((v) => selezionati.includes(v.chiave))
  return <GraficoPerGruppo serie={serieFiltrata} legenda={legendaFiltrata} etichettaAria={etichettaAria} />
}
