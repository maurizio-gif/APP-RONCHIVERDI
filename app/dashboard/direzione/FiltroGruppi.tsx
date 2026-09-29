'use client'

// Il filtro gruppi della dashboard direzionale, applicato nel browser invece
// che dal server. Prima ogni chip era un <Link> a /dashboard/direzione?gruppi=…:
// cambiare filtro rifaceva l'intera pagina sul server — anche contatti,
// accessi al sito e canali di vendita, che dal filtro non dipendono affatto —
// e ogni vendita/grafico abbonamenti tornava a scansionare la tabella
// `abbonamenti` (oltre 160.000 righe) per un sottoinsieme di gruppi. Qui il
// server manda UNA volta i dati già spezzati per gruppo (poche centinaia di
// numeri) e il filtro è solo una somma sui gruppi scelti: nessuna richiesta
// di rete, risposta immediata.
//
// La selezione resta nell'URL (?gruppi=id1,id2), come prima: condivisibile,
// sopravvive al ricaricamento della pagina, e "indietro" annulla l'ultimo cambio.
// window.history.pushState è integrato nel router di Next (da 14.1):
// useSearchParams si aggiorna senza nessuna navigazione verso il server.

import { createContext, useContext, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { euro, variazionePercentuale } from '@/lib/pipeline'
import { GraficoPerGruppo, type VoceLegendaStack, type VoceMeseStack } from '@/app/dashboard/abbonamenti/GraficoPerGruppo'
import { StatCard } from './StatCard'

/** Vendite di un periodo in un gruppo; gruppoId null = prodotti non ancora categorizzati. */
export type VenditeGruppo = { gruppoId: string | null; vendite: number; fatturato: number }

/** Soci attivi in una data, in un gruppo (stessa convenzione su gruppoId null). */
export type AttiviGruppo = { gruppoId: string | null; attivi: number }

type Contesto = {
  gruppi: { id: string; nome: string }[]
  // Vuoto = "Tutti": nessun filtro, "Non categorizzato" compreso.
  selezionati: string[]
  cambia: (id: string | null) => void
}

const ContestoFiltroGruppi = createContext<Contesto | null>(null)

function useFiltroGruppi(): Contesto {
  const contesto = useContext(ContestoFiltroGruppi)
  if (!contesto) throw new Error('FiltroGruppi mancante attorno a un componente filtrato per gruppo')
  return contesto
}

// Stessa regola dei filtri lato database di prima: senza filtro conta tutto,
// con un filtro solo i gruppi scelti — "Non categorizzato" (gruppo_id null)
// resta fuori, come faceva `.in('gruppo_id', …)`.
function nellaSelezione(gruppoId: string | null, selezionati: string[]): boolean {
  return selezionati.length === 0 || (gruppoId !== null && selezionati.includes(gruppoId))
}

export function FiltroGruppi({ gruppi, children }: { gruppi: { id: string; nome: string }[]; children: ReactNode }) {
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

function sommaVendite(voci: VenditeGruppo[], selezionati: string[]): { vendite: number; fatturato: number } {
  return voci
    .filter((v) => nellaSelezione(v.gruppoId, selezionati))
    .reduce((acc, v) => ({ vendite: acc.vendite + v.vendite, fatturato: acc.fatturato + v.fatturato }), {
      vendite: 0,
      fatturato: 0,
    })
}

export function StatVendite({
  annoPrecedente,
  mtd,
  mtdPrec,
  ytd,
  ytdPrec,
}: {
  annoPrecedente: number
  mtd: VenditeGruppo[]
  mtdPrec: VenditeGruppo[]
  ytd: VenditeGruppo[]
  ytdPrec: VenditeGruppo[]
}) {
  const { selezionati } = useFiltroGruppi()
  const venditeMTD = sommaVendite(mtd, selezionati)
  const venditeMTDPrec = sommaVendite(mtdPrec, selezionati)
  const venditeYTD = sommaVendite(ytd, selezionati)
  const venditeYTDPrec = sommaVendite(ytdPrec, selezionati)
  return (
    <div className="griglia-stat">
      <StatCard
        label="Vendite MTD"
        valore={String(venditeMTD.vendite)}
        nota={`${annoPrecedente}: ${venditeMTDPrec.vendite}`}
        percentuale={variazionePercentuale(venditeMTD.vendite, venditeMTDPrec.vendite)}
      />
      <StatCard
        label="Fatturato MTD"
        valore={euro(venditeMTD.fatturato) ?? '—'}
        nota={`${annoPrecedente}: ${euro(venditeMTDPrec.fatturato) ?? '—'}`}
        percentuale={variazionePercentuale(venditeMTD.fatturato, venditeMTDPrec.fatturato)}
      />
      <StatCard
        label="Vendite YTD"
        valore={String(venditeYTD.vendite)}
        nota={`${annoPrecedente}: ${venditeYTDPrec.vendite}`}
        percentuale={variazionePercentuale(venditeYTD.vendite, venditeYTDPrec.vendite)}
      />
      <StatCard
        label="Fatturato YTD"
        valore={euro(venditeYTD.fatturato) ?? '—'}
        nota={`${annoPrecedente}: ${euro(venditeYTDPrec.fatturato) ?? '—'}`}
        percentuale={variazionePercentuale(venditeYTD.fatturato, venditeYTDPrec.fatturato)}
      />
    </div>
  )
}

type SociInData = { nota: string; perGruppo: AttiviGruppo[] }

function sommaAttivi(voci: AttiviGruppo[], selezionati: string[]): number {
  return voci.filter((v) => nellaSelezione(v.gruppoId, selezionati)).reduce((tot, v) => tot + v.attivi, 0)
}

export function StatSociAttivi({ oggi, meseFa, annoFa }: { oggi: SociInData; meseFa: SociInData; annoFa: SociInData }) {
  const { selezionati } = useFiltroGruppi()
  const sociOggi = sommaAttivi(oggi.perGruppo, selezionati)
  const sociMeseFa = sommaAttivi(meseFa.perGruppo, selezionati)
  const sociAnnoFa = sommaAttivi(annoFa.perGruppo, selezionati)
  return (
    <div className="griglia-stat">
      <StatCard label="Oggi" valore={String(sociOggi)} nota={oggi.nota} />
      <StatCard
        label="Un mese fa"
        valore={String(sociMeseFa)}
        nota={meseFa.nota}
        percentuale={variazionePercentuale(sociOggi, sociMeseFa)}
        suffissoBadge="vs oggi"
      />
      <StatCard
        label="Un anno fa"
        valore={String(sociAnnoFa)}
        nota={annoFa.nota}
        percentuale={variazionePercentuale(sociOggi, sociAnnoFa)}
        suffissoBadge="vs oggi"
      />
    </div>
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
