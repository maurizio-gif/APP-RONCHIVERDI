import {
  CHIAVE_SENZA_GRUPPO,
  COLORE_SENZA_GRUPPO,
  ETICHETTA_SENZA_GRUPPO,
  GIORNI_SETTIMANA,
  ORE_MAPPA,
  direzioneDelta,
  etichettaPeriodo,
  numero,
  oraTesto,
  testoDelta,
  type CellaCalore,
  type FasciaFedelta,
  type Gruppo,
  type Passo,
  type PuntoSerie,
} from '@/lib/accessi'

// I grafici della sezione Accessi. SVG e HTML scritti a mano, senza librerie
// (come i grafici di Direzione) e senza JavaScript nel browser: sono Server
// Component, il dettaglio di ogni barra sta nel suo <title>. Colori solo dai
// token del tema, tranne quelli dei gruppi, che sono un dato scelto da chi li
// crea. Le animazioni d'ingresso si spengono con prefers-reduced-motion.

// ──────────────────────────────────────────────────────────── scheda numero

export function Sparkline({ valori, etichetta }: { valori: number[]; etichetta: string }) {
  if (valori.length < 2) return null
  // Da minimo a massimo, non da zero: su numeri grandi che oscillano poco
  // la linea sarebbe piatta, e a una scheda numero serve vedere la tendenza.
  const minimo = Math.min(...valori)
  const escursione = Math.max(...valori) - minimo || 1
  const punti = valori.map((v, i) => `${(i / (valori.length - 1)) * 100},${27 - ((v - minimo) / escursione) * 23}`)
  return (
    <svg className="accessi-spark" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={etichetta}>
      <polygon points={`0,30 ${punti.join(' ')} 100,30`} className="accessi-spark-area" />
      <polyline points={punti.join(' ')} className="accessi-spark-linea" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function SchedaNumero({
  etichetta,
  valore,
  attuale,
  precedente,
  dettaglio,
  serie,
}: {
  etichetta: string
  valore: string
  /** Il numero con cui si calcola il confronto, se diverso da quello scritto. */
  attuale?: number
  precedente?: number | null
  dettaglio?: string
  serie?: number[]
}) {
  const confrontabile = attuale !== undefined && precedente !== undefined
  const direzione = confrontabile ? direzioneDelta(attuale, precedente) : 'piano'
  return (
    <div className="accessi-numero">
      <span className="accessi-numero-etichetta muted">{etichetta}</span>
      <strong className="accessi-numero-valore">{valore}</strong>
      <span className="accessi-numero-sotto">
        {confrontabile && (
          <span className={`accessi-delta accessi-delta-${direzione}`} title="Rispetto al periodo precedente di pari durata">
            {direzione === 'su' ? '▲ ' : direzione === 'giu' ? '▼ ' : ''}
            {testoDelta(attuale, precedente)}
          </span>
        )}
        {dettaglio && <span className="muted"> {dettaglio}</span>}
      </span>
      {serie && <Sparkline valori={serie} etichetta={`Andamento: ${etichetta}`} />}
    </div>
  )
}

// ───────────────────────────────────────────────────────── tendenza a barre

/**
 * Passaggi per periodo, a barre impilate per gruppo di varchi, con la linea
 * del periodo precedente sopra (allineata per posizione). Chi non ha gruppi
 * vede una barra sola.
 */
export function GraficoTendenza({
  serie,
  precedente,
  gruppi,
  passo,
}: {
  serie: PuntoSerie[]
  precedente: PuntoSerie[] | null
  gruppi: Gruppo[]
  passo: Passo
}) {
  if (serie.length === 0) return null
  const L = 600
  const A = 200
  const base = A - 6
  const n = serie.length
  const massimo = Math.max(...serie.map((p) => p.totale), ...(precedente ?? []).map((p) => p.totale), 1)
  const larghezza = L / n
  const spessore = larghezza * 0.72
  const ordine = [...gruppi.map((g) => g.id), CHIAVE_SENZA_GRUPPO]
  const colore = (id: string) => gruppi.find((g) => g.id === id)?.colore ?? COLORE_SENZA_GRUPPO
  const nome = (id: string) => gruppi.find((g) => g.id === id)?.nome ?? ETICHETTA_SENZA_GRUPPO
  const yDi = (v: number) => base - (v / massimo) * (base - 8)

  // Ogni quante etichette scriverne una, per non sovrapporle.
  const ogni = Math.max(1, Math.ceil(n / 8))
  const linea = precedente
    ? serie.map((_, i) => (precedente[i] ? `${i * larghezza + larghezza / 2},${yDi(precedente[i].totale)}` : null)).filter(Boolean)
    : []
  const usati = ordine.filter((id) => serie.some((p) => (p.perGruppo[id] ?? 0) > 0))

  // Il suggerimento di una barra: il periodo, il totale, il dettaglio per
  // gruppo (solo se i gruppi sono più d'uno) e il confronto.
  const titoloBarra = (p: PuntoSerie, prec: PuntoSerie | undefined) =>
    [
      `${etichettaPeriodo(p.periodo, passo, true)}: ${numero(p.totale)} passaggi`,
      ...(usati.length > 1 ? usati.filter((id) => (p.perGruppo[id] ?? 0) > 0).map((id) => `${nome(id)}: ${numero(p.perGruppo[id])}`) : []),
      ...(prec ? [`Periodo precedente: ${numero(prec.totale)}`] : []),
    ].join('\n')

  return (
    <div className="accessi-grafico">
      <div className="accessi-grafico-tela">
        <span className="accessi-grafico-max muted">{numero(massimo)}</span>
        <svg viewBox={`0 0 ${L} ${A}`} preserveAspectRatio="none" role="img" aria-label="Passaggi ai varchi per periodo">
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1="0" x2={L} y1={yDi(massimo * f)} y2={yDi(massimo * f)} className="accessi-griglia" vectorEffect="non-scaling-stroke" />
          ))}
          {serie.map((p, i) => {
            let y = base
            const x = i * larghezza + (larghezza - spessore) / 2
            const prec = precedente?.[i]
            return (
              <g key={p.periodo} className="accessi-colonna" style={{ animationDelay: `${Math.min(i * 12, 400)}ms` }}>
                <rect x={i * larghezza} y={0} width={larghezza} height={A} fill="transparent" />
                {ordine.map((id) => {
                  const v = p.perGruppo[id] ?? 0
                  if (v <= 0) return null
                  const h = (v / massimo) * (base - 8)
                  y -= h
                  return <rect key={id} x={x} y={y} width={spessore} height={h} fill={colore(id)} rx={1} />
                })}
                <title>{titoloBarra(p, prec)}</title>
              </g>
            )
          })}
          <line x1="0" x2={L} y1={base} y2={base} className="accessi-asse" vectorEffect="non-scaling-stroke" />
          {linea.length > 1 && (
            <polyline points={linea.join(' ')} className="accessi-linea-prec" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      </div>
      <div className="accessi-grafico-etichette muted">
        {serie.map((p, i) => (
          <span key={p.periodo} style={{ visibility: i % ogni === 0 ? 'visible' : 'hidden' }}>
            {etichettaPeriodo(p.periodo, passo)}
          </span>
        ))}
      </div>
      <div className="accessi-legenda">
        {usati.length > 1 &&
          usati.map((id) => (
            <span key={id}>
              <i className="accessi-pallino" style={{ background: colore(id) }} /> {nome(id)}
            </span>
          ))}
        {precedente && (
          <span>
            <i className="accessi-pallino accessi-pallino-linea" /> Periodo precedente
          </span>
        )}
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────── mappa calore

/**
 * Quando c'è gente: i giorni della settimana per le ore del giorno, scuro
 * dove l'affluenza media è più alta. La media è passaggi diviso i giorni di
 * quel tipo nel periodo, così un periodo con cinque lunedì e quattro martedì
 * non falsa il confronto. Restituisce anche il picco, per le frasi sotto.
 */
export function MappaCalore({ celle }: { celle: CellaCalore[] }) {
  const media = (c: CellaCalore | undefined) => (c && c.giorni > 0 ? c.passaggi / c.giorni : 0)
  const per = new Map(celle.map((c) => [`${c.giornoSettimana}-${c.ora}`, c]))
  const massimo = Math.max(...celle.map(media), 1)
  const picco = celle.reduce<CellaCalore | undefined>((m, c) => (media(c) > media(m) ? c : m), undefined)
  if (celle.length === 0) return <p className="vuoto">Nessun passaggio nel periodo.</p>
  return (
    <div className="accessi-calore" role="img" aria-label="Affluenza media per giorno della settimana e ora">
      <div className="accessi-calore-griglia" style={{ ['--ore' as string]: ORE_MAPPA.length }}>
        <span />
        {ORE_MAPPA.map((o) => (
          <span key={o} className={`accessi-calore-ora muted ${o % 2 ? 'is-dispari' : ''}`}>
            {o}
          </span>
        ))}
        {GIORNI_SETTIMANA.map((nomeGiorno, i) => (
          <Riga key={nomeGiorno} giorno={nomeGiorno} indice={i + 1} per={per} massimo={massimo} picco={picco} media={media} />
        ))}
      </div>
      <div className="accessi-calore-legenda muted">
        <span>meno</span>
        <span className="accessi-calore-scala" />
        <span>più passaggi all&apos;ora</span>
      </div>
    </div>
  )
}

function Riga({
  giorno,
  indice,
  per,
  massimo,
  picco,
  media,
}: {
  giorno: string
  indice: number
  per: Map<string, CellaCalore>
  massimo: number
  picco: CellaCalore | undefined
  media: (c: CellaCalore | undefined) => number
}) {
  return (
    <>
      <span className="accessi-calore-giorno" title={giorno}>
        <span className="accessi-calore-lungo">{giorno}</span>
        <span className="accessi-calore-corto">{giorno.slice(0, 3)}</span>
      </span>
      {ORE_MAPPA.map((ora) => {
        const c = per.get(`${indice}-${ora}`)
        const m = media(c)
        const eccezionale = picco && c && picco.giornoSettimana === c.giornoSettimana && picco.ora === c.ora
        return (
          <span
            key={ora}
            className={`accessi-calore-cella ${eccezionale ? 'is-picco' : ''}`}
            style={{ ['--intensita' as string]: `${Math.round((m / massimo) * 100)}%` }}
            title={`${giorno} ${oraTesto(ora)}: ${m >= 10 ? Math.round(m) : m.toFixed(1).replace('.', ',')} passaggi in media (${numero(c?.passaggi ?? 0)} in tutto)`}
          />
        )
      })}
    </>
  )
}

// ─────────────────────────────────────────────────────── barre orizzontali

export type VoceBarra = { chiave: string; etichetta: string; valore: number; colore?: string; nota?: string }

/** Una barra per voce, lunga come il suo peso sul massimo. `percentuale` mostra anche la quota sul totale. */
export function BarreOrizzontali({
  voci,
  percentuale = true,
  vuoto = 'Niente da mostrare nel periodo.',
  formato = numero,
}: {
  voci: VoceBarra[]
  percentuale?: boolean
  vuoto?: string
  formato?: (n: number) => string
}) {
  const massimo = Math.max(...voci.map((v) => v.valore), 1)
  const totale = voci.reduce((s, v) => s + v.valore, 0)
  if (voci.length === 0 || totale === 0) return <p className="vuoto">{vuoto}</p>
  return (
    <ul className="accessi-barre">
      {voci.map((v, i) => (
        <li key={v.chiave} title={`${v.etichetta}: ${formato(v.valore)}`}>
          <span className="accessi-barre-etichetta">
            {v.etichetta}
            {v.nota && <span className="muted"> · {v.nota}</span>}
          </span>
          <span className="accessi-barre-pista">
            <span
              className="accessi-barre-barra"
              style={{ width: `${(v.valore / massimo) * 100}%`, background: v.colore ?? 'var(--accent)', animationDelay: `${i * 40}ms` }}
            />
          </span>
          <span className="accessi-barre-valore">
            {formato(v.valore)}
            {percentuale && totale > 0 && v.valore > 0 && <span className="muted"> · {Math.round((v.valore / totale) * 100)}%</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

// ───────────────────────────────────────────────────────────────── fedeltà

/** Quante persone vengono con quale frequenza (giorni al mese in media). */
export function IstogrammaFedelta({ fasce }: { fasce: FasciaFedelta[] }) {
  const tutte = ['meno di 1', '1–3', '4–7', '8–11', '12–15', '16 e più'].map((f, i) => ({
    fascia: f,
    persone: fasce.find((x) => x.ordine === i + 1)?.persone ?? 0,
  }))
  const massimo = Math.max(...tutte.map((f) => f.persone), 1)
  const totale = tutte.reduce((s, f) => s + f.persone, 0)
  if (totale === 0) return <p className="vuoto">Nessun ingresso nel periodo.</p>
  return (
    <div className="accessi-istogramma" role="img" aria-label="Persone per frequenza media mensile">
      {tutte.map((f, i) => (
        <div key={f.fascia} className="accessi-istogramma-colonna" title={`${f.fascia} giorni al mese: ${numero(f.persone)} persone`}>
          <span className="accessi-istogramma-valore">{numero(f.persone)}</span>
          <span className="accessi-istogramma-pista">
            <span className="accessi-istogramma-barra" style={{ height: `${(f.persone / massimo) * 100}%`, animationDelay: `${i * 60}ms` }} />
          </span>
          <span className="accessi-istogramma-etichetta muted">{f.fascia}</span>
        </div>
      ))}
      <p className="muted accessi-istogramma-nota">Giorni di presenza al mese, in media</p>
    </div>
  )
}
