import Link from 'next/link'
import { redirect } from 'next/navigation'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { leggiPaginato } from '@/lib/supabase/leggiPaginato'
import { dataIt } from '@/lib/tesseramenti'
import {
  CATEGORIA_DI_VISTA,
  ETICHETTE_VISTA,
  GIORNI_IN_SCADENZA,
  SEZIONE_CERTIFICATI,
  VISTE,
  elencoDi,
  vistaValida,
  type RigaCertificato,
  type Vista,
} from '@/lib/certificati'

export const dynamic = 'force-dynamic'

// Certificati medici: lo stato di chi ha un abbonamento in corso, calcolato
// al momento (funzione certificati_stato, vedi
// scripts/sql/2026-10-29-certificati-medici-stato.sql). Un abbonamento in
// corso è quello del report abbonamenti (vista abbonamenti_attivi_oggi_dettaglio),
// di qualunque prodotto.
//
// - In scadenza: il certificato scade entro 30 giorni;
// - Scaduti: ha avuto certificati ma nessuno è più valido;
// - Mai avuto: nessuna riga di certificato;
// - Solo provvisorio: solo righe «provvisorio» o visite prenotate, che non
//   sono certificati (la stessa regola del filtro Certificato dei Contatti);
// - Validi: scadenza oltre i 30 giorni.
//
// Ogni elenco si cerca e si esporta in CSV.

type SearchParams = Record<string, string | undefined>

export default async function CertificatiPage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await utenteHaSezione(SEZIONE_CERTIFICATI))) redirect('/dashboard')

  const supabase = createSupabaseServiceClient()
  const { righe, error } = await leggiPaginato<RigaCertificato>((da) =>
    supabase.rpc('certificati_stato', { p_giorni: GIORNI_IN_SCADENZA }).range(da, da + 999) as unknown as PromiseLike<{
      data: RigaCertificato[] | null
      error: { message: string } | null
    }>
  )

  const conteggi: Record<Vista, number> = { in_scadenza: 0, scaduti: 0, mai_avuto: 0, solo_provvisorio: 0, validi: 0 }
  for (const v of VISTE) conteggi[v] = righe.filter((r) => r.categoria === CATEGORIA_DI_VISTA[v]).length
  const totale = righe.length
  const validi = conteggi.validi + conteggi.in_scadenza
  const daSistemare = conteggi.scaduti + conteggi.mai_avuto + conteggi.solo_provvisorio
  const percentuale = totale > 0 ? Math.round((validi / totale) * 100) : 0

  const vista: Vista = vistaValida(searchParams.vista) ?? 'in_scadenza'
  const q = (searchParams.q ?? '').trim().slice(0, 80)
  const elenco = elencoDi(righe, vista, q)

  const href = (v: Vista) => {
    const p = new URLSearchParams()
    if (v !== 'in_scadenza') p.set('vista', v)
    if (q) p.set('q', q)
    const s = p.toString()
    return `/dashboard/certificati${s ? `?${s}` : ''}`
  }
  const hrefCsv = (() => {
    const p = new URLSearchParams({ vista })
    if (q) p.set('q', q)
    return `/dashboard/certificati/export?${p.toString()}`
  })()

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Segreteria</p>
        <h1>Certificati medici</h1>
      </div>

      <p className="muted">
        Lo stato dei certificati di chi ha un abbonamento in corso, ricalcolato a ogni apertura. Un certificato
        «provvisorio» o una visita prenotata non contano come certificato.
      </p>

      {error && (
        <div className="card">
          <p className="vuoto">
            Non riesco a leggere i certificati: {error.message}. Se manca la funzione, esegui
            scripts/sql/2026-10-29-certificati-medici-stato.sql nel SQL Editor di Supabase.
          </p>
        </div>
      )}

      {!error && (
        <>
          <div className="griglia-stat">
            <div className="stat">
              <span className="stat-label">Abbonati in corso</span>
              <span className="stat-valore">{totale.toLocaleString('it-IT')}</span>
              <span className="stat-nota">Con un abbonamento reale attivo.</span>
            </div>
            <div className="stat stat-ok">
              <span className="stat-label">Con certificato valido</span>
              <span className="stat-valore">{validi.toLocaleString('it-IT')}</span>
              <span className="stat-nota">{percentuale}% degli abbonati.</span>
            </div>
            <div className={`stat${conteggi.in_scadenza > 0 ? ' stat-warn' : ' stat-ok'}`}>
              <span className="stat-label">In scadenza</span>
              <span className="stat-valore">{conteggi.in_scadenza.toLocaleString('it-IT')}</span>
              <span className="stat-nota">Scade nei prossimi {GIORNI_IN_SCADENZA} giorni.</span>
            </div>
            <div className={`stat${daSistemare > 0 ? ' stat-warn' : ' stat-ok'}`}>
              <span className="stat-label">Senza certificato valido</span>
              <span className="stat-valore">{daSistemare.toLocaleString('it-IT')}</span>
              <span className="stat-nota">
                {conteggi.scaduti} scaduti, {conteggi.mai_avuto} mai avuto, {conteggi.solo_provvisorio} solo provvisorio.
              </span>
            </div>
          </div>

          <div className="card">
            <form method="get" action="/dashboard/certificati" className="check-sosp-filtri">
              {vista !== 'in_scadenza' && <input type="hidden" name="vista" value={vista} />}
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Cognome, nome, codice fiscale o email"
                aria-label="Cerca nell'elenco"
                className="input"
                style={{ minWidth: '18rem', flex: '1 1 18rem' }}
              />
              <button type="submit" className="btn">
                Cerca
              </button>
              <div className="check-sosp-gruppo" role="group" aria-label="Elenco">
                {VISTE.map((v) => (
                  <Link
                    key={v}
                    href={href(v)}
                    className={`chip${vista === v ? ' is-attivo' : ''}`}
                    aria-current={vista === v ? 'true' : undefined}
                    scroll={false}
                  >
                    {vista === v && (
                      <span className="chip-spunta" aria-hidden="true">
                        ✓
                      </span>
                    )}
                    {ETICHETTE_VISTA[v]} <span className="chip-conteggio">{conteggi[v]}</span>
                  </Link>
                ))}
              </div>
            </form>

            <p className="field-hint">{NOTA[vista]}</p>

            <div className="check-sosp-operatori">
              <span className="muted">{elenco.length.toLocaleString('it-IT')} persone</span>
              {elenco.length > 0 && (
                <a className="btn btn-sm" href={hrefCsv} download>
                  Esporta CSV
                </a>
              )}
            </div>

            {elenco.length === 0 ? (
              <div className="vuoto-buono">
                <span className="vuoto-glifo" aria-hidden="true">
                  ✓
                </span>
                <p className="vuoto-titolo">{q ? 'Nessun risultato' : 'Nessuno in questo elenco'}</p>
              </div>
            ) : (
              <Tabella righe={elenco} vista={vista} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

const NOTA: Record<Vista, string> = {
  in_scadenza: `Hanno un certificato valido che scade entro ${GIORNI_IN_SCADENZA} giorni: da avvisare per tempo, prima chi scade prima.`,
  scaduti: 'Hanno avuto un certificato, ma nessuno è più valido: prima chi è scaduto da meno.',
  mai_avuto: 'Hanno un abbonamento in corso e nessun certificato registrato.',
  solo_provvisorio: 'Hanno solo righe «provvisorio» o visite prenotate, nessun certificato vero.',
  validi: `Certificato valido oltre i prossimi ${GIORNI_IN_SCADENZA} giorni.`,
}

function Scadenza({ r }: { r: RigaCertificato }) {
  if (!r.scadenza) return <>—</>
  const g = r.giorni_alla_scadenza
  const tono = g === null ? 'badge-off' : g < 0 ? 'badge-ko' : g <= GIORNI_IN_SCADENZA ? 'badge-warn' : 'badge-ok'
  const testo = g === null ? '' : g < 0 ? `scaduto da ${-g} g` : g === 0 ? 'scade oggi' : `fra ${g} g`
  return (
    <>
      {dataIt(r.scadenza)}
      {testo && <span className={`badge ${tono}`}>{testo}</span>}
    </>
  )
}

function Tabella({ righe, vista }: { righe: RigaCertificato[]; vista: Vista }) {
  const senzaCertificato = vista === 'mai_avuto'
  return (
    <div className="tabella-wrap">
      <table className="tabella tabella-compatta">
        <thead>
          <tr>
            <th>Socio</th>
            <th>Abbonamento in corso</th>
            {!senzaCertificato && <th>Certificato</th>}
            {!senzaCertificato && <th>Emesso</th>}
            {!senzaCertificato && <th>Scadenza</th>}
            <th>Contatti</th>
          </tr>
        </thead>
        <tbody>
          {righe.map((r) => (
            <tr key={r.persona_id}>
              <td className="cella-persona">
                <Link href={`/dashboard/persone/${r.persona_id}`}>
                  {[r.cognome, r.nome].filter(Boolean).join(' ') || 'Senza nome'}
                </Link>
              </td>
              <td className="cella-troncata">
                {r.abbonamento ?? '—'}
                {r.data_fine && <span className="nota-in-riga">fino al {dataIt(r.data_fine)}</span>}
              </td>
              {!senzaCertificato && <td className="cella-troncata">{r.certificato ?? '—'}</td>}
              {!senzaCertificato && <td className="cella-nowrap">{dataIt(r.emissione)}</td>}
              {!senzaCertificato && (
                <td className="cella-nowrap">
                  <Scadenza r={r} />
                </td>
              )}
              <td className="cella-troncata">
                {r.email ?? '—'}
                {r.cellulare && <span className="nota-in-riga">{r.cellulare}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
