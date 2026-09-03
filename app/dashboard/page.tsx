import Link from 'next/link'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getNomeUtente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { puoAmministrare } from '@/lib/auth/permessi'
import { SEZIONI } from '@/lib/auth/sezioni'
import { canaleDiRichiesta } from '@/lib/richieste'
import { STATI, ETICHETTE_STATO, type StatoTrattativa } from '@/lib/pipeline'
import {
  CLASSE_TIPO,
  ETICHETTE_TIPO_BREVI,
  dataBreve,
  eTipoValido,
  intervalloOrario,
  normalizzaOra,
  oggiRoma,
} from '@/lib/agenda'

export const dynamic = 'force-dynamic'

/** Quanti impegni dell'operatore mostrare in elenco prima di rimandare all'agenda. */
const IMPEGNI_IN_ELENCO = 8

// I quattro riquadri della pipeline, nell'ordine in cui si attraversa: la
// classe di colore e la destinazione stanno qui accanto all'etichetta, così
// aggiungere uno stato non vuol dire ritoccare tre punti diversi.
const RIQUADRI_STATO: { stato: StatoTrattativa; classe: string }[] = [
  { stato: 'nuovo', classe: 'stat-nuovo' },
  { stato: 'in_gestione', classe: 'stat-gestione' },
  { stato: 'vinto', classe: 'stat-vinto' },
  { stato: 'perso', classe: 'stat-perso' },
]

// Conteggi di apertura: i lead che il sito ha raccolto e le sessioni
// registrate da /api/track. Sono le due tabelle che esistono già oggi — i
// numeri dei moduli in arrivo si aggiungeranno qui quando quei moduli
// arriveranno, senza cambiare la struttura della pagina.
async function contatori() {
  const supabase = createSupabaseServiceClient()

  const [lead, leadDaLavorare, sessioni, sessioniConvertite] = await Promise.all([
    supabase.from('form_contatti').select('*', { count: 'exact', head: true }),
    supabase.from('form_contatti').select('*', { count: 'exact', head: true }).eq('gestito', false),
    supabase.from('sessioni').select('*', { count: 'exact', head: true }),
    supabase.from('sessioni').select('*', { count: 'exact', head: true }).eq('convertita', true),
  ])

  return {
    lead: lead.count ?? 0,
    leadDaLavorare: leadDaLavorare.count ?? 0,
    sessioni: sessioni.count ?? 0,
    sessioniConvertite: sessioniConvertite.count ?? 0,
  }
}

/**
 * Le richieste che non corrispondono a nessun canale (vedi lib/richieste.ts):
 * un'attività nuova sul sito non ancora instradata, o una richiesta tennis
 * arrivata senza settore. Non finiscono nella sezione di nessuno, quindi
 * senza questa spia resterebbero invisibili — che è il modo più silenzioso di
 * perdere un contatto.
 */
async function richiesteNonInstradate() {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('form_contatti')
    .select('attivita, settore, origine')
    .eq('gestito', false)
    .limit(500)

  const fuori = (data ?? []).filter((r) => !canaleDiRichiesta(r))
  const motivi = new Map<string, number>()
  for (const r of fuori) {
    const chiave = r.attivita ? `attività "${r.attivita}"${r.settore ? '' : ' (senza settore)'}` : `origine "${r.origine ?? 'non indicata'}"`
    motivi.set(chiave, (motivi.get(chiave) ?? 0) + 1)
  }
  return { totale: fuori.length, motivi: [...motivi.entries()] }
}

/**
 * Le trattative per stato. Si contano le opportunità, non le richieste: la
 * trattativa è della persona, e chi ha scritto tre volte è un contatto da
 * richiamare, non tre.
 *
 * Attenzione a un punto che i numeri non dicono: una richiesta Club o Family
 * arrivata senza email né cellulare non genera nessuna persona e quindi
 * nessuna trattativa (vedi trova_o_crea_persona), quindi non entra in questi
 * riquadri. Resta visibile fra le richieste da lavorare del canale.
 */
async function trattativePerStato(): Promise<Record<StatoTrattativa, number>> {
  const supabase = createSupabaseServiceClient()
  // Una lettura sola della sola colonna che serve: quattro count separati
  // sarebbero quattro round trip per una tabella che sta in una pagina.
  const { data } = await supabase.from('opportunita').select('stato')

  const conteggi = Object.fromEntries(STATI.map((s) => [s, 0])) as Record<StatoTrattativa, number>
  for (const riga of data ?? []) {
    const stato = riga.stato as StatoTrattativa
    if (stato in conteggi) conteggi[stato] += 1
  }
  return conteggi
}

/**
 * Gli impegni aperti di chi sta guardando: gli arretrati e quelli di oggi,
 * cioè quello su cui si può agire adesso. Le voci future restano in agenda —
 * qui servirebbero solo a far sembrare la giornata più piena di com'è.
 */
async function impegniOperatore(email: string | null) {
  if (!email) return { voci: [], totaleAperti: 0 }

  const supabase = createSupabaseServiceClient()
  const oggi = oggiRoma()

  const [{ data }, { count }] = await Promise.all([
    supabase
      .from('task')
      .select('id, titolo, tipo, data, ora, durata_minuti')
      .eq('stato', 'aperto')
      .eq('assegnato_a', email)
      // `lte` e non `eq`: un impegno di martedì rimasto aperto è esattamente
      // quello che non deve sparire per il fatto di essere passato.
      .lte('data', oggi)
      .order('data', { ascending: true })
      .order('ora', { ascending: true, nullsFirst: false })
      .limit(IMPEGNI_IN_ELENCO),
    supabase
      .from('task')
      .select('*', { count: 'exact', head: true })
      .eq('stato', 'aperto')
      .eq('assegnato_a', email)
      .lte('data', oggi),
  ])

  return { voci: data ?? [], totaleAperti: count ?? 0 }
}

export default async function RiepilogoPage() {
  const email = emailCorrente()
  const [nomeUtente, sezioniConsentite, numeri, amministra] = await Promise.all([
    getNomeUtente(email),
    getSezioniConsentite(email),
    contatori(),
    puoAmministrare(email),
  ])

  // Un numero che porta a «non hai accesso» è peggio di un numero che non
  // c'è: i riquadri esistono solo per chi può poi aprirli, e la lettura che
  // li alimenta si salta del tutto.
  const vedeTrattative = sezioniConsentite.includes('richieste-club')
  const vedeAgenda = sezioniConsentite.includes('agenda')

  const [trattative, impegni] = await Promise.all([
    vedeTrattative ? trattativePerStato() : Promise.resolve(null),
    vedeAgenda ? impegniOperatore(email) : Promise.resolve(null),
  ])

  const oggi = oggiRoma()

  // La spia interessa solo chi amministra: è lui che aggiunge un canale.
  const nonInstradate = amministra ? await richiesteNonInstradate() : { totale: 0, motivi: [] }

  const conversione =
    numeri.sessioni > 0 ? Math.round((numeri.sessioniConvertite / numeri.sessioni) * 1000) / 10 : 0

  const inArrivo = SEZIONI.filter((s) => s.inArrivo && sezioniConsentite.includes(s.chiave))

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Pannello Ronchiverdi</p>
        <h1>{nomeUtente ? `Ciao ${nomeUtente.split(' ')[0]}` : 'Riepilogo'}</h1>
        <p className="muted">Richieste dal sito e traffico delle campagne.</p>
      </div>

      <div className="griglia-stat">
        <div className="stat">
          <span className="stat-valore">{numeri.lead}</span>
          <span className="stat-label">Richieste totali</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{numeri.leadDaLavorare}</span>
          <span className="stat-label">Ancora da lavorare</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{numeri.sessioni}</span>
          <span className="stat-label">Sessioni sul sito</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{conversione}%</span>
          <span className="stat-label">Sessioni che convertono</span>
        </div>
      </div>

      {trattative && (
        <section className="riepilogo-sezione">
          <h2 className="riepilogo-titolo">Trattative Club e Family</h2>
          <div className="griglia-stat">
            {RIQUADRI_STATO.map(({ stato, classe }) => (
              <Link
                key={stato}
                className={`stat ${classe}`}
                href={`/dashboard/richieste/richieste-club?stato=${stato}`}
              >
                <span className="stat-freccia" aria-hidden="true">
                  →
                </span>
                <span className="stat-valore">{trattative[stato]}</span>
                <span className="stat-label">{ETICHETTE_STATO[stato]}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {impegni && (
        <section className="riepilogo-sezione">
          <h2 className="riepilogo-titolo">I tuoi impegni</h2>
          {impegni.voci.length > 0 ? (
            <div className="card">
              <div className="card-head">
                <h2 className="agenda-giorno-titolo">Da fare adesso</h2>
                <span className="muted">
                  {impegni.totaleAperti}{' '}
                  {impegni.totaleAperti === 1 ? 'voce aperta' : 'voci aperte'}
                </span>
              </div>
              <ul className="impegni">
                {impegni.voci.map((v) => {
                  const tipo = eTipoValido(v.tipo) ? v.tipo : 'task'
                  const giorno = String(v.data).slice(0, 10)
                  return (
                    <li className="impegno" key={v.id as string}>
                      <span className={`badge-tipo ${CLASSE_TIPO[tipo]}`}>
                        {ETICHETTE_TIPO_BREVI[tipo]}
                      </span>
                      <span className="impegno-titolo">{v.titolo as string}</span>
                      <span className="muted">
                        {dataBreve(giorno)}
                        {' · '}
                        {intervalloOrario(normalizzaOra(v.ora as string), Number(v.durata_minuti) || 0) ??
                          'in giornata'}
                      </span>
                      {giorno < oggi && <span className="badge badge-warn">arretrato</span>}
                    </li>
                  )
                })}
              </ul>
              {/* Il link porta all'agenda già filtrata sulle proprie: è la
                  continuazione di questo elenco, non un'altra pagina da
                  ri-filtrare a mano. */}
              <Link className="btn btn-ghost btn-sm" href="/dashboard/agenda?vista=lista&solo=mie">
                Apri la tua agenda
              </Link>
            </div>
          ) : (
            <div className="card">
              <p className="vuoto" style={{ padding: '1rem' }}>
                Non hai impegni arretrati né per oggi.{' '}
                <Link className="link" href="/dashboard/agenda">
                  Vedi tutta l&apos;agenda
                </Link>
                .
              </p>
            </div>
          )}
        </section>
      )}

      {nonInstradate.totale > 0 && (
        <div className="card" style={{ borderColor: 'rgba(138, 100, 16, 0.35)' }}>
          <div className="card-head">
            <h2>Richieste senza sezione</h2>
            <span className="badge badge-warn">{nonInstradate.totale} da instradare</span>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            Queste richieste non compaiono nella sezione di nessun responsabile: va aggiunto il
            canale corrispondente in <code>lib/richieste.ts</code>.
          </p>
          <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.1rem' }}>
            {nonInstradate.motivi.map(([motivo, quante]) => (
              <li key={motivo} style={{ marginBottom: '0.35rem' }}>
                {motivo} — {quante} {quante === 1 ? 'richiesta' : 'richieste'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {inArrivo.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Moduli in arrivo</h2>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            Hai già il permesso per queste sezioni: appariranno nel menu appena il modulo è pronto.
          </p>
          <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.1rem' }}>
            {inArrivo.map((s) => (
              <li key={s.chiave} style={{ marginBottom: '0.35rem' }}>
                {s.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
