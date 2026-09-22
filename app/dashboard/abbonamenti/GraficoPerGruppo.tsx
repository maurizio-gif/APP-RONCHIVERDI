'use client'

import { useState } from 'react'

export type VoceGruppoStack = {
  gruppoId: string | null
  nome: string
  colore: string
  valore: number
  // Testo già formattato (intero per gli attivi, euro per il fatturato) —
  // deciso lato server. Un Client Component non può ricevere una funzione
  // come prop (il confine RSC non serializza le funzioni), quindi il "come
  // si scrive il numero" è già pronto qui, non un formattatore passato giù.
  valoreTesto: string
  // Facoltativa: una seconda riga sotto nome/valore nel pannello di
  // dettaglio (es. "562 vendite · 33%") — ha senso quando il valore
  // principale guida l'altezza della barra (es. il fatturato) ma chi legge
  // vuole anche il conteggio e il peso sul totale del mese, non solo per i
  // grafici più semplici (fatturato/attivi per gruppo) dove resta assente.
  dettaglio?: string
}

export type VoceMeseStack = {
  mese: string
  etichetta: string
  gruppi: VoceGruppoStack[]
  totale: number
  totaleTesto: string
  // Facoltativa: un testo corto sopra la barra (es. "68%") — ha senso per
  // uno stack a due stati come rinnovati/non rinnovati (la % è il numero
  // che conta), non per un fatturato o un conteggio per gruppo, quindi
  // resta assente per quei due grafici invece di forzarla ovunque.
  etichettaSopra?: string
  // La frase completa sotto il totale nel pannello di dettaglio, a spiegare
  // cosa significa etichettaSopra (es. "58% rinnovati sul totale scaduto
  // quel mese") — decisa lato server insieme a lei invece che ricostruita
  // qui con un suffisso fisso, cosa che legherebbe il componente a un solo
  // significato possibile della percentuale.
  notaPercentuale?: string
}

export type VoceLegendaStack = { chiave: string; nome: string; colore: string }

// Barre impilate per gruppo (colori assegnati una volta sola lato server,
// vedi page.tsx — qui il componente disegna soltanto, non decide chi ha che
// colore) con un pannello di dettaglio animato al passaggio del mouse o al
// focus da tastiera: un'unica card mostra TUTTI i gruppi di quel mese, non
// solo il segmento sotto il cursore — altrimenti bisognerebbe azzeccare un
// segmento largo pochi pixel per leggere un numero. Generico sulla
// grandezza: stessa forma sia per gli abbonati attivi (un intero) sia per il
// fatturato (in euro) — `valore`/`totale` (numerici) decidono l'altezza
// delle barre, `valoreTesto`/`totaleTesto` decidono cosa si legge.
export function GraficoPerGruppo({
  serie,
  legenda,
  etichettaAria = 'Andamento per gruppo, ultimi 12 mesi',
}: {
  serie: VoceMeseStack[]
  legenda: VoceLegendaStack[]
  etichettaAria?: string
}) {
  const [indiceAttivo, setIndiceAttivo] = useState<number | null>(null)
  // Posizione del tooltip in pixel (coordinate del viewport, non del
  // contenitore): il tooltip è `position: fixed` per non venire tagliato
  // dallo scroll orizzontale del grafico (vedi il commento su
  // .grafico-attivi-tooltip in globals.css), quindi va ricalcolata sulla
  // colonna effettivamente sotto il cursore/focus a ogni attivazione.
  const [posizioneTooltip, setPosizioneTooltip] = useState<{ left: number; top: number } | null>(null)

  function attivaColonna(i: number, elemento: SVGGElement) {
    const rettangolo = elemento.getBoundingClientRect()
    setPosizioneTooltip({ left: rettangolo.left + rettangolo.width / 2, top: rettangolo.top })
    setIndiceAttivo(i)
  }

  if (serie.length === 0) return null

  const massimo = Math.max(...serie.map((m) => m.totale), 1)
  const larghezzaBarra = 100 / serie.length
  // Uno 0.4 fisso (in unità di viewBox) fra un segmento e l'altro dello
  // stack: separa i gruppi anche quando i colori sono vicini, senza
  // ricorrere a un bordo (che aggiungerebbe inchiostro che non è dato).
  const scarto = 0.4
  // Con l'etichetta sopra la barra le barre restano un po' più basse (26
  // invece di 30 unità), altrimenti sulla colonna più alta il testo
  // finirebbe fuori dal viewBox. Le altre due grafiche di questa pagina non
  // passano etichettaSopra: restano esattamente come prima.
  const haEtichetteSopra = serie.some((m) => m.etichettaSopra)
  const altezzaMassimaBarra = haEtichetteSopra ? 26 : 30

  const meseAttivo = indiceAttivo !== null ? serie[indiceAttivo] : null

  // Le etichette sopra la barra (es. "68%") non stanno dentro l'<svg>: il
  // viewBox è 100×34 con preserveAspectRatio="none", quindi viene stirato
  // in modo diverso in orizzontale e in verticale (il grafico è molto più
  // largo che alto) — un <text> dentro quel sistema di coordinate viene
  // deformato con lui, letteralmente "troppo largo e schiacciato". Le
  // etichette sono invece un overlay HTML, posizionato in percentuale
  // sullo stesso riquadro (l'unità x del viewBox è già una percentuale,
  // essendo largo 100; l'unità y va convertita da una scala 0-34), dove il
  // testo segue le proporzioni normali del font.
  const etichetteSopra: { mese: string; xCentro: number; yTop: number; testo: string }[] = []

  return (
    <div className="grafico grafico-attivi">
      {/* Su schermo stretto le barre non si stringono fino a diventare
          illeggibili: il grafico (barre + etichette dei mesi, insieme
          perché devono restare allineate) prende una larghezza minima e
          scorre in orizzontale, come una tabella larga. */}
      <div className="grafico-scroll">
        <div className="grafico-scroll-contenuto">
          <div className="grafico-attivi-corpo">
            <svg viewBox="0 0 100 34" preserveAspectRatio="none" role="img" aria-label={etichettaAria}>
              {serie.map((m, i) => {
                const x = i * larghezzaBarra + larghezzaBarra * 0.15
                const larghezza = larghezzaBarra * 0.7
                const segmenti = m.gruppi.filter((g) => g.valore > 0)

                let yCorrente = 32
                let ySopraUltimo = 32
                const rettangoli = segmenti.map((g, gi) => {
                  const altezza = massimo > 0 ? (g.valore / massimo) * altezzaMassimaBarra : 0
                  const altezzaResa = Math.max(altezza, 0.6)
                  const yTop = yCorrente - altezzaResa
                  const ultimoSegmento = gi === segmenti.length - 1
                  yCorrente = yTop - scarto
                  if (ultimoSegmento) ySopraUltimo = yTop
                  return (
                    <rect
                      key={g.gruppoId ?? 'non-categorizzato'}
                      x={x}
                      y={yTop}
                      width={larghezza}
                      height={altezzaResa}
                      rx={ultimoSegmento ? 0.6 : 0}
                      style={{ fill: g.colore }}
                    />
                  )
                })

                if (m.etichettaSopra) {
                  etichetteSopra.push({
                    mese: m.mese,
                    xCentro: x + larghezza / 2,
                    yTop: Math.max(ySopraUltimo, 3),
                    testo: m.etichettaSopra,
                  })
                }

                return (
                  <g
                    key={m.mese}
                    className={`grafico-attivi-colonna${indiceAttivo === i ? ' is-attiva' : ''}`}
                    onMouseEnter={(e) => attivaColonna(i, e.currentTarget)}
                    onMouseLeave={() => setIndiceAttivo(null)}
                    onFocus={(e) => attivaColonna(i, e.currentTarget)}
                    onBlur={() => setIndiceAttivo(null)}
                    tabIndex={0}
                    role="button"
                    aria-label={`${m.etichetta}: ${m.totaleTesto} in totale${m.etichettaSopra ? `, ${m.etichettaSopra}` : ''}`}
                  >
                    {/* Rettangolo pieno e invisibile: l'area di hover/focus è
                        tutta la colonna del mese, non solo i pixel dipinti dei
                        segmenti (che per un gruppo piccolo sono pochissimi). */}
                    <rect x={i * larghezzaBarra} y="0" width={larghezzaBarra} height="34" fill="transparent" />
                    {rettangoli}
                  </g>
                )
              })}
              <line x1="0" y1="32" x2="100" y2="32" className="grafico-asse" />
            </svg>

            {etichetteSopra.length > 0 && (
              <div className="grafico-attivi-etichette-sopra" aria-hidden="true">
                {etichetteSopra.map((e) => (
                  <span
                    key={e.mese}
                    className="grafico-attivi-etichetta-sopra"
                    style={{ left: `${e.xCentro}%`, top: `${(e.yTop / 34) * 100}%` }}
                  >
                    {e.testo}
                  </span>
                ))}
              </div>
            )}

            <div
              className={`grafico-attivi-tooltip${meseAttivo ? ' is-visibile' : ''}`}
              style={posizioneTooltip ?? undefined}
              aria-hidden={!meseAttivo}
            >
              {meseAttivo && (
                <>
                  <p className="grafico-attivi-tooltip-mese">{meseAttivo.etichetta}</p>
                  <ul className="grafico-attivi-tooltip-elenco">
                    {meseAttivo.gruppi.map((g) => (
                      <li key={g.gruppoId ?? 'non-categorizzato'}>
                        <span
                          className="grafico-attivi-tooltip-swatch"
                          style={{ background: g.colore }}
                          aria-hidden="true"
                        />
                        <span className="grafico-attivi-tooltip-corpo">
                          <span>
                            <span className="grafico-attivi-tooltip-valore">{g.valoreTesto}</span>{' '}
                            <span className="grafico-attivi-tooltip-nome">{g.nome}</span>
                          </span>
                          {g.dettaglio && <span className="grafico-attivi-tooltip-dettaglio">{g.dettaglio}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="grafico-attivi-tooltip-totale">Totale: {meseAttivo.totaleTesto}</p>
                  {meseAttivo.notaPercentuale && (
                    <p className="grafico-attivi-tooltip-percentuale">{meseAttivo.notaPercentuale}</p>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="grafico-etichette muted">
            {serie.map((m) => (
              <span key={m.mese}>{m.etichetta}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="grafico-legenda muted">
        {legenda.map((v) => (
          <span key={v.chiave}>
            <span className="grafico-legenda-pallino" style={{ background: v.colore }} aria-hidden="true" /> {v.nome}
          </span>
        ))}
      </div>
    </div>
  )
}
