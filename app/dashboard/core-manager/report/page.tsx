import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import {
  dataBreve,
  giorniDelMese,
  giornoPiu,
  etichettaMese,
  mesePiu,
  oggiRoma,
  primoDelMese,
  ultimoDelMese,
} from '@/lib/agenda'
import { euro } from '@/lib/pipeline'
import { caricaOperativita, sommaMisure } from '@/lib/report-operativita'
import { mappaNomiStaff, ordinaPerCognome, type RigaStaff } from '@/lib/staff'
import { CellaObiettivo } from './CellaObiettivo'
import { OperativitaGiornaliera, PERIODI, type Periodo } from './OperativitaGiornaliera'

export const dynamic = 'force-dynamic'

// Il "Daily Sales Report" che la responsabile commerciale teneva a mano su
// un foglio, una tab per consulente: goal del giorno, chiamate, appuntamenti
// fissati e svolti, show ratio, walk-in, vendite, triple pack e fatturato.
//
// Non è un dato nuovo — lo abbiamo quasi tutto, sparso fra `task`,
// `form_contatti` e `opportunita` — ma non c'era una pagina che lo
// ricomponesse riga per giorno nella stessa forma a cui la responsabile è
// abituata. Questa pagina fa solo quello: nessun calcolo che non si potesse
// già fare a mano guardando l'agenda e la pipeline, solo fatto per lei.
//
// Una consulente alla volta, come le tab del vecchio foglio — più "Tutti",
// la somma di tutte le commerciali, per quando la domanda è come sta andando
// il settore e non una persona sola.
//
// ── Cosa conta cosa ──────────────────────────────────────────────────────
//
// I numeri non si calcolano qui: vengono da lib/report-operativita.ts, la
// stessa fonte delle tabelle «Per canale» e «Per operatore» della schermata
// sopra. Il foglio classico e la schermata nuova dicono quindi le stesse
// cose (prima ognuno contava a modo suo, e non tornavano). Cosa vuol dire
// ogni colonna:
//
//  - CONTATTI/TELEF: le telefonate chiuse nel giorno, anche a vuoto.
//  - APP.TI FISSATI / SVOLTI: le visite in sede del giorno (agenda e
//    richieste dal sito che sono già un appuntamento) e quelle con esito
//    «eseguita». Fuori le visite nate da un walk-in.
//  - WALK IN: le registrazioni al banco del giorno, comprese quelle senza
//    operatore (in «Tutti»); con una consulente sola, solo quelle in cui era
//    lei al banco. CHIUSI: le trattative vinte che arrivano da un walk-in.
//  - TOTAL SALES / N. triple pack / FATTURATO: le trattative New vinte nel
//    giorno (walk-in, sito, altro), quante includono un triple pack e quanto
//    valgono (opportunita.valore_euro). Fuori i rinnovi — stanno nella
//    tabella «Per operatore» — e i lead aperti da una scadenza mensile, la
//    cui vendita è il rinnovo.
//  - GOAL GIORNALIERO: scritto a mano, come sul foglio — vive nella sua
//    tabella (obiettivi_giornalieri), non si calcola.
//  - REFERRAL: omessa. Oggi non ha un'origine sua nei dati (arriva come una
//    richiesta uguale alle altre): si aggiunge quando ne avrà una.
//  - "Off" (i giorni di riposo del vecchio foglio): non li tracciamo, quindi
//    ogni giorno del mese compare con i suoi numeri, anche a zero.

type Giorno = {
  data: string
  contattiTelef: number
  appFissati: number
  appSvolti: number
  walkIn: number
  walkInChiusi: number
  vinte: number
  triplePack: number
  fatturato: number
}

function giornoVuoto(data: string): Giorno {
  return {
    data,
    contattiTelef: 0,
    appFissati: 0,
    appSvolti: 0,
    walkIn: 0,
    walkInChiusi: 0,
    vinte: 0,
    triplePack: 0,
    fatturato: 0,
  }
}

/** "42%", o "—" quando il denominatore è zero: una percentuale di zero su
 * zero direbbe "0%", che si legge come "è andata male" invece di "non è
 * successo niente". */
function percento(num: number, den: number): string {
  if (den <= 0) return '—'
  return `${Math.round((num / den) * 100)}%`
}

/** La vista di squadra: la somma di tutte le commerciali, per i giorni in
 * cui una singola persona non basta a rispondere «come sta andando il
 * settore». Non è un'altra commerciale, quindi vive fuori dall'elenco che
 * arriva da staff_users — è la sua chip, non una riga in più da filtrare via
 * quando si scelgono i soli commerciali. */
const TUTTI = 'tutti'

export default async function ReportGiornalieroPage({
  searchParams,
}: {
  searchParams: { commerciale?: string; mese?: string; giorno?: string; periodo?: string; operatore?: string; classico?: string }
}) {
  if (!(await utenteHaSezione('core-manager'))) {
    redirect('/dashboard')
  }

  const supabase = createSupabaseServiceClient()
  const oggi = oggiRoma()

  const { data: staff, error: erroreStaff } = await supabase
    .from('staff_users')
    .select('email, nome, cognome, commerciale, operatore_segreteria')
  if (erroreStaff) console.error('Commerciali non lette:', erroreStaff.message)

  const commerciali = ordinaPerCognome(
    ((staff ?? []) as (RigaStaff & { commerciale?: boolean })[]).filter((s) => s.commerciale)
  )
  const nomiStaff = mappaNomiStaff(commerciali)

  const commerciale =
    searchParams.commerciale === TUTTI
      ? TUTTI
      : searchParams.commerciale && commerciali.some((s) => s.email === searchParams.commerciale)
        ? searchParams.commerciale
        : (commerciali[0]?.email ?? null)

  // Chi entra nei conti: tutte le commerciali per la vista di squadra, una
  // sola per la vista singola. Le query sotto usano sempre `.in(...)` su
  // questo elenco — mai `.eq()` sparsi — così le due viste sono la stessa
  // domanda fatta a un pubblico diverso, non due logiche da tenere allineate.
  // Il foglio classico (il vecchio schema, una consulente alla volta) si legge
  // solo quando lo si apre: sono una dozzina di letture che la schermata
  // principale non usa.
  const classico = searchParams.classico === '1' || !!searchParams.commerciale || !!searchParams.mese
  const emailFiltro = !classico
    ? []
    : commerciale === TUTTI
      ? commerciali.map((s) => s.email)
      : commerciale
        ? [commerciale]
        : []

  // La schermata nuova: il giorno (mai nel futuro), il periodo e l'operatore.
  const giornoScelto =
    /^\d{4}-\d{2}-\d{2}$/.test(searchParams.giorno ?? '') && searchParams.giorno! <= oggi ? searchParams.giorno! : oggi
  const periodo: Periodo = (PERIODI.find((p) => String(p.valore) === searchParams.periodo)?.valore ?? 1) as Periodo

  const meseRichiesto = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.mese ?? '')
    ? primoDelMese(searchParams.mese!)
    : primoDelMese(oggi)
  const primo = meseRichiesto
  const ultimo = ultimoDelMese(meseRichiesto)
  const giorni = giorniDelMese(meseRichiesto)

  // I link del foglio classico: portano con sé la scelta della schermata
  // nuova (giorno, periodo, operatore), così aprire o cambiare il foglio non
  // la fa perdere.
  function link(parametri: { commerciale?: string; mese?: string }) {
    const params = new URLSearchParams()
    if (searchParams.giorno) params.set('giorno', searchParams.giorno)
    if (searchParams.periodo) params.set('periodo', searchParams.periodo)
    if (searchParams.operatore) params.set('operatore', searchParams.operatore)
    params.set('classico', '1')
    if (parametri.commerciale ?? commerciale) params.set('commerciale', parametri.commerciale ?? commerciale!)
    params.set('mese', parametri.mese ?? meseRichiesto)
    return `/dashboard/core-manager/report?${params.toString()}#classico`
  }

  // I link della schermata nuova: portano con sé l'eventuale foglio classico
  // aperto. Un parametro a null si toglie.
  function indirizzo(cambi: { giorno?: string; periodo?: Periodo; operatore?: string | null }) {
    const params = new URLSearchParams()
    const giorno = cambi.giorno ?? giornoScelto
    if (giorno !== oggi) params.set('giorno', giorno)
    const per = cambi.periodo ?? periodo
    if (per !== 1) params.set('periodo', String(per))
    const operatore = cambi.operatore === undefined ? searchParams.operatore : cambi.operatore
    if (operatore) params.set('operatore', operatore)
    if (classico) {
      params.set('classico', '1')
      if (searchParams.commerciale) params.set('commerciale', searchParams.commerciale)
      if (searchParams.mese) params.set('mese', searchParams.mese)
    }
    const q = params.toString()
    return `/dashboard/core-manager/report${q ? `?${q}` : ''}`
  }

  const righe = new Map<string, Giorno>(giorni.map((g) => [g, giornoVuoto(g)]))
  const obiettiviMappa = new Map<string, number>()

  if (emailFiltro.length > 0) {
    // Le stesse misure delle tabelle sopra (lib/report-operativita.ts): è la
    // fonte unica, così il foglio classico e la schermata nuova non possono
    // più dire due cose diverse. Solo il New: i rinnovi qui non entrano.
    const [{ data: obiettivi, error: erroreObiettivi }, dati] = await Promise.all([
      supabase
        .from('obiettivi_giornalieri')
        .select('giorno, goal')
        .in('commerciale', emailFiltro)
        .gte('giorno', primo)
        .lte('giorno', ultimo),
      caricaOperativita(supabase, primo, ultimo, { rinnovi: false }),
    ])

    if (erroreObiettivi && !/obiettivi_giornalieri/.test(erroreObiettivi.message)) {
      console.error('Obiettivi giornalieri non letti:', erroreObiettivi.message)
    }

    // Sommati e non sovrascritti: sulla vista di squadra più commerciali
    // possono avere un goal lo stesso giorno, e l'ultimo letto non deve far
    // sparire gli altri.
    for (const o of obiettivi ?? []) {
      const giorno = o.giorno as string
      obiettiviMappa.set(giorno, (obiettiviMappa.get(giorno) ?? 0) + (o.goal as number))
    }

    // «Tutti» è tutto il lavoro del mese, anche quello senza operatore
    // (walk-in senza nessuno al banco, trattative senza assegnatario): è la
    // somma che torna con la tabella «Per operatore». Una consulente sola è
    // solo il suo.
    for (const g of giorni) {
      const delGiorno = dati.perGiorno.get(g)
      if (!delGiorno) continue
      const m = sommaMisure(
        [...delGiorno.entries()].filter(([email]) => commerciale === TUTTI || email === commerciale).map(([, x]) => x)
      )
      const riga = righe.get(g)!
      riga.contattiTelef = m.tel
      riga.appFissati = m.fissati
      riga.appSvolti = m.visite
      riga.walkIn = m.walkinAccolti
      riga.walkInChiusi = m.vendite.walkin.n
      riga.vinte = m.vendite.walkin.n + m.vendite.sito.n + m.vendite.altro.n
      riga.triplePack = m.triplePack
      riga.fatturato = m.vendite.walkin.euro + m.vendite.sito.euro + m.vendite.altro.euro
    }
  }

  const righeOrdinate = giorni.map((g) => righe.get(g)!)

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Core Manager</p>
        <h1>Report giornaliero</h1>
        <p className="muted">
          Cosa ha fatto ogni operatore, New e rinnovi, e quanto ha venduto: per tipo di azione, per
          canale (walk-in, sito, rinnovi) e nel tempo.{' '}
          <Link className="link" href="/dashboard/core-manager">
            Torna al Core Manager
          </Link>
          .
        </p>
      </div>

      <OperativitaGiornaliera
        giorno={giornoScelto}
        periodo={periodo}
        oggi={oggi}
        operatoreScelto={searchParams.operatore ?? null}
        href={indirizzo}
        staff={(staff ?? []) as any}
      />

      {/* Il vecchio schema del foglio (goal, show ratio, close), una
          consulente alla volta: resta, ma a parte. */}
      <section id="classico">
      {!classico ? (
        <div className="card">
          <p className="muted">
            Il foglio classico — goal giornaliero, show ratio, close, una consulente alla volta — è
            ancora qui.{' '}
            <Link className="link" href={link({}) }>
              Apri il foglio classico
            </Link>
          </p>
        </div>
      ) : (
      <>
      <div className="filtri">
        <div className="filtri-testa">
          <span className="filtri-titolo">Filtra il report</span>
        </div>
        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
            <legend>Consulente</legend>
            {commerciali.length === 0 ? (
              <p className="muted">Nessun commerciale configurato.</p>
            ) : (
              <>
                <Link
                  href={link({ commerciale: TUTTI })}
                  className={`chip${commerciale === TUTTI ? ' is-attivo' : ''}`}
                >
                  Tutti
                </Link>
                {commerciali.map((s) => (
                  <Link
                    key={s.email}
                    href={link({ commerciale: s.email })}
                    className={`chip${s.email === commerciale ? ' is-attivo' : ''}`}
                  >
                    {nomiStaff[s.email] ?? s.email}
                  </Link>
                ))}
              </>
            )}
          </fieldset>
        </div>
      </div>

      <div className="report-mese-nav">
        <Link className="btn btn-ghost btn-sm" href={link({ mese: mesePiu(meseRichiesto, -1) })}>
          ← Mese precedente
        </Link>
        <span className="report-mese-titolo">{etichettaMese(meseRichiesto)}</span>
        <Link className="btn btn-ghost btn-sm" href={link({ mese: mesePiu(meseRichiesto, 1) })}>
          Mese successivo →
        </Link>
      </div>

      {commerciali.length === 0 ? (
        <div className="card">
          <p className="vuoto">Nessun commerciale configurato: il diritto si assegna da Gestione utenti.</p>
        </div>
      ) : (
        <div className="card">
        <div className="tabella-wrap">
          <table className="tabella tabella-report">
            <thead>
              <tr>
                <th>Giorno</th>
                <th>Goal</th>
                <th>Contatti/Telef</th>
                <th>App.ti fissati</th>
                <th>% app. ratio</th>
                <th>App.ti svolti</th>
                <th>% show ratio</th>
                <th>% close (app.)</th>
                <th>Walk in</th>
                <th>Walk in chiusi</th>
                <th>% close ratio (WI)</th>
                <th>Total sales</th>
                <th>N. triple pack</th>
                <th>Fatturato</th>
              </tr>
            </thead>
            <tbody>
              {righeOrdinate.map((g) => {
                const eOggi = g.data === oggi
                return (
                  <tr key={g.data} className={eOggi ? 'is-oggi' : ''}>
                    <td>{dataBreve(g.data)}</td>
                    <td>
                      {/* Sulla vista di squadra il goal è la somma di tutte
                          le commerciali: si legge, non si scrive — quale
                          delle tante andrebbe corretta non lo dice questa
                          cella. Si corregge aprendo la persona giusta. */}
                      {commerciale === TUTTI ? (
                        (obiettiviMappa.get(g.data) ?? '—')
                      ) : (
                        <CellaObiettivo
                          commerciale={commerciale}
                          giorno={g.data}
                          valoreIniziale={obiettiviMappa.get(g.data) ?? null}
                        />
                      )}
                    </td>
                    <td>{g.contattiTelef || '—'}</td>
                    <td>{g.appFissati || '—'}</td>
                    <td>{percento(g.appFissati, g.contattiTelef)}</td>
                    <td>{g.appSvolti || '—'}</td>
                    <td>{percento(g.appSvolti, g.appFissati)}</td>
                    <td>{percento(g.vinte - g.walkInChiusi, g.appSvolti)}</td>
                    <td>{g.walkIn || '—'}</td>
                    <td>{g.walkInChiusi || '—'}</td>
                    <td>{percento(g.walkInChiusi, g.walkIn)}</td>
                    <td>{g.vinte || '—'}</td>
                    <td>{g.triplePack || '—'}</td>
                    <td>{euro(g.fatturato)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </div>
      )}
      </>
      )}
      </section>
    </>
  )
}
