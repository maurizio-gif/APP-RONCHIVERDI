import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { ATTIVITA_IN_AGENDA } from '@/lib/richieste'
import { euro, type StatoTrattativa } from '@/lib/pipeline'
import { oggiRoma, giornoPiu, primoDelMese } from '@/lib/agenda'
import { durataLavorativa, msLavorativi } from '@/lib/orarioLavorativo'
import { mappaNomiStaff, nomeDiEmail, ordinaPerCognome, type RigaStaff } from '@/lib/staff'
import { COLONNE_NOTA_VINTA, conColonneNuove } from '@/lib/migrazioni'

export const dynamic = 'force-dynamic'

// Core Manager: il lavoro del settore core visto dalla responsabile.
//
// Non è un secondo Riepilogo. Il Riepilogo risponde a «cosa devo fare io»; qui
// la domanda è **«come è distribuito il lavoro fra le persone»**, ed è una
// domanda che nessuna pagina del pannello poteva rispondere: le trattative si
// vedevano una per una, gli eventi per giornata, e per sapere se una collega
// aveva in mano il triplo delle altre bisognava contare a mano.
//
// Quattro numeri, e sono quattro squilibri diversi:
//
//   1. **quante opportunità ha ciascuno adesso** — lo squilibrio di carico. È
//      quello che si vede a occhio in fondo al mese, quando una persona non
//      chiude più niente perché ha trenta pratiche aperte;
//   2. **quanto ci mette a prenderle in carico** — lo squilibrio di reattività.
//      Un lead richiamato dopo tre giorni è un lead perso, e la media per
//      persona dice se è un problema di carico o di abitudine;
//   3. **quanti eventi ha assegnati e quanti ne ha eseguiti** — le due
//      colonne separate perché sono due fatti diversi: chi esegue molto più
//      di quanto ha assegnato sta coprendo i turni di qualcun altro, e chi ha
//      assegnato molto più di quanto esegue sta accumulando arretrato;
//   4. **cosa ha chiuso, e per quanto** — il risultato. Senza il valore le
//      vinte si contano e non si pesano, e tre abbonamenti Flex non sono un
//      Club Full.
//
// I numeri sono **per periodo**, tranne le opportunità aperte: quelle sono una
// fotografia di adesso, perché «quante ne hai in mano» non ha un periodo.

/** I periodi offerti. `oggi` è il primo perché è la domanda di fine giornata. */
const PERIODI = [
  { chiave: 'oggi', etichetta: 'Oggi' },
  { chiave: '7', etichetta: 'Ultimi 7 giorni' },
  { chiave: '30', etichetta: 'Ultimi 30 giorni' },
  { chiave: 'mese', etichetta: 'Questo mese' },
] as const

type ChiavePeriodo = (typeof PERIODI)[number]['chiave']

function eiPeriodoValido(v: string | undefined): v is ChiavePeriodo {
  return !!v && PERIODI.some((p) => p.chiave === v)
}

/** Il primo giorno del periodo, compreso. L'ultimo è sempre oggi. */
function inizioDi(periodo: ChiavePeriodo, oggi: string): string {
  if (periodo === 'oggi') return oggi
  if (periodo === 'mese') return primoDelMese(oggi)
  return giornoPiu(oggi, -(Number(periodo) - 1))
}

/** Una riga della tabella: tutto quello che si sa di una persona. */
type RigaConsulente = {
  email: string
  aperte: number
  /**
   * Millisecondi **di apertura** fra l'arrivo del lead e la presa in carico.
   * Non sull'orologio: vedi lib/orarioLavorativo.ts.
   */
  attesePresa: number[]
  eventiAssegnati: number
  eventiEseguiti: number
  vinte: number
  valore: number
  perse: number
}

function rigaVuota(email: string): RigaConsulente {
  return {
    email,
    aperte: 0,
    attesePresa: [],
    eventiAssegnati: 0,
    eventiEseguiti: 0,
    vinte: 0,
    valore: 0,
    perse: 0,
  }
}

function media(valori: number[]): number | null {
  if (valori.length === 0) return null
  return valori.reduce((a, b) => a + b, 0) / valori.length
}

export default async function CoreManagerPage({
  searchParams,
}: {
  searchParams: { periodo?: string }
}) {
  if (!(await utenteHaSezione('core-manager'))) {
    redirect('/dashboard')
  }

  const io = emailCorrente()
  const oggi = oggiRoma()
  const periodo: ChiavePeriodo = eiPeriodoValido(searchParams.periodo)
    ? searchParams.periodo
    : 'oggi'
  const inizio = inizioDi(periodo, oggi)

  // Il confine superiore è il giorno **dopo** oggi: le colonne sono timestamp,
  // e un `lte` sulla data secca taglierebbe via tutto quello che è successo
  // dopo la mezzanotte — cioè l'intera giornata di oggi.
  const dopoFine = giornoPiu(oggi, 1)

  const supabase = createSupabaseServiceClient()
  const [
    { data: opportunita },
    { data: chiuse },
    { data: task },
    { data: richieste },
    { data: staff },
  ] = await Promise.all([
    // La fotografia di adesso: chi ha in mano quante trattative aperte.
    // Senza periodo, perché «quante ne hai in mano» non ne ha uno.
    supabase
      .from('opportunita')
      .select('assegnato_a, assegnato_il, creato_il, stato')
      .in('stato', ['nuovo', 'in_gestione']),
    // Le chiuse del periodo, col valore. Per `chiuso_il` e non per
    // `creato_il`: il risultato appartiene al giorno in cui si è chiuso, non a
    // quello in cui il lead è arrivato — altrimenti una vinta di oggi su un
    // lead di marzo non comparirebbe da nessuna parte.
    conColonneNuove<Record<string, any>>(
      'assegnato_a, stato, chiuso_il, valore_euro',
      COLONNE_NOTA_VINTA,
      (colonne) =>
        supabase
          .from('opportunita')
          .select(colonne)
          .in('stato', ['vinto', 'perso'])
          .gte('chiuso_il', inizio)
          .lt('chiuso_il', dopoFine)
    ),
    // Gli eventi d'agenda del periodo, per data: è il giorno in cui l'impegno
    // cade, che è quello che conta per dire «quanti eventi hai avuto».
    supabase
      .from('task')
      .select('assegnato_a, esito_da, stato, data')
      .gte('data', inizio)
      .lte('data', oggi),
    // Le richieste del settore core sono eventi anche loro: chi le lavora fa
    // lo stesso lavoro di chi chiude un task, e contare solo i task
    // sottostimerebbe proprio chi sta al banco a smaltire i messaggi.
    conColonneNuove<Record<string, any>>(
      'assegnato_a, esito_da, gestito_da, gestito, created_at, data_scelta',
      ['assegnato_a'],
      (colonne) =>
        supabase
          .from('form_contatti')
          .select(colonne)
          .in('attivita', ATTIVITA_IN_AGENDA)
          .or(
            `and(data_scelta.gte.${inizio},data_scelta.lt.${dopoFine}),` +
              `and(data_scelta.is.null,created_at.gte.${inizio},created_at.lt.${dopoFine})`
          )
    ),
    supabase.from('staff_users').select('email, nome, cognome, commerciale'),
  ])

  const staffOrdinato = ordinaPerCognome(
    (staff ?? []) as (RigaStaff & { commerciale?: boolean })[]
  )
  const nomiStaff = mappaNomiStaff(staffOrdinato)

  // Si parte dai commerciali, tutti, anche quelli a zero: una tabella che
  // elenca solo chi ha lavorato non permette di vedere chi non ha lavorato —
  // che è metà della domanda di questa pagina.
  const righe = new Map<string, RigaConsulente>()
  for (const s of staffOrdinato.filter((s) => s.commerciale)) {
    righe.set(s.email, rigaVuota(s.email))
  }
  function riga(email: string | null): RigaConsulente | null {
    if (!email) return null
    if (!righe.has(email)) righe.set(email, rigaVuota(email))
    return righe.get(email)!
  }

  // 1 e 2: il carico di adesso e la reattività.
  let libere = 0
  for (const o of opportunita ?? []) {
    const chi = riga(o.assegnato_a as string | null)
    if (!chi) {
      libere += 1
      continue
    }
    chi.aperte += 1
    // Quanto ha aspettato prima di essere presa: solo quelle prese **nel
    // periodo**, o la media resterebbe la stessa per sempre — una media su
    // tutta la storia non dice se questa settimana si è risposto in fretta.
    //
    // Contate in **ore di apertura** e non sull'orologio (vedi
    // lib/orarioLavorativo.ts): un lead arrivato venerdì alle 20:50 e preso
    // sabato alle 8:05 sull'orologio fa 11 ore, e sembra una dimenticanza —
    // mentre è stata la prima cosa fatta all'apertura, cioè 15 minuti.
    if (o.assegnato_il && o.creato_il) {
      const giornoPresa = (o.assegnato_il as string).slice(0, 10)
      if (giornoPresa >= inizio && giornoPresa <= oggi) {
        const ms = msLavorativi(o.creato_il as string, o.assegnato_il as string)
        if (ms !== null) chi.attesePresa.push(ms)
      }
    }
  }

  // 3: gli eventi, assegnati ed eseguiti. Due conteggi separati sulla stessa
  // riga: chi esegue più di quanto ha assegnato copre i turni di qualcun
  // altro, chi ha assegnato più di quanto esegue accumula arretrato.
  let eventiSenzaAssegnatario = 0
  for (const t of task ?? []) {
    const assegnato = riga(t.assegnato_a as string | null)
    if (assegnato) assegnato.eventiAssegnati += 1
    else eventiSenzaAssegnatario += 1
    const eseguito = riga(t.esito_da as string | null)
    if (eseguito) eseguito.eventiEseguiti += 1
  }
  for (const r of richieste ?? []) {
    const assegnato = riga(r.assegnato_a as string | null)
    if (assegnato) assegnato.eventiAssegnati += 1
    else eventiSenzaAssegnatario += 1
    // `esito_da` sugli appuntamenti, `gestito_da` sui messaggi: sono le due
    // firme delle due chiusure (vedi chiudiConEsito e salvaGestione).
    const eseguito = riga((r.esito_da as string) ?? (r.gestito_da as string) ?? null)
    if (eseguito && r.gestito) eseguito.eventiEseguiti += 1
  }

  // 4: il risultato del periodo.
  let vinteTotali = 0
  let valoreTotale = 0
  let perseTotali = 0
  let vinteSenzaValore = 0
  for (const o of chiuse ?? []) {
    const chi = riga(o.assegnato_a as string | null)
    const stato = o.stato as StatoTrattativa
    if (stato === 'vinto') {
      vinteTotali += 1
      const v = o.valore_euro != null ? Number(o.valore_euro) : null
      if (v === null) vinteSenzaValore += 1
      else valoreTotale += v
      if (chi) {
        chi.vinte += 1
        if (v !== null) chi.valore += v
      }
    } else {
      perseTotali += 1
      if (chi) chi.perse += 1
    }
  }

  const elenco = [...righe.values()].sort((a, b) => b.aperte - a.aperte || b.vinte - a.vinte)
  const apertePiuAlte = Math.max(1, ...elenco.map((r) => r.aperte))
  const totaleAperte = elenco.reduce((a, r) => a + r.aperte, 0) + libere

  function link(p: ChiavePeriodo): string {
    return `/dashboard/core-manager?periodo=${p}`
  }

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Core</p>
        <h1>Core Manager</h1>
        <p className="muted">
          Come è distribuito il lavoro del settore core fra le persone: carico, reattività, eventi
          fatti e trattative chiuse col loro valore. Serve a vedere gli squilibri — non a giudicare
          una riga, ma a capire se qualcuno è sommerso e qualcun altro è fermo.
        </p>
      </div>

      {/* Il periodo vale per tutto tranne le opportunità aperte, che sono una
          fotografia di adesso. Detto qui e ripetuto in testa alla tabella
          giusta, perché un numero col periodo sbagliato in testa è peggio di
          un numero senza periodo. */}
      <div className="filtri">
        <div className="filtri-testa">
          <span className="filtri-titolo">Periodo</span>
        </div>
        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
            <legend>Chiusure ed eventi</legend>
            {PERIODI.map((p) => (
              <Link
                key={p.chiave}
                className={`chip${periodo === p.chiave ? ' is-attivo' : ''}`}
                aria-current={periodo === p.chiave ? 'true' : undefined}
                href={link(p.chiave)}
              >
                {periodo === p.chiave && (
                  <span className="chip-spunta" aria-hidden="true">
                    ✓
                  </span>
                )}
                {p.etichetta}
              </Link>
            ))}
          </fieldset>
        </div>
      </div>

      <div className="griglia-stat">
        <div className={`stat stat-gestione${totaleAperte > 0 ? '' : ' is-vuoto'}`}>
          <span className="stat-testa">
            <span className="stat-label">Opportunità aperte</span>
          </span>
          <span className="stat-valore">{totaleAperte}</span>
          <span className="stat-nota">Adesso, in tutto il settore</span>
        </div>

        <div className={`stat stat-nuovo${libere > 0 ? ' is-azione' : ' is-vuoto'}`}>
          <span className="stat-testa">
            <span className="stat-label">
              {libere > 0 && <span className="stat-punto" aria-hidden="true" />}
              Senza titolare
            </span>
          </span>
          <span className="stat-valore">{libere}</span>
          <span className="stat-nota">
            {libere > 0 ? 'Non le segue nessuno: sono di chi se le prende' : 'Tutte in mano a qualcuno'}
          </span>
        </div>

        <div className={`stat stat-vinto${vinteTotali > 0 ? '' : ' is-vuoto'}`}>
          <span className="stat-testa">
            <span className="stat-label">Vinte nel periodo</span>
          </span>
          <span className="stat-valore">{vinteTotali}</span>
          <span className="stat-nota">
            {euro(valoreTotale) ?? '—'}
            {vinteSenzaValore > 0 && ` · ${vinteSenzaValore} senza valore registrato`}
          </span>
        </div>

        <div className={`stat stat-perso${perseTotali > 0 ? '' : ' is-vuoto'}`}>
          <span className="stat-testa">
            <span className="stat-label">Perse nel periodo</span>
          </span>
          <span className="stat-valore">{perseTotali}</span>
          <span className="stat-nota">Chiuse col motivo registrato</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Per consulente</h2>
          <span className="muted">
            {PERIODI.find((p) => p.chiave === periodo)?.etichetta.toLowerCase()}, tranne le aperte
          </span>
        </div>

        <p className="card-nota muted">
          <strong>Aperte</strong> è una fotografia di adesso. <strong>Presa in carico</strong> è la
          media fra l&apos;arrivo del lead e il momento in cui qualcuno se l&apos;è preso, sulle
          prese nel periodo, contata sulle <strong>ore di apertura</strong> — 7:00–21:00 dal
          lunedì al venerdì, 8:00–19:00 sabato, domenica e festivi. Le ore in cui il club è
          chiuso non si contano: un lead arrivato venerdì a tarda sera e preso sabato
          all&apos;apertura è «15 minuti», non «11 ore». <strong>Assegnati</strong> ed <strong>eseguiti</strong> sono due
          conteggi diversi di proposito: chi esegue più di quanto ha assegnato sta coprendo i turni
          di qualcun altro.
        </p>

        {elenco.length === 0 ? (
          <p className="vuoto">
            Nessun commerciale configurato: il diritto si assegna da{' '}
            <Link className="link" href="/dashboard/utenti">
              Gestione utenti
            </Link>
            .
          </p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Consulente</th>
                  <th>Aperte</th>
                  <th>
                    Presa in carico
                    <span className="th-nota">ore di apertura</span>
                  </th>
                  <th>Eventi assegnati</th>
                  <th>Eventi eseguiti</th>
                  <th>Vinte</th>
                  <th>Valore</th>
                  <th>Perse</th>
                </tr>
              </thead>
              <tbody>
                {elenco.map((r) => {
                  const mediaPresa = media(r.attesePresa)
                  return (
                    <tr key={r.email} className={r.email === io ? 'is-mia' : undefined}>
                      <td>
                        {nomeDiEmail(r.email, nomiStaff)}
                        {r.email === io && <span className="muted"> (tu)</span>}
                      </td>
                      {/* Il carico con una barra dietro il numero: in una
                          colonna di cifre lo squilibrio si vede contando, con
                          la barra si vede guardando — ed è il motivo per cui
                          questa pagina esiste. */}
                      <td>
                        <span className="carico">
                          <span
                            className="carico-barra"
                            style={{ width: `${(r.aperte / apertePiuAlte) * 100}%` }}
                            aria-hidden="true"
                          />
                          <span className="carico-numero">{r.aperte}</span>
                        </span>
                      </td>
                      <td>
                        {durataLavorativa(mediaPresa)}
                        {r.attesePresa.length > 0 && (
                          <span className="muted"> ({r.attesePresa.length})</span>
                        )}
                      </td>
                      <td>{r.eventiAssegnati}</td>
                      <td>
                        {r.eventiEseguiti}
                        {/* Lo scarto fra assegnati ed eseguiti, quando c'è: è
                            il dato che dice chi sta coprendo e chi accumula, e
                            calcolarlo a mente su otto righe non lo si fa. */}
                        {r.eventiEseguiti !== r.eventiAssegnati && (
                          <span className={`scarto ${r.eventiEseguiti > r.eventiAssegnati ? 'e-su' : 'e-giu'}`}>
                            {r.eventiEseguiti > r.eventiAssegnati ? '+' : '−'}
                            {Math.abs(r.eventiEseguiti - r.eventiAssegnati)}
                          </span>
                        )}
                      </td>
                      <td>{r.vinte}</td>
                      <td className="cella-valore">{r.valore > 0 ? euro(r.valore) : '—'}</td>
                      <td>{r.perse}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th>Totale</th>
                  <th>{elenco.reduce((a, r) => a + r.aperte, 0)}</th>
                  <th>{durataLavorativa(media(elenco.flatMap((r) => r.attesePresa)))}</th>
                  <th>{elenco.reduce((a, r) => a + r.eventiAssegnati, 0)}</th>
                  <th>{elenco.reduce((a, r) => a + r.eventiEseguiti, 0)}</th>
                  <th>{elenco.reduce((a, r) => a + r.vinte, 0)}</th>
                  <th className="cella-valore">
                    {euro(elenco.reduce((a, r) => a + r.valore, 0)) ?? '—'}
                  </th>
                  <th>{elenco.reduce((a, r) => a + r.perse, 0)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Quello che la tabella non attribuisce a nessuno, invece di
            lasciarlo fuori in silenzio: un totale che non torna fa dubitare
            di tutta la pagina. */}
        {(libere > 0 || eventiSenzaAssegnatario > 0) && (
          <p className="card-nota muted">
            Fuori dalla tabella perché non sono di nessuno: {libere}{' '}
            {libere === 1 ? 'opportunità' : 'opportunità'} senza titolare e {eventiSenzaAssegnatario}{' '}
            {eventiSenzaAssegnatario === 1 ? 'evento' : 'eventi'} senza assegnatario — quelli
            arrivati dal sito e non ancora presi in carico.
          </p>
        )}
      </div>

      {vinteSenzaValore > 0 && (
        <div className="card card-avviso">
          <div className="card-head">
            <h3 className="card-titolo">Vinte senza valore</h3>
            <span className="badge badge-warn badge-punto">{vinteSenzaValore} nel periodo</span>
          </div>
          <p className="card-nota muted">
            Il valore del contratto è obbligatorio da quando esiste il campo: queste sono chiusure
            precedenti, e restano senza — non si inventa a posteriori a quanto fu venduto. La
            colonna «Valore» le esclude, quindi il totale è più basso del vero fino a quando
            queste escono dal periodo.
          </p>
        </div>
      )}
    </>
  )
}
