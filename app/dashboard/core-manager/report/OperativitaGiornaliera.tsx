import Link from 'next/link'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { dataBreve, giornoPiu } from '@/lib/agenda'
import {
  CANALI_NEW,
  CANALI_VENDITA,
  ETICHETTE_CANALE,
  azioniTotali,
  caricaOperativita,
  correlazione,
  leggiCorrelazione,
  misureVuote,
  sommaMisure,
  venditeTotali,
  type CanaleVendita,
  type Misure,
  type Operativita,
} from '@/lib/report-operativita'

// La schermata unica della responsabile commerciale: cosa ha fatto ogni
// operatore — New e rinnovi — e quanto ha venduto, nel giorno scelto (o negli
// ultimi 7 o 30), con il confronto sul periodo prima e l'andamento degli
// ultimi 14 giorni. Cosa conta cosa sta in lib/report-operativita.ts.
//
// Dall'alto: i totali, le prestazioni per canale (Walk-in, Sito, Altro New,
// Rinnovi), una riga per operatore, e — cliccando un nome — il giorno per
// giorno di quell'operatore con la correlazione fra quanto lavora e quanto
// vende.

export const PERIODI = [
  { valore: 1, testo: 'Giorno' },
  { valore: 7, testo: '7 giorni' },
  { valore: 30, testo: '30 giorni' },
] as const
export type Periodo = (typeof PERIODI)[number]['valore']

/** Quanti giorni si disegnano nelle barrette dell'andamento. */
const GIORNI_ANDAMENTO = 14

export type RigaStaffReport = {
  email: string
  nome: string | null
  cognome: string | null
  commerciale?: boolean | null
  operatore_segreteria?: boolean | null
}

const formatoEuro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const eur = (v: number) => (v ? formatoEuro.format(v) : '—')
const num = (v: number) => (v ? v.toLocaleString('it-IT') : '—')

/** «+12%» / «−5%» rispetto al periodo prima; «—» quando non c'è da confrontare. */
function delta(attuale: number, prima: number): { testo: string; classe: string } {
  if (prima === 0 && attuale === 0) return { testo: '—', classe: '' }
  if (prima === 0) return { testo: 'nuovo', classe: 'rop-su' }
  const p = Math.round(((attuale - prima) / prima) * 100)
  if (p === 0) return { testo: '=', classe: '' }
  return { testo: `${p > 0 ? '+' : '−'}${Math.abs(p)}%`, classe: p > 0 ? 'rop-su' : 'rop-giu' }
}

function Andamento({ valori, titolo }: { valori: number[]; titolo: string }) {
  const max = Math.max(...valori, 1)
  const largh = 3
  const passo = 4
  const alt = 20
  return (
    <svg
      className="rop-spark"
      width={valori.length * passo}
      height={alt}
      viewBox={`0 0 ${valori.length * passo} ${alt}`}
      role="img"
      aria-label={`${titolo}: ${valori.join(', ')}`}
    >
      <title>{`${titolo}, ultimi ${valori.length} giorni`}</title>
      {valori.map((v, i) => {
        const h = v === 0 ? 1 : Math.max(2, Math.round((v / max) * alt))
        return (
          <rect
            key={i}
            x={i * passo}
            y={alt - h}
            width={largh}
            height={h}
            className={i === valori.length - 1 ? 'rop-barra rop-barra-oggi' : v === 0 ? 'rop-barra rop-barra-zero' : 'rop-barra'}
          />
        )
      })}
    </svg>
  )
}

export async function OperativitaGiornaliera({
  giorno,
  periodo,
  oggi,
  operatoreScelto,
  href,
  staff,
}: {
  giorno: string
  periodo: Periodo
  oggi: string
  operatoreScelto: string | null
  /** Il link con i parametri cambiati (null toglie il parametro). */
  href: (p: { giorno?: string; periodo?: Periodo; operatore?: string | null }) => string
  staff: RigaStaffReport[]
}) {
  const supabase = createSupabaseServiceClient()
  const giorniCaricati = Math.max(periodo * 2, GIORNI_ANDAMENTO)
  const da = giornoPiu(giorno, -(giorniCaricati - 1))
  const dati: Operativita = await caricaOperativita(supabase, da, giorno)

  const giorniAttuali = dati.giorni.slice(-periodo)
  const giorniPrima = dati.giorni.slice(-periodo * 2, -periodo)
  const giorniAndamento = dati.giorni.slice(-GIORNI_ANDAMENTO)
  // Il giorno per giorno dell'operatore: il periodo, o almeno due settimane.
  const giorniDettaglio = dati.giorni.slice(-Math.max(periodo, GIORNI_ANDAMENTO))

  // Chi compare: tutti i commerciali e gli operatori dei rinnovi, anche a
  // zero (vedere chi non ha fatto niente è parte della domanda), più chiunque
  // abbia fatto qualcosa nel periodo caricato.
  const staffPerEmail = new Map(staff.map((s) => [s.email.toLowerCase(), s]))
  const operatori = new Set<string>()
  for (const s of staff) if (s.commerciale || s.operatore_segreteria) operatori.add(s.email.toLowerCase())
  for (const delGiorno of dati.perGiorno.values()) for (const e of delGiorno.keys()) operatori.add(e)

  const nome = (email: string) => {
    const s = staffPerEmail.get(email)
    const completo = [s?.nome, s?.cognome].filter(Boolean).join(' ').trim()
    return completo || email
  }
  const reparto = (email: string) => {
    const s = staffPerEmail.get(email)
    if (s?.commerciale && s?.operatore_segreteria) return 'New + Rinnovi'
    if (s?.commerciale) return 'New'
    if (s?.operatore_segreteria) return 'Rinnovi'
    return ''
  }

  const misureDi = (email: string, giorni: string[]): Misure =>
    sommaMisure(giorni.map((g) => dati.perGiorno.get(g)?.get(email) ?? misureVuote()))

  const righe = [...operatori]
    .map((email) => {
      const m = misureDi(email, giorniAttuali)
      const prima = misureDi(email, giorniPrima)
      return {
        email,
        m,
        prima,
        azioni: azioniTotali(m),
        vendite: venditeTotali(m),
        andamentoAzioni: giorniAndamento.map((g) => {
          const x = dati.perGiorno.get(g)?.get(email)
          return x ? azioniTotali(x) : 0
        }),
        andamentoEuro: giorniAndamento.map((g) => {
          const x = dati.perGiorno.get(g)?.get(email)
          return x ? venditeTotali(x).euro : 0
        }),
      }
    })
    .sort(
      (a, b) =>
        b.vendite.euro - a.vendite.euro || b.azioni - a.azioni || nome(a.email).localeCompare(nome(b.email), 'it')
    )

  const totale = sommaMisure(righe.map((r) => r.m))
  const totalePrima = sommaMisure(righe.map((r) => r.prima))
  const azioniTot = azioniTotali(totale)
  const venditeTot = venditeTotali(totale)
  const azioniPrima = azioniTotali(totalePrima)
  const venditePrima = venditeTotali(totalePrima)

  const leadPeriodo = (canale: (typeof CANALI_NEW)[number]) =>
    giorniAttuali.reduce((s, g) => s + (dati.lead.get(g)?.[canale] ?? 0), 0)

  const scelto = operatoreScelto && operatori.has(operatoreScelto.toLowerCase()) ? operatoreScelto.toLowerCase() : null

  // La correlazione fra quanto si lavora e quanto si vende, giorno per giorno:
  // un punto per ogni giorno in cui l'operatore ha fatto o venduto qualcosa.
  function puntiCorrelazione(email: string | null) {
    const x: number[] = []
    const y: number[] = []
    for (const g of giorniDettaglio) {
      const delGiorno = dati.perGiorno.get(g)
      if (!delGiorno) continue
      for (const [e, m] of delGiorno) {
        if (email && e !== email) continue
        const az = azioniTotali(m)
        const v = venditeTotali(m).euro
        if (az === 0 && v === 0) continue
        x.push(az)
        y.push(v)
      }
    }
    return { x, y }
  }
  const puntiSquadra = puntiCorrelazione(null)
  const rSquadra = correlazione(puntiSquadra.x, puntiSquadra.y)
  const puntiScelto = scelto ? puntiCorrelazione(scelto) : null
  const rScelto = puntiScelto ? correlazione(puntiScelto.x, puntiScelto.y) : null

  const periodoTesto =
    periodo === 1
      ? giorno === oggi
        ? 'oggi'
        : dataBreve(giorno)
      : `ultimi ${periodo} giorni fino al ${dataBreve(giorno)}`
  const confrontoTesto = periodo === 1 ? 'giorno prima' : `${periodo} giorni prima`

  const dAzioni = delta(azioniTot, azioniPrima)
  const dEuro = delta(venditeTot.euro, venditePrima.euro)
  const dVendite = delta(venditeTot.n, venditePrima.n)

  return (
    <>
      <div className="card rop-controlli">
        <div className="rop-nav" role="group" aria-label="Giorno">
          <Link className="btn btn-ghost btn-sm" href={href({ giorno: giornoPiu(giorno, -1) })} scroll={false}>
            ← Giorno prima
          </Link>
          <form action="/dashboard/core-manager/report" className="rop-data">
            <input type="date" name="giorno" defaultValue={giorno} max={oggi} aria-label="Scegli il giorno" />
            <input type="hidden" name="periodo" value={periodo} />
            {scelto && <input type="hidden" name="operatore" value={scelto} />}
            <button className="btn btn-ghost btn-sm" type="submit">
              Vai
            </button>
          </form>
          <Link
            className="btn btn-ghost btn-sm"
            href={href({ giorno: giornoPiu(giorno, 1) })}
            aria-disabled={giorno >= oggi}
            style={giorno >= oggi ? { pointerEvents: 'none', opacity: 0.4 } : undefined}
            scroll={false}
          >
            Giorno dopo →
          </Link>
          {giorno !== oggi && (
            <Link className="btn btn-sm" href={href({ giorno: oggi })} scroll={false}>
              Oggi
            </Link>
          )}
        </div>
        <div className="check-sosp-gruppo" role="group" aria-label="Periodo">
          {PERIODI.map((p) => (
            <Link
              key={p.valore}
              href={href({ periodo: p.valore })}
              className={`chip${periodo === p.valore ? ' is-attivo' : ''}`}
              aria-current={periodo === p.valore ? 'true' : undefined}
              scroll={false}
            >
              {p.testo}
            </Link>
          ))}
        </div>
      </div>

      <div className="griglia-stat">
        <div className="stat">
          <span className="stat-label">Azioni · {periodoTesto}</span>
          <span className="stat-valore">{azioniTot.toLocaleString('it-IT')}</span>
          <span className="stat-nota">
            <span className={dAzioni.classe}>{dAzioni.testo}</span> sul {confrontoTesto}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Vendite</span>
          <span className="stat-valore">{venditeTot.n.toLocaleString('it-IT')}</span>
          <span className="stat-nota">
            <span className={dVendite.classe}>{dVendite.testo}</span> sul {confrontoTesto}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Venduto</span>
          <span className="stat-valore">{formatoEuro.format(venditeTot.euro)}</span>
          <span className="stat-nota">
            <span className={dEuro.classe}>{dEuro.testo}</span> sul {confrontoTesto}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Resa</span>
          <span className="stat-valore">
            {venditeTot.n ? (azioniTot / venditeTot.n).toLocaleString('it-IT', { maximumFractionDigits: 1 }) : '—'}
          </span>
          <span className="stat-nota">
            azioni per vendita
            {azioniTot > 0 && venditeTot.euro > 0 && (
              <>
                {' · '}
                {(venditeTot.euro / azioniTot).toLocaleString('it-IT', { maximumFractionDigits: 0 })} € per azione
              </>
            )}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Per canale</h2>
          <span className="muted">{periodoTesto}</span>
        </div>
        <div className="tabella-wrap">
          <table className="tabella tabella-compatta">
            <thead>
              <tr>
                <th>Canale</th>
                <th className="cella-importo" title="Trattative nate nel periodo su quel canale">
                  Lead arrivati
                </th>
                <th className="cella-importo">Vendite</th>
                <th className="cella-importo">Venduto</th>
                <th className="cella-importo">Ticket medio</th>
                <th className="cella-importo" title="Vendite del periodo su lead arrivati nel periodo: indicativa, le vendite possono venire da lead di giorni prima">
                  Vendite / lead
                </th>
                <th className="cella-importo">Venduto vs {confrontoTesto}</th>
              </tr>
            </thead>
            <tbody>
              {CANALI_VENDITA.map((c: CanaleVendita) => {
                const v = totale.vendite[c]
                const vPrima = totalePrima.vendite[c]
                const lead = c === 'rinnovi' ? null : leadPeriodo(c)
                const d = delta(v.euro, vPrima.euro)
                return (
                  <tr key={c}>
                    <td>
                      <strong>{ETICHETTE_CANALE[c]}</strong>
                    </td>
                    <td className="cella-importo">{lead === null ? '—' : num(lead)}</td>
                    <td className="cella-importo">{num(v.n)}</td>
                    <td className="cella-importo">{eur(v.euro)}</td>
                    <td className="cella-importo">{v.n ? eur(v.euro / v.n) : '—'}</td>
                    <td className="cella-importo">
                      {lead ? `${Math.round((v.n / lead) * 100)}%` : '—'}
                    </td>
                    <td className="cella-importo">
                      <span className={d.classe}>{d.testo}</span>
                    </td>
                  </tr>
                )
              })}
              <tr className="rop-totale">
                <td>
                  <strong>Totale</strong>
                </td>
                <td className="cella-importo">{num(CANALI_NEW.reduce((s, c) => s + leadPeriodo(c), 0))}</td>
                <td className="cella-importo">
                  <strong>{num(venditeTot.n)}</strong>
                </td>
                <td className="cella-importo">
                  <strong>{eur(venditeTot.euro)}</strong>
                </td>
                <td className="cella-importo">{venditeTot.n ? eur(venditeTot.euro / venditeTot.n) : '—'}</td>
                <td className="cella-importo">—</td>
                <td className="cella-importo">
                  <span className={dEuro.classe}>{dEuro.testo}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Per operatore</h2>
          <span className="muted">{periodoTesto}</span>
        </div>
        <div className="tabella-wrap">
          <table className="tabella tabella-compatta rop-tabella">
            <thead>
              <tr className="rop-gruppi">
                <th rowSpan={2}>Operatore</th>
                <th colSpan={8} className="rop-gruppo">
                  Azioni
                </th>
                <th colSpan={5} className="rop-gruppo">
                  Vendite
                </th>
                <th colSpan={2} className="rop-gruppo">
                  Resa
                </th>
                <th colSpan={4} className="rop-gruppo">
                  Andamento
                </th>
              </tr>
              <tr>
                <th className="cella-importo" title="Telefonate chiuse, anche senza risposta">Tel.</th>
                <th className="cella-importo" title="Visite in sede svolte">Visite</th>
                <th className="cella-importo" title="Email, WhatsApp e messaggi o «Richiamami» dal sito lavorati">Msg.</th>
                <th className="cella-importo" title="Altri task chiusi">Altre</th>
                <th className="cella-importo" title="Walk-in registrati al banco con questo operatore">Walk-in acc.</th>
                <th className="cella-importo" title="Note scritte sulle scadenze Core: azioni rinnovo">Note rinn.</th>
                <th className="cella-importo" title="Trattative prese in carico">Prese</th>
                <th className="cella-importo">Totale</th>
                <th className="cella-importo" title="Trattative vinte da un lead walk-in">Walk-in</th>
                <th className="cella-importo" title="Trattative vinte da una richiesta dal sito">Sito</th>
                <th className="cella-importo" title="Agenda, phone-in, eventi, recupero dei mancati rinnovi">Altro New</th>
                <th className="cella-importo" title="Rinnovi di scadenze Core assegnate all'operatore">Rinnovi</th>
                <th className="cella-importo">Totale</th>
                <th className="cella-importo" title="Azioni fatte per ogni vendita">Az./vendita</th>
                <th className="cella-importo" title="Euro venduti per ogni azione">€/azione</th>
                <th title="Azioni, ultimi 14 giorni">Azioni</th>
                <th title="Venduto, ultimi 14 giorni">Venduto</th>
                <th className="cella-importo" title={`Azioni rispetto al ${confrontoTesto}`}>Δ az.</th>
                <th className="cella-importo" title={`Venduto rispetto al ${confrontoTesto}`}>Δ €</th>
              </tr>
            </thead>
            <tbody>
              {righe.map((r) => {
                const dA = delta(r.azioni, azioniTotali(r.prima))
                const dE = delta(r.vendite.euro, venditeTotali(r.prima).euro)
                return (
                  <tr key={r.email} className={r.email === scelto ? 'is-oggi' : ''}>
                    <td className="cella-nowrap">
                      <Link href={`${href({ operatore: r.email })}#dettaglio`} scroll={false}>
                        {nome(r.email)}
                      </Link>
                      {reparto(r.email) && <span className="nota-in-riga">{reparto(r.email)}</span>}
                    </td>
                    <td className="cella-importo">{num(r.m.tel)}</td>
                    <td className="cella-importo">{num(r.m.visite)}</td>
                    <td className="cella-importo">{num(r.m.msg)}</td>
                    <td className="cella-importo">{num(r.m.altre)}</td>
                    <td className="cella-importo">{num(r.m.walkinAccolti)}</td>
                    <td className="cella-importo">{num(r.m.noteRinnovo)}</td>
                    <td className="cella-importo">{num(r.m.prese)}</td>
                    <td className="cella-importo">
                      <strong>{num(r.azioni)}</strong>
                    </td>
                    {CANALI_VENDITA.map((c) => (
                      <td key={c} className="cella-importo" title={r.m.vendite[c].n ? eur(r.m.vendite[c].euro) : undefined}>
                        {r.m.vendite[c].n ? `${r.m.vendite[c].n} · ${eur(r.m.vendite[c].euro)}` : '—'}
                      </td>
                    ))}
                    <td className="cella-importo">
                      {r.vendite.n ? (
                        <strong>
                          {r.vendite.n} · {eur(r.vendite.euro)}
                        </strong>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="cella-importo">
                      {r.vendite.n ? (r.azioni / r.vendite.n).toLocaleString('it-IT', { maximumFractionDigits: 1 }) : '—'}
                    </td>
                    <td className="cella-importo">
                      {r.azioni && r.vendite.euro
                        ? (r.vendite.euro / r.azioni).toLocaleString('it-IT', { maximumFractionDigits: 0 })
                        : '—'}
                    </td>
                    <td>
                      <Andamento valori={r.andamentoAzioni} titolo={`Azioni di ${nome(r.email)}`} />
                    </td>
                    <td>
                      <Andamento valori={r.andamentoEuro} titolo={`Venduto di ${nome(r.email)}`} />
                    </td>
                    <td className="cella-importo">
                      <span className={dA.classe}>{dA.testo}</span>
                    </td>
                    <td className="cella-importo">
                      <span className={dE.classe}>{dE.testo}</span>
                    </td>
                  </tr>
                )
              })}
              <tr className="rop-totale">
                <td>
                  <strong>Totale</strong>
                </td>
                <td className="cella-importo">{num(totale.tel)}</td>
                <td className="cella-importo">{num(totale.visite)}</td>
                <td className="cella-importo">{num(totale.msg)}</td>
                <td className="cella-importo">{num(totale.altre)}</td>
                <td className="cella-importo">{num(totale.walkinAccolti)}</td>
                <td className="cella-importo">{num(totale.noteRinnovo)}</td>
                <td className="cella-importo">{num(totale.prese)}</td>
                <td className="cella-importo">
                  <strong>{num(azioniTot)}</strong>
                </td>
                {CANALI_VENDITA.map((c) => (
                  <td key={c} className="cella-importo">
                    {totale.vendite[c].n ? `${totale.vendite[c].n} · ${eur(totale.vendite[c].euro)}` : '—'}
                  </td>
                ))}
                <td className="cella-importo">
                  <strong>{venditeTot.n ? `${venditeTot.n} · ${eur(venditeTot.euro)}` : '—'}</strong>
                </td>
                <td className="cella-importo">
                  {venditeTot.n ? (azioniTot / venditeTot.n).toLocaleString('it-IT', { maximumFractionDigits: 1 }) : '—'}
                </td>
                <td className="cella-importo">
                  {azioniTot && venditeTot.euro
                    ? (venditeTot.euro / azioniTot).toLocaleString('it-IT', { maximumFractionDigits: 0 })
                    : '—'}
                </td>
                <td colSpan={2}></td>
                <td className="cella-importo">
                  <span className={dAzioni.classe}>{dAzioni.testo}</span>
                </td>
                <td className="cella-importo">
                  <span className={dEuro.classe}>{dEuro.testo}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="field-hint">
          Clicca un nome per vedere il suo giorno per giorno.{' '}
          <strong>
            {leggiCorrelazione(rSquadra)}
            {rSquadra !== null && ` (r = ${rSquadra.toLocaleString('it-IT', { maximumFractionDigits: 2 })})`}
          </strong>{' '}
          fra azioni e venduto, sui giorni di attività degli ultimi {giorniDettaglio.length} giorni di tutta la squadra.
        </p>
      </div>

      {scelto && (
        <div className="card" id="dettaglio">
          <div className="card-head">
            <h2>{nome(scelto)}</h2>
            <Link className="link" href={href({ operatore: null })} scroll={false}>
              Chiudi
            </Link>
          </div>
          <p className="muted">
            Giorno per giorno, ultimi {giorniDettaglio.length} giorni.{' '}
            <strong>
              {leggiCorrelazione(rScelto)}
              {rScelto !== null && ` (r = ${rScelto.toLocaleString('it-IT', { maximumFractionDigits: 2 })})`}
            </strong>{' '}
            fra le sue azioni e il suo venduto
            {rScelto === null && puntiScelto && puntiScelto.x.length < 8 ? ' (servono almeno 8 giorni di attività)' : ''}
            . Il venduto di un giorno spesso viene dal lavoro dei giorni prima: la correlazione dà un ordine di
            grandezza, non una misura esatta.
          </p>
          <div className="tabella-wrap">
            <table className="tabella tabella-compatta rop-tabella">
              <thead>
                <tr>
                  <th>Giorno</th>
                  <th className="cella-importo">Tel.</th>
                  <th className="cella-importo">Visite</th>
                  <th className="cella-importo">Msg.</th>
                  <th className="cella-importo">Altre</th>
                  <th className="cella-importo">Walk-in acc.</th>
                  <th className="cella-importo">Note rinn.</th>
                  <th className="cella-importo">Prese</th>
                  <th className="cella-importo">Azioni</th>
                  <th className="cella-importo">Walk-in</th>
                  <th className="cella-importo">Sito</th>
                  <th className="cella-importo">Altro New</th>
                  <th className="cella-importo">Rinnovi</th>
                  <th className="cella-importo">Venduto</th>
                </tr>
              </thead>
              <tbody>
                {[...giorniDettaglio].reverse().map((g) => {
                  const m = dati.perGiorno.get(g)?.get(scelto) ?? misureVuote()
                  const v = venditeTotali(m)
                  return (
                    <tr key={g} className={g === oggi ? 'is-oggi' : ''}>
                      <td className="cella-nowrap">{dataBreve(g)}</td>
                      <td className="cella-importo">{num(m.tel)}</td>
                      <td className="cella-importo">{num(m.visite)}</td>
                      <td className="cella-importo">{num(m.msg)}</td>
                      <td className="cella-importo">{num(m.altre)}</td>
                      <td className="cella-importo">{num(m.walkinAccolti)}</td>
                      <td className="cella-importo">{num(m.noteRinnovo)}</td>
                      <td className="cella-importo">{num(m.prese)}</td>
                      <td className="cella-importo">
                        <strong>{num(azioniTotali(m))}</strong>
                      </td>
                      {CANALI_VENDITA.map((c) => (
                        <td key={c} className="cella-importo">
                          {m.vendite[c].n ? `${m.vendite[c].n} · ${eur(m.vendite[c].euro)}` : '—'}
                        </td>
                      ))}
                      <td className="cella-importo">
                        <strong>{eur(v.euro)}</strong>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
