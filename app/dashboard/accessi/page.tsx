import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { oggiRoma } from '@/lib/agenda'
import {
  ScriptAccessiMancante,
  accessiNegati,
  accessiPerVarco,
  caricaGruppiAccessi,
  caricaVarchi,
  fedeltaAccessi,
  mappaCalore,
  riepilogoAccessi,
  serieAccessi,
  serieVisite,
  sociInattivi,
} from '@/lib/accessi-server'
import {
  COLORE_SENZA_GRUPPO,
  ETICHETTA_SENZA_GRUPPO,
  GIORNI_SETTIMANA,
  etichettaPeriodo,
  numero,
  oraTesto,
  periodoDa,
} from '@/lib/accessi'
import { dataBreve } from '@/lib/persone'
import { NavAccessi } from './NavAccessi'
import { SelettorePeriodo } from './SelettorePeriodo'
import { BarreOrizzontali, GraficoTendenza, IstogrammaFedelta, MappaCalore, SchedaNumero, type VoceBarra } from './Grafici'

export const dynamic = 'force-dynamic'

const SOGLIE_ASSENZA = [14, 30, 60, 90]

// Gli ingressi al club dai varchi: quanta gente, quando, da dove. I numeri
// sono giorni di presenza (un ingresso al giorno per persona) e passaggi ai
// varchi; per i confronti si usa il periodo di pari durata subito prima.
// Come si calcola, e perché da un riepilogo e non da `accessi`: vedi
// lib/accessi.ts e scripts/sql/2026-10-29-accessi-sezione.sql.
export default async function AccessiPage({
  searchParams,
}: {
  searchParams: { periodo?: string; dal?: string; al?: string; gruppo?: string; assenza?: string }
}) {
  if (!(await utenteHaSezione('accessi'))) redirect('/dashboard')

  const oggi = oggiRoma()
  const periodo = periodoDa(searchParams, oggi)
  const assenza = SOGLIE_ASSENZA.includes(Number(searchParams.assenza)) ? Number(searchParams.assenza) : 30
  const db = createSupabaseServiceClient()
  const prec = periodo.precedente

  let dati
  try {
    const gruppi = await caricaGruppiAccessi(db)
    const gruppoCalore = gruppi.find((g) => g.id === searchParams.gruppo)?.id ?? null
    const [varchi, riepilogo, riepilogoPrec, serie, seriePrec, visite, negati, fedelta, inattivi, calore] = await Promise.all([
      caricaVarchi(db),
      riepilogoAccessi(db, periodo.dal, periodo.al),
      prec ? riepilogoAccessi(db, prec.dal, prec.al) : Promise.resolve(null),
      serieAccessi(db, periodo.dal, periodo.al, periodo.passo),
      prec ? serieAccessi(db, prec.dal, prec.al, periodo.passo) : Promise.resolve(null),
      serieVisite(db, periodo.dal, periodo.al, periodo.passo),
      accessiNegati(db, periodo.dal, periodo.al),
      fedeltaAccessi(db, periodo.dal, periodo.al),
      sociInattivi(db, assenza, 25),
      mappaCalore(db, periodo.dal, periodo.al, gruppoCalore),
    ])
    const perVarco = await accessiPerVarco(db, periodo.dal, periodo.al, varchi)
    dati = { gruppi, gruppoCalore, riepilogo, riepilogoPrec, serie, seriePrec, visite, negati, fedelta, inattivi, calore, perVarco }
  } catch (e) {
    if (e instanceof ScriptAccessiMancante) {
      return (
        <>
          <div className="page-head">
            <h1>Accessi</h1>
          </div>
          <div className="card card-avviso">
            <p className="card-nota">{e.message}</p>
          </div>
        </>
      )
    }
    throw e
  }

  const { gruppi, gruppoCalore, riepilogo, riepilogoPrec, serie, seriePrec, visite, negati, fedelta, inattivi, calore, perVarco } = dati
  const giorniAperti = Math.max(riepilogo.giorniAperti, 1)

  // ── Le frasi «in breve»: il picco, il giorno forte, il periodo record.
  const mediaCella = (c: { passaggi: number; giorni: number }) => (c.giorni > 0 ? c.passaggi / c.giorni : 0)
  const picco = calore.reduce<(typeof calore)[number] | null>((m, c) => (!m || mediaCella(c) > mediaCella(m) ? c : m), null)
  const perGiorno = GIORNI_SETTIMANA.map((nome, i) => {
    const celle = calore.filter((c) => c.giornoSettimana === i + 1)
    const giorni = celle[0]?.giorni ?? 0
    return { nome, media: giorni > 0 ? celle.reduce((s, c) => s + c.passaggi, 0) / giorni : 0 }
  })
  const giornoForte = perGiorno.reduce((m, g) => (g.media > m.media ? g : m), perGiorno[0])
  const giornoDebole = perGiorno.filter((g) => g.media > 0).reduce((m, g) => (g.media < m.media ? g : m), giornoForte)
  const record = serie.reduce((m, p) => (p.totale > m.totale ? p : m), serie[0])
  const totaleNegati = negati.reduce((s, r) => s + r.n, 0)
  const quotaNegati = riepilogo.passaggi + riepilogo.negati > 0 ? (riepilogo.negati / (riepilogo.passaggi + riepilogo.negati)) * 100 : 0

  // ── Per gruppo (o per varco, se i gruppi non ci sono ancora).
  const nomeGruppo = new Map(gruppi.map((g) => [g.id, g]))
  const peso = new Map<string, number>()
  for (const v of perVarco) peso.set(v.gruppoId ?? '-', (peso.get(v.gruppoId ?? '-') ?? 0) + v.passaggi)
  const vociGruppo: VoceBarra[] = [...peso.entries()]
    .map(([id, valore]): VoceBarra => ({
      chiave: id,
      etichetta: nomeGruppo.get(id)?.nome ?? ETICHETTA_SENZA_GRUPPO,
      valore,
      colore: nomeGruppo.get(id)?.colore ?? COLORE_SENZA_GRUPPO,
    }))
    .sort((a, b) => b.valore - a.valore)
  const vociVarco: VoceBarra[] = perVarco
    .filter((v) => v.passaggi > 0)
    .map((v) => ({
      chiave: v.chiave,
      etichetta: v.descrizione,
      valore: v.passaggi,
      colore: nomeGruppo.get(v.gruppoId ?? '')?.colore ?? COLORE_SENZA_GRUPPO,
      nota: v.gruppoId ? nomeGruppo.get(v.gruppoId)?.nome : undefined,
    }))
  const haGruppi = gruppi.length > 0

  const conParametri = (extra: Record<string, string>) => {
    const q = new URLSearchParams()
    if (searchParams.periodo) q.set('periodo', searchParams.periodo)
    if (searchParams.dal && searchParams.al && !searchParams.periodo) {
      q.set('dal', searchParams.dal)
      q.set('al', searchParams.al)
    }
    for (const [k, v] of Object.entries(extra)) q.set(k, v)
    return `/dashboard/accessi?${q.toString()}`
  }

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Report</p>
        <h1>Accessi</h1>
        <p className="muted">Gli ingressi al club dai varchi: quanta gente viene, quando e da dove.</p>
        <NavAccessi attiva="panoramica" />
        <SelettorePeriodo periodo={periodo} percorso="/dashboard/accessi" altri={{ gruppo: gruppoCalore ?? undefined, assenza: String(assenza) }} />
      </div>

      <div className="accessi-numeri">
        <SchedaNumero
          etichetta="Visite"
          valore={numero(riepilogo.visite)}
          attuale={riepilogo.visite}
          precedente={riepilogoPrec ? riepilogoPrec.visite : null}
          dettaglio="persona × giorno"
          serie={visite.map((p) => p.visite)}
        />
        <SchedaNumero
          etichetta="Persone diverse"
          valore={numero(riepilogo.persone)}
          attuale={riepilogo.persone}
          precedente={riepilogoPrec ? riepilogoPrec.persone : null}
          serie={visite.map((p) => p.persone)}
        />
        <SchedaNumero
          etichetta="Passaggi ai varchi"
          valore={numero(riepilogo.passaggi)}
          attuale={riepilogo.passaggi}
          precedente={riepilogoPrec ? riepilogoPrec.passaggi : null}
          serie={serie.map((p) => p.totale)}
        />
        <SchedaNumero
          etichetta="Visite al giorno"
          valore={numero(Math.round(riepilogo.visite / giorniAperti))}
          attuale={riepilogo.visite / giorniAperti}
          precedente={riepilogoPrec ? riepilogoPrec.visite / Math.max(riepilogoPrec.giorniAperti, 1) : null}
          dettaglio="in media"
        />
        <SchedaNumero
          etichetta="Ingressi negati"
          valore={numero(riepilogo.negati)}
          dettaglio={`${quotaNegati.toFixed(1).replace('.', ',')}% dei tentativi`}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>In breve</h2>
        </div>
        <ul className="accessi-breve">
          {picco && mediaCella(picco) > 0 && (
            <li>
              <strong>Ora di punta:</strong> {GIORNI_SETTIMANA[picco.giornoSettimana - 1]} alle {oraTesto(picco.ora)}, in media{' '}
              {Math.round(mediaCella(picco))} passaggi in quell&apos;ora.
            </li>
          )}
          {giornoForte && giornoForte.media > 0 && (
            <li>
              <strong>Giorno più affollato:</strong> {giornoForte.nome} ({numero(Math.round(giornoForte.media))} passaggi in media)
              {giornoDebole && giornoDebole.nome !== giornoForte.nome && (
                <>
                  , il più tranquillo {giornoDebole.nome} ({numero(Math.round(giornoDebole.media))}).
                </>
              )}
            </li>
          )}
          {record && record.totale > 0 && (
            <li>
              <strong>Record del periodo:</strong> {etichettaPeriodo(record.periodo, periodo.passo, true)} con {numero(record.totale)} passaggi.
            </li>
          )}
          {negati[0] && (
            <li>
              <strong>Ingressi negati:</strong> il motivo più frequente è «{negati[0].descrizione}» ({numero(negati[0].n)} su {numero(totaleNegati)}).
            </li>
          )}
          {inattivi.length > 0 && (
            <li>
              <strong>Da richiamare:</strong> {inattivi.length === 25 ? 'almeno 25' : inattivi.length} soci con un abbonamento in corso non entrano da
              oltre {assenza} giorni (elenco in fondo).
            </li>
          )}
        </ul>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Tendenza dei passaggi</h2>
          <span className="muted">
            per {periodo.passo === 'day' ? 'giorno' : periodo.passo === 'week' ? 'settimana' : 'mese'}
            {seriePrec ? ', con il periodo precedente' : ''}
          </span>
        </div>
        <GraficoTendenza serie={serie} precedente={seriePrec} gruppi={gruppi} passo={periodo.passo} />
      </div>

      <div className="accessi-coppia">
        <div className="card">
          <div className="card-head">
            <h2>Quando c&apos;è gente</h2>
            <span className="muted">passaggi medi per ora</span>
          </div>
          {haGruppi && (
            <div className="agenda-nav accessi-filtro-gruppo">
              <Link href={conParametri({ assenza: String(assenza) })} className={`btn btn-sm ${gruppoCalore ? 'btn-ghost' : ''}`}>
                Tutti i varchi
              </Link>
              {gruppi.map((g) => (
                <Link
                  key={g.id}
                  href={conParametri({ gruppo: g.id, assenza: String(assenza) })}
                  className={`btn btn-sm ${gruppoCalore === g.id ? '' : 'btn-ghost'}`}
                >
                  {g.nome}
                </Link>
              ))}
            </div>
          )}
          <MappaCalore celle={calore} />
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Quanto vengono</h2>
            <span className="muted">persone per frequenza</span>
          </div>
          <IstogrammaFedelta fasce={fedelta} />
        </div>
      </div>

      <div className="accessi-coppia">
        <div className="card">
          <div className="card-head">
            <h2>{haGruppi ? 'Passaggi per gruppo' : 'Passaggi per varco'}</h2>
            <Link href="/dashboard/accessi/gruppi" className="link">
              {haGruppi ? 'Gestisci i gruppi →' : 'Crea i gruppi →'}
            </Link>
          </div>
          <BarreOrizzontali voci={haGruppi ? vociGruppo : vociVarco.slice(0, 12)} />
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Ingressi negati</h2>
            <span className="muted">per motivo</span>
          </div>
          <BarreOrizzontali
            voci={negati.map((r) => ({ chiave: String(r.tipo), etichetta: r.descrizione, valore: r.n, colore: 'var(--error)' }))}
            vuoto="Nessun ingresso negato nel periodo."
          />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Per varco</h2>
          <span className="muted">passaggi nel periodo</span>
        </div>
        {haGruppi ? (
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Varco</th>
                  <th>Gruppo</th>
                  <th className="accessi-num">Passaggi</th>
                  <th className="accessi-num">Negati</th>
                </tr>
              </thead>
              <tbody>
                {perVarco.map((v) => (
                  <tr key={v.chiave}>
                    <td>{v.descrizione}</td>
                    <td>
                      {v.gruppoId && nomeGruppo.get(v.gruppoId) ? (
                        <span className="accessi-chip">
                          <i className="accessi-pallino" style={{ background: nomeGruppo.get(v.gruppoId)!.colore }} /> {nomeGruppo.get(v.gruppoId)!.nome}
                        </span>
                      ) : (
                        <span className="muted">{ETICHETTA_SENZA_GRUPPO}</span>
                      )}
                    </td>
                    <td className="accessi-num">{numero(v.passaggi)}</td>
                    <td className="accessi-num">{v.negati ? numero(v.negati) : <span className="muted">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <BarreOrizzontali voci={vociVarco} />
        )}
        <p className="muted card-nota">
          Info4U non distingue entrate e uscite: «ingresso» e «uscita» del tornello sono entrambi passaggi.
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Soci da richiamare</h2>
          <span className="muted">abbonamento in corso, senza ingressi da</span>
        </div>
        <div className="agenda-nav">
          {SOGLIE_ASSENZA.map((g) => (
            <Link key={g} href={conParametri({ assenza: String(g) })} className={`btn btn-sm ${assenza === g ? '' : 'btn-ghost'}`}>
              {g} giorni
            </Link>
          ))}
        </div>
        {inattivi.length === 0 ? (
          <p className="vuoto">Nessun socio con abbonamento in corso è assente da più di {assenza} giorni.</p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Socio</th>
                  <th>Abbonamento</th>
                  <th>Scade</th>
                  <th>Ultimo ingresso</th>
                  <th className="accessi-num">Assente da</th>
                </tr>
              </thead>
              <tbody>
                {inattivi.map((s) => (
                  <tr key={s.personaId}>
                    <td>
                      <Link href={`/dashboard/persone/${s.personaId}`} className="link">
                        {[s.cognome, s.nome].filter(Boolean).join(' ') || 'Senza nome'}
                      </Link>
                    </td>
                    <td>{s.abbonamento ?? <span className="muted">—</span>}</td>
                    <td>{s.dataFine ? dataBreve(s.dataFine) : <span className="muted">—</span>}</td>
                    <td>{dataBreve(s.ultimoIngresso)}</td>
                    <td className="accessi-num">{s.giorniAssenza} giorni</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted card-nota">I primi sono quelli che hanno smesso da poco: sono i più facili da riportare in sede.</p>
      </div>
    </>
  )
}
