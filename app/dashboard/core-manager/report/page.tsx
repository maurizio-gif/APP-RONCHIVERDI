import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import {
  dataBreve,
  giorniDelMese,
  giornoDiIstante,
  giornoPiu,
  etichettaMese,
  mesePiu,
  mezzanotteRoma,
  oggiRoma,
  primoDelMese,
  tipoDaAzione,
  ultimoDelMese,
} from '@/lib/agenda'
import { euro } from '@/lib/pipeline'
import { COLONNE_NOTA_VINTA, conColonneNuove } from '@/lib/migrazioni'
import { provenienzaDiOrigine } from '@/lib/provenienza'
import { mappaNomiStaff, ordinaPerCognome, type RigaStaff } from '@/lib/staff'
import { CellaObiettivo } from './CellaObiettivo'

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
// ── Cosa conta cosa (le scelte che qualcuno dovrà rivedere) ──────────────
//
//  - CONTATTI/TELEF: le telefonate (task e richieste di tipo "telefonata")
//    del giorno, fissate o già registrate, di questa consulente.
//  - MESSAGGI GESTITI: le richieste arrivate senza appuntamento (un
//    messaggio, non una telefonata né una visita) che questa consulente ha
//    gestito quel giorno — non quando sono arrivate, ma quando sono state
//    lavorate (`form_contatti.gestito_il`).
//  - APP.TI FISSATI / (GIORNO STESSO) / SVOLTI: le visite in sede di questa
//    consulente per quel giorno — **escluse** quelle nate da un walk-in
//    (quelle sono nella loro colonna). "Fissati" e "del giorno stesso" oggi
//    contano la stessa cosa: il vecchio distinguo fra quando è stato preso
//    l'appuntamento e quando si tiene non ha un corrispondente nei dati.
//  - WALK IN / CHIUSI: chi si è registrato al banco quel giorno con questa
//    consulente al banco (`form_contatti.operatore`), e quanti di loro hanno
//    già un'iscrizione vinta.
//  - TOTAL SALES / N. triple pack / FATTURATO: le trattative vinte quel
//    giorno da questa consulente, quante includono un triple pack, e quanto
//    valgono in euro — preso da `opportunita.valore_euro`, non da un conto a
//    parte.
//  - GOAL GIORNALIERO: scritto a mano, come sul foglio — vive nella sua
//    tabella (obiettivi_giornalieri), non si calcola.
//  - REFERRAL: omessa. Oggi non ha un'origine sua nei dati (arriva come una
//    richiesta uguale alle altre): si aggiunge quando ne avrà una.
//  - "Off" (i giorni di riposo del vecchio foglio): non li tracciamo, quindi
//    ogni giorno del mese compare con i suoi numeri, anche a zero.

type Giorno = {
  data: string
  contattiTelef: number
  messaggiGestiti: number
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
    messaggiGestiti: 0,
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
  searchParams: { commerciale?: string; mese?: string }
}) {
  if (!(await utenteHaSezione('core-manager'))) {
    redirect('/dashboard')
  }

  const supabase = createSupabaseServiceClient()
  const oggi = oggiRoma()

  const { data: staff, error: erroreStaff } = await supabase
    .from('staff_users')
    .select('email, nome, cognome, commerciale')
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
  const emailFiltro = commerciale === TUTTI ? commerciali.map((s) => s.email) : commerciale ? [commerciale] : []

  const meseRichiesto = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.mese ?? '')
    ? primoDelMese(searchParams.mese!)
    : primoDelMese(oggi)
  const primo = meseRichiesto
  const ultimo = ultimoDelMese(meseRichiesto)
  const giorni = giorniDelMese(meseRichiesto)
  const inizioIstante = mezzanotteRoma(primo)
  const fineIstante = mezzanotteRoma(giornoPiu(ultimo, 1))

  function link(parametri: { commerciale?: string; mese?: string }) {
    const params = new URLSearchParams()
    if (parametri.commerciale ?? commerciale) params.set('commerciale', parametri.commerciale ?? commerciale!)
    params.set('mese', parametri.mese ?? meseRichiesto)
    return `/dashboard/core-manager/report?${params.toString()}`
  }

  const righe = new Map<string, Giorno>(giorni.map((g) => [g, giornoVuoto(g)]))
  const obiettiviMappa = new Map<string, number>()

  if (emailFiltro.length > 0) {
    const [
      { data: obiettivi, error: erroreObiettivi },
      { data: taskRighe },
      { data: telefApp },
      { data: messaggi },
      { data: walkIn },
      { data: vinte },
    ] = await Promise.all([
      supabase
        .from('obiettivi_giornalieri')
        .select('giorno, goal')
        .in('commerciale', emailFiltro)
        .gte('giorno', primo)
        .lte('giorno', ultimo),
      // Telefonate e visite in sede fissate dalla segreteria o dal
      // commerciale stesso (task), per la data in cui cadono.
      supabase
        .from('task')
        .select('id, tipo, data, stato, esito_tipo, entita, entita_id')
        .in('assegnato_a', emailFiltro)
        .in('tipo', ['appuntamento_telefonico', 'appuntamento_in_sede'])
        .gte('data', primo)
        .lte('data', ultimo),
      // Telefonate e visite in sede prenotate direttamente dal sito, quando
      // la richiesta stessa è già l'appuntamento (non passa da un task).
      supabase
        .from('form_contatti')
        .select('id, azione, data_scelta, origine, esito_tipo, gestito')
        .in('assegnato_a', emailFiltro)
        .in('azione', ['telefonata', 'appuntamento'])
        .gte('data_scelta', primo)
        .lte('data_scelta', ultimo),
      // I messaggi (richieste senza appuntamento) che questa consulente ha
      // gestito nel mese: contano per quando sono stati lavorati
      // (`gestito_il`), non per quando sono arrivati.
      supabase
        .from('form_contatti')
        .select('id, azione, gestito_il')
        .in('gestito_da', emailFiltro)
        .eq('gestito', true)
        .gte('gestito_il', inizioIstante)
        .lt('gestito_il', fineIstante),
      // I walk-in di cui una di queste consulenti era al banco: origine e
      // operatore sono le due colonne che lo dicono (vedi api/lead.ts sul
      // sito).
      supabase
        .from('form_contatti')
        .select('id, created_at, persona_id, opportunita_id')
        .eq('origine', 'walk-in')
        .in('operatore', emailFiltro)
        .gte('created_at', inizioIstante)
        .lt('created_at', fineIstante),
      // Le vinte del mese: valgono per TOTAL SALES, triple pack e fatturato.
      // `triple_pack` è la colonna più recente (vedi
      // scripts/sql/2026-09-17-triple-pack-e-obiettivi-giornalieri.sql): se
      // la migration non è ancora passata, si rilegge senza — a metà, non a
      // zero, che direbbe "nessuna vendita" su un mese che invece ne ha.
      conColonneNuove<Record<string, any>>(
        'id, persona_id, chiuso_il, valore_euro, triple_pack',
        COLONNE_NOTA_VINTA,
        (colonne) =>
          supabase
            .from('opportunita')
            .select(colonne)
            .in('assegnato_a', emailFiltro)
            .eq('stato', 'vinto')
            .gte('chiuso_il', inizioIstante)
            .lt('chiuso_il', fineIstante)
      ),
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

    // Per escludere dalle visite "APP.TI" quelle nate da un walk-in (il tour
    // "da fare subito" che il guest register crea da solo, vedi
    // api/lead.ts): serve sapere l'origine della richiesta a cui un task è
    // agganciato. Le voci scritte a mano per una persona (entita='persona')
    // non hanno una richiesta dietro e restano incluse — distinguere anche
    // lì l'origine del lead originario è un affinamento per un'altra volta.
    const idRichiesteDiTask = [
      ...new Set(
        (taskRighe ?? [])
          .filter((t) => t.entita === 'form_contatti')
          .map((t) => t.entita_id as string)
      ),
    ]
    const { data: richiesteDiTask } = idRichiesteDiTask.length
      ? await supabase.from('form_contatti').select('id, origine').in('id', idRichiesteDiTask)
      : { data: [] as { id: string; origine: string | null }[] }
    const origineRichiesta = new Map(
      (richiesteDiTask ?? []).map((r) => [r.id as string, r.origine as string | null])
    )

    const eWalkIn = (origine: string | null) => provenienzaDiOrigine(origine).chiave === 'guest-register'

    for (const t of taskRighe ?? []) {
      const giorno = righe.get(t.data as string)
      if (!giorno) continue
      if (t.tipo === 'appuntamento_telefonico') {
        giorno.contattiTelef += 1
        continue
      }
      // appuntamento_in_sede: fuori le visite nate da un walk-in.
      const origine = t.entita === 'form_contatti' ? (origineRichiesta.get(t.entita_id as string) ?? null) : null
      if (eWalkIn(origine)) continue
      giorno.appFissati += 1
      if (t.stato === 'completato' && t.esito_tipo === 'eseguita') giorno.appSvolti += 1
    }

    for (const r of telefApp ?? []) {
      if (!r.data_scelta) continue
      const giorno = righe.get(String(r.data_scelta).slice(0, 10))
      if (!giorno) continue
      if (eWalkIn(r.origine as string | null)) continue
      if (r.azione === 'telefonata') {
        giorno.contattiTelef += 1
      } else {
        giorno.appFissati += 1
        if (r.gestito && r.esito_tipo === 'eseguita') giorno.appSvolti += 1
      }
    }

    for (const m of messaggi ?? []) {
      if (!m.gestito_il || tipoDaAzione(m.azione as string | null) !== 'messaggio') continue
      const giorno = righe.get(giornoDiIstante(m.gestito_il as string))
      if (!giorno) continue
      giorno.messaggiGestiti += 1
    }

    const opportunitaVinteWalkIn = new Set<string>()
    for (const w of walkIn ?? []) {
      const giorno = righe.get(giornoDiIstante(w.created_at as string))
      if (!giorno) continue
      giorno.walkIn += 1
      if (w.opportunita_id) opportunitaVinteWalkIn.add(w.opportunita_id as string)
    }

    for (const v of vinte ?? []) {
      const giorno = righe.get(giornoDiIstante(v.chiuso_il as string))
      if (!giorno) continue
      giorno.vinte += 1
      if (v.triple_pack) giorno.triplePack += 1
      giorno.fatturato += v.valore_euro != null ? Number(v.valore_euro) : 0
      if (opportunitaVinteWalkIn.has(v.id as string)) giorno.walkInChiusi += 1
    }
  }

  const righeOrdinate = giorni.map((g) => righe.get(g)!)

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Core Manager</p>
        <h1>Report giornaliero</h1>
        <p className="muted">
          Lo stesso schema del foglio a cui la responsabile è abituata: un giorno per riga, una
          consulente alla volta.{' '}
          <Link className="link" href="/dashboard/core-manager">
            Torna al Core Manager
          </Link>
          .
        </p>
      </div>

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
  )
}
