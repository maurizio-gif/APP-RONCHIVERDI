'use client'

// Le card abbonamenti della dashboard direzionale (vendite MTD/YTD e soci
// attivi), filtrate per gruppo nel browser — vedi il filtro condiviso in
// app/dashboard/abbonamenti/FiltroGruppi.tsx.

import { euro, variazionePercentuale } from '@/lib/pipeline'
import { nellaSelezione, useFiltroGruppi } from '@/app/dashboard/abbonamenti/FiltroGruppi'
import { StatCard } from './StatCard'

/** Vendite di un periodo in un gruppo; gruppoId null = prodotti non ancora categorizzati. */
export type VenditeGruppo = { gruppoId: string | null; vendite: number; fatturato: number }

/** Soci attivi in una data, in un gruppo (stessa convenzione su gruppoId null). */
export type AttiviGruppo = { gruppoId: string | null; attivi: number }

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
