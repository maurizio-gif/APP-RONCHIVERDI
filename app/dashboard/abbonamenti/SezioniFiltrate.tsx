'use client'

// Le sezioni della pagina Abbonamenti che seguono il filtro gruppi, calcolate
// nel browser sui dati che il server manda UNA volta, già spezzati per gruppo
// (vedi FiltroGruppi.tsx). Stessi conti e stesso markup di quando li faceva
// page.tsx lato server con `.in('gruppo_id', …)`: qui la stessa selezione la
// applica nellaSelezione, riga per riga.

import Link from 'next/link'
import { euro, testoVariazione } from '@/lib/pipeline'
import ObiettivoMensile from './ObiettivoMensile'
import { GraficoPerGruppo, type VoceGruppoStack, type VoceLegendaStack, type VoceMeseStack } from './GraficoPerGruppo'
import { nellaSelezione, useFiltroGruppi } from './FiltroGruppi'
import { COLORE_NON_RINNOVATO, COLORE_NUOVO, COLORE_RINNOVATO, COLORE_RINNOVO } from './colori'

/** Un mese ('YYYY-MM-01') con la sua etichetta già scritta dal server. */
export type MeseEtichettato = { mese: string; etichetta: string }

/** Una riga di abbonamenti_scadenze_mensili: scadenze di un mese in un gruppo, rinnovate o no. */
export type RigaScadenze = { mese: string; gruppoId: string | null; rinnovato: boolean; numero: number; valore: number }

/** Vendite di un gruppo, nuove o rinnovi (abbonamenti_giornalieri_tipo / _mensili_tipo). */
export type RigaVenditeTipo = { gruppoId: string | null; rinnovo: boolean; vendite: number; fatturato: number }

export type RigaVenditeTipoMese = RigaVenditeTipo & { mese: string }

// ─────────────────────────────────────────────── 1. Utenti attivi, a oggi

export function AttiviOggiPerGruppo({ attivi }: { attivi: { gruppoId: string | null; attivi: number }[] }) {
  const { gruppi, selezionati } = useFiltroGruppi()
  const filtroAttivo = selezionati.length > 0
  const perGruppo = new Map(attivi.map((v) => [v.gruppoId, v.attivi]))
  const totale = attivi.reduce((tot, v) => tot + v.attivi, 0)
  const nonCategorizzato = perGruppo.get(null) ?? 0
  const gruppiMostrati = filtroAttivo ? gruppi.filter((g) => selezionati.includes(g.id)) : gruppi

  return (
    <div className="griglia-stat">
      {!filtroAttivo && (
        <div className={`stat${totale > 0 ? '' : ' is-vuoto'}`}>
          <span className="stat-testa">
            <span className="stat-label">Totale</span>
          </span>
          <span className="stat-valore">{totale}</span>
          <span className="stat-nota">In tutti i gruppi</span>
        </div>
      )}
      {gruppiMostrati.map((g) => {
        const valore = perGruppo.get(g.id) ?? 0
        return (
          <div key={g.id} className={`stat${valore > 0 ? '' : ' is-vuoto'}`}>
            <span className="stat-testa">
              <span className="stat-label">{g.nome}</span>
            </span>
            <span className="stat-valore">{valore}</span>
          </div>
        )
      })}
      {!filtroAttivo && nonCategorizzato > 0 && (
        <Link href="/dashboard/abbonamenti/gruppi?solo=attivi" className="stat stat-warn">
          <span className="stat-testa">
            <span className="stat-label">Non categorizzato</span>
          </span>
          <span className="stat-valore">{nonCategorizzato}</span>
          <span className="stat-nota">Assegna un gruppo ai prodotti mancanti</span>
        </Link>
      )}
    </div>
  )
}

// ───────────────────────────────────────────── 2. Abbonamenti in scadenza

type VoceScadenzaMese = {
  totale: number
  daRichiamare: number
  rinnovati: number
  valoreTotale: number
  valoreRinnovato: number
  valoreDaRinnovare: number
}

function voceScadenzaVuota(): VoceScadenzaMese {
  return { totale: 0, daRichiamare: 0, rinnovati: 0, valoreTotale: 0, valoreRinnovato: 0, valoreDaRinnovare: 0 }
}

export function ScadenzeProssime({ mesi, righe }: { mesi: MeseEtichettato[]; righe: RigaScadenze[] }) {
  const { selezionati } = useFiltroGruppi()
  const scadenzePerMese = new Map<string, VoceScadenzaMese>()
  for (const r of righe) {
    if (!nellaSelezione(r.gruppoId, selezionati)) continue
    const voce = scadenzePerMese.get(r.mese) ?? voceScadenzaVuota()
    voce.totale += r.numero
    voce.valoreTotale += r.valore
    if (r.rinnovato) {
      voce.rinnovati += r.numero
      voce.valoreRinnovato += r.valore
    } else {
      voce.daRichiamare += r.numero
      voce.valoreDaRinnovare += r.valore
    }
    scadenzePerMese.set(r.mese, voce)
  }

  // Il dettaglio (/scadenze) legge ancora il filtro dall'URL lato server:
  // gli si passa la stessa selezione.
  function hrefScadenze(m: string) {
    const params = new URLSearchParams({ mese: m })
    if (selezionati.length > 0) params.set('gruppi', selezionati.join(','))
    return `/dashboard/abbonamenti/scadenze?${params.toString()}`
  }

  return (
    <div className="griglia-stat">
      {mesi.map(({ mese: m, etichetta }) => {
        const voce = scadenzePerMese.get(m) ?? voceScadenzaVuota()
        return (
          <Link key={m} href={hrefScadenze(m)} className={`stat${voce.totale > 0 ? '' : ' is-vuoto'}`}>
            <span className="stat-testa">
              <span className="stat-label">{etichetta}</span>
            </span>
            <span className="stat-valore">{voce.totale}</span>
            {voce.totale > 0 && <span className="stat-nota">{euro(voce.valoreTotale) ?? '—'} in scadenza</span>}
            {voce.daRichiamare > 0 && (
              <span className="stat-nota">
                {voce.daRichiamare} da rinnovare · {euro(voce.valoreDaRinnovare) ?? '—'}
              </span>
            )}
            {voce.rinnovati > 0 && (
              <span className="stat-nota">
                {voce.rinnovati} già rinnovati · {euro(voce.valoreRinnovato) ?? '—'}
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}

// ───────────────────────────────────────────── 3. Andamento rinnovi, 24 mesi

const LEGENDA_RINNOVI: VoceLegendaStack[] = [
  { chiave: 'rinnovati', nome: 'Rinnovati', colore: COLORE_RINNOVATO },
  { chiave: 'non-rinnovati', nome: 'Non ancora rinnovati', colore: COLORE_NON_RINNOVATO },
]

export function AndamentoRinnovi({ mesi, righe }: { mesi: MeseEtichettato[]; righe: RigaScadenze[] }) {
  const { selezionati } = useFiltroGruppi()
  // Le righe arrivano insieme a quelle dei 4 mesi futuri della card sopra
  // (una lettura sola): qui contano solo i mesi di questa finestra.
  const mesiFinestra = new Set(mesi.map((m) => m.mese))
  const rinnoviPerMese = new Map<string, { rinnovati: number; nonRinnovati: number }>()
  for (const r of righe) {
    if (!mesiFinestra.has(r.mese) || !nellaSelezione(r.gruppoId, selezionati)) continue
    const voce = rinnoviPerMese.get(r.mese) ?? { rinnovati: 0, nonRinnovati: 0 }
    if (r.rinnovato) voce.rinnovati += r.numero
    else voce.nonRinnovati += r.numero
    rinnoviPerMese.set(r.mese, voce)
  }

  const serie: VoceMeseStack[] = mesi.map(({ mese: m, etichetta }) => {
    const voce = rinnoviPerMese.get(m) ?? { rinnovati: 0, nonRinnovati: 0 }
    const voci: VoceGruppoStack[] = [
      {
        gruppoId: 'rinnovati',
        nome: 'Rinnovati',
        colore: COLORE_RINNOVATO,
        valore: voce.rinnovati,
        valoreTesto: String(voce.rinnovati),
      },
      {
        gruppoId: 'non-rinnovati',
        nome: 'Non ancora rinnovati',
        colore: COLORE_NON_RINNOVATO,
        valore: voce.nonRinnovati,
        valoreTesto: String(voce.nonRinnovati),
      },
    ]
    const totale = voce.rinnovati + voce.nonRinnovati
    const percentoRinnovati = totale > 0 ? Math.round((voce.rinnovati / totale) * 100) : null
    return {
      mese: m,
      etichetta,
      gruppi: voci,
      totale,
      totaleTesto: String(totale),
      etichettaSopra: percentoRinnovati !== null ? `${percentoRinnovati}%` : undefined,
      notaPercentuale: percentoRinnovati !== null ? `${percentoRinnovati}% rinnovati sul totale scaduto quel mese` : undefined,
    }
  })

  // La stessa % che compare sopra ogni singola barra, ma sull'intera
  // finestra dei 24 mesi invece che mese per mese — la domanda "in generale,
  // quanto rinnoviamo?" non ha risposta sommando a mente 24 percentuali già
  // arrotondate (e diverse per peso), quindi si risomma qui direttamente
  // rinnovati e scaduti totali.
  const totali = Array.from(rinnoviPerMese.values()).reduce(
    (acc, v) => ({ rinnovati: acc.rinnovati + v.rinnovati, nonRinnovati: acc.nonRinnovati + v.nonRinnovati }),
    { rinnovati: 0, nonRinnovati: 0 }
  )
  const totaleScaduti = totali.rinnovati + totali.nonRinnovati
  const percentoComplessivo = totaleScaduti > 0 ? Math.round((totali.rinnovati / totaleScaduti) * 100) : null

  return (
    <>
      {percentoComplessivo !== null && (
        <div className="griglia-stat">
          <div className="stat stat-ok">
            <span className="stat-testa">
              <span className="stat-label">% di rinnovi, ultimi 24 mesi</span>
            </span>
            <span className="stat-valore">{percentoComplessivo}%</span>
            <span className="stat-nota">
              {totali.rinnovati} rinnovati su {totaleScaduti} abbonamenti scaduti
            </span>
          </div>
        </div>
      )}
      <GraficoPerGruppo
        serie={serie}
        legenda={LEGENDA_RINNOVI}
        etichettaAria="Abbonamenti scaduti, rinnovati o no entro 30 giorni, ultimi 24 mesi"
      />
    </>
  )
}

// ──────────────────────────────── 4. Confronto a parità di giorni e obiettivo

type Somma = { vendite: number; fatturato: number }
type SommaTipo = { totale: Somma; nuovi: Somma; rinnovi: Somma }

const RIGHE_TIPO = [
  { chiave: 'totale', etichetta: 'Totale' },
  { chiave: 'nuovi', etichetta: 'Nuovi' },
  { chiave: 'rinnovi', etichetta: 'Rinnovi' },
] as const

function sommaVuota(): Somma {
  return { vendite: 0, fatturato: 0 }
}

// "Totale" è sempre nuovi + rinnovi, non una terza lettura: si somma una
// volta sola leggendo lo stesso flag `rinnovo`.
function sommaPerTipo(righe: RigaVenditeTipo[], selezionati: string[]): SommaTipo {
  const risultato: SommaTipo = { totale: sommaVuota(), nuovi: sommaVuota(), rinnovi: sommaVuota() }
  for (const r of righe) {
    if (!nellaSelezione(r.gruppoId, selezionati)) continue
    const voce = r.rinnovo ? risultato.rinnovi : risultato.nuovi
    voce.vendite += r.vendite
    voce.fatturato += r.fatturato
    risultato.totale.vendite += r.vendite
    risultato.totale.fatturato += r.fatturato
  }
  return risultato
}

export function TabellaConfrontoAnni({
  anni,
  annoCorrente,
}: {
  anni: { anno: number; righe: RigaVenditeTipo[] }[]
  annoCorrente: number
}) {
  const { selezionati } = useFiltroGruppi()
  const periodi = anni.map((a) => ({ anno: a.anno, ...sommaPerTipo(a.righe, selezionati) }))
  return (
    <div className="tabella-wrap">
      <table className="tabella">
        <thead>
          <tr>
            <th>Anno</th>
            <th>Tipo</th>
            <th>Vendite</th>
            <th>Fatturato</th>
            <th>Var. vs anno prec.</th>
          </tr>
        </thead>
        <tbody>
          {periodi.map((p, i) => {
            const precedente = periodi[i - 1]
            return RIGHE_TIPO.map((riga, j) => {
              const somma = p[riga.chiave]
              return (
                <tr key={`${p.anno}-${riga.chiave}`} className={p.anno === annoCorrente ? 'is-oggi' : ''}>
                  {j === 0 && <td rowSpan={RIGHE_TIPO.length}>{p.anno}</td>}
                  <td className={riga.chiave === 'totale' ? undefined : 'muted'}>{riga.etichetta}</td>
                  <td>{somma.vendite || '—'}</td>
                  <td>{somma.fatturato ? euro(somma.fatturato) : '—'}</td>
                  <td>{i === 0 ? '—' : testoVariazione(somma.fatturato, precedente[riga.chiave].fatturato)}</td>
                </tr>
              )
            })
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * L'obiettivo segue lo stesso filtro delle statistiche sopra: "Tutti" mostra
 * il generale, un solo gruppo selezionato mostra e permette di impostare il
 * suo. Più gruppi insieme sono una combinazione qualunque, senza una riga
 * sua nella tabella (vedi la migration) — lì il campo resta nascosto invece
 * di sommare obiettivi di gruppi diversi come se fosse un dato solo.
 * `obiettivi` sono tutte le righe del mese (generale e per gruppo): il
 * server le legge una volta, qui si sceglie quella della selezione.
 */
export function ObiettivoDelMese({
  mese,
  obiettivi,
  righeAnnoCorrente,
}: {
  mese: string
  obiettivi: { gruppoId: string | null; goal: number | null }[]
  righeAnnoCorrente: RigaVenditeTipo[]
}) {
  const { gruppi, selezionati } = useFiltroGruppi()
  const gruppoSingolo = selezionati.length === 1 ? selezionati[0] : null
  if (selezionati.length > 0 && gruppoSingolo === null) {
    return <p className="muted">Seleziona un solo gruppo per vedere o impostare il suo obiettivo del mese.</p>
  }
  const nomeGruppoSingolo = gruppoSingolo ? (gruppi.find((g) => g.id === gruppoSingolo)?.nome ?? null) : null
  const goal = obiettivi.find((o) => o.gruppoId === gruppoSingolo)?.goal ?? null
  return (
    <ObiettivoMensile
      // Forza un nuovo componente (e quindi lo stato iniziale giusto)
      // quando cambia il contesto: senza key, passare da un gruppo
      // all'altro riuserebbe l'istanza e il valore mostrato resterebbe
      // quello del gruppo precedente finché non si tocca il campo.
      key={gruppoSingolo ?? 'generale'}
      mese={mese}
      gruppoId={gruppoSingolo}
      etichettaContesto={nomeGruppoSingolo}
      goalIniziale={goal}
      fatturatoAdOggi={sommaPerTipo(righeAnnoCorrente, selezionati).totale.fatturato}
    />
  )
}

// ──────────────────────────────────────────── 5. Andamento VENDUTO, 24 mesi

const LEGENDA_VENDITE_TIPO: VoceLegendaStack[] = [
  { chiave: 'nuovi', nome: 'Nuovi', colore: COLORE_NUOVO },
  { chiave: 'rinnovi', nome: 'Rinnovi', colore: COLORE_RINNOVO },
]

function dettaglioVenditeTipo(parte: Somma, totaleFatturato: number): string {
  const percento = totaleFatturato > 0 ? Math.round((parte.fatturato / totaleFatturato) * 100) : 0
  return `${parte.vendite} vendite · ${percento}%`
}

export function AndamentoVenduto({ mesi, righe }: { mesi: MeseEtichettato[]; righe: RigaVenditeTipoMese[] }) {
  const { selezionati } = useFiltroGruppi()
  const perMese = new Map<string, { nuovi: Somma; rinnovi: Somma }>()
  for (const r of righe) {
    if (!nellaSelezione(r.gruppoId, selezionati)) continue
    const voce = perMese.get(r.mese) ?? { nuovi: sommaVuota(), rinnovi: sommaVuota() }
    const parte = r.rinnovo ? voce.rinnovi : voce.nuovi
    parte.vendite += r.vendite
    parte.fatturato += r.fatturato
    perMese.set(r.mese, voce)
  }

  const serie: VoceMeseStack[] = mesi.map(({ mese: m, etichetta }) => {
    const voce = perMese.get(m) ?? { nuovi: sommaVuota(), rinnovi: sommaVuota() }
    const totaleFatturato = voce.nuovi.fatturato + voce.rinnovi.fatturato
    const voci: VoceGruppoStack[] = [
      {
        gruppoId: 'nuovi',
        nome: 'Nuovi',
        colore: COLORE_NUOVO,
        valore: voce.nuovi.fatturato,
        valoreTesto: euro(voce.nuovi.fatturato) ?? '—',
        dettaglio: dettaglioVenditeTipo(voce.nuovi, totaleFatturato),
      },
      {
        gruppoId: 'rinnovi',
        nome: 'Rinnovi',
        colore: COLORE_RINNOVO,
        valore: voce.rinnovi.fatturato,
        valoreTesto: euro(voce.rinnovi.fatturato) ?? '—',
        dettaglio: dettaglioVenditeTipo(voce.rinnovi, totaleFatturato),
      },
    ]
    return { mese: m, etichetta, gruppi: voci, totale: totaleFatturato, totaleTesto: euro(totaleFatturato) ?? '—' }
  })

  return (
    <GraficoPerGruppo
      serie={serie}
      legenda={LEGENDA_VENDITE_TIPO}
      etichettaAria="Fatturato venduto, nuovo e rinnovo, ultimi 24 mesi"
    />
  )
}
