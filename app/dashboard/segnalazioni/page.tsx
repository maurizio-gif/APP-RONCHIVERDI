import Link from 'next/link'
import { redirect } from 'next/navigation'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import {
  CLASSE_LIVELLO,
  CLASSE_STATO,
  CLASSE_URGENZA,
  ETICHETTA_COLORE,
  ETICHETTE_STATO,
  ETICHETTE_URGENZA,
  SEZIONE_MANUTENZIONE,
  SEZIONE_SEGNALAZIONI,
  SEZIONE_SEGNALAZIONI_REPORT,
  aperta,
  coloreManutenzione,
  eManutenzione,
  inRitardo,
  quando,
  type Segnalazione,
} from '@/lib/segnalazioni'
import { leggiSegnalazioni, nomiElenchi, nomiStaff } from '@/lib/segnalazioni-server'

export const dynamic = 'force-dynamic'

// Le segnalazioni dei soci. Il filtro di partenza è «Da prendere in carico»:
// è il lavoro che aspetta qualcuno. In ritardo = non presa in carico o non
// risolta entro il tempo della sua tipologia (lib/segnalazioni.ts). Le
// richieste di manutenzione non stanno qui: hanno la loro vista (Manutenzione);
// chi le ha inviate le ritrova in «Le mie manutenzioni».

const FILTRI = [
  { chiave: 'nuove', testo: 'Da prendere in carico' },
  { chiave: 'mie', testo: 'Le mie' },
  { chiave: 'ritardo', testo: 'In ritardo' },
  { chiave: 'aperte', testo: 'Tutte le aperte' },
  { chiave: 'chiuse', testo: 'Chiuse' },
  { chiave: 'manutenzioni', testo: 'Le mie manutenzioni' },
] as const
type Filtro = (typeof FILTRI)[number]['chiave']

export default async function SegnalazioniPage({ searchParams }: { searchParams: { f?: string } }) {
  if (!(await utenteHaSezione(SEZIONE_SEGNALAZIONI))) redirect('/dashboard')
  const io = emailCorrente()
  const vedeReport = await utenteHaSezione(SEZIONE_SEGNALAZIONI_REPORT)
  const vedeManutenzione = await utenteHaSezione(SEZIONE_MANUTENZIONE)
  const filtro: Filtro = FILTRI.some((f) => f.chiave === searchParams.f) ? (searchParams.f as Filtro) : 'nuove'

  const [tutteLeRighe, elenchi, nomi] = await Promise.all([leggiSegnalazioni(), nomiElenchi(), nomiStaff()])
  const adesso = new Date()
  const tutte = tutteLeRighe.filter((s) => !eManutenzione(s))
  const mieManutenzioni = tutteLeRighe.filter((s) => eManutenzione(s) && s.raccolta_da === io)

  const regole: Record<Filtro, (s: Segnalazione) => boolean> = {
    nuove: (s) => s.stato === 'ricevuta',
    mie: (s) => aperta(s) && s.assegnato_a === io,
    ritardo: (s) => inRitardo(s, adesso),
    aperte: aperta,
    chiuse: (s) => !aperta(s),
    manutenzioni: () => true,
  }
  const conteggi = Object.fromEntries(
    FILTRI.map((f) => [f.chiave, (f.chiave === 'manutenzioni' ? mieManutenzioni : tutte).filter(regole[f.chiave]).length])
  ) as Record<Filtro, number>
  // Le aperte, le più urgenti per prime (poi le più vecchie); le chiuse, le più recenti.
  const base = filtro === 'manutenzioni' ? mieManutenzioni : tutte
  const righe = base
    .filter(regole[filtro])
    .sort((a, b) =>
      filtro === 'chiuse'
        ? b.ricevuta_il.localeCompare(a.ricevuta_il)
        : b.livello_urgenza - a.livello_urgenza || a.ricevuta_il.localeCompare(b.ricevuta_il)
    )
    .slice(0, 300)
  const nome = (email: string | null) => (email ? (nomi.get(email) ?? email) : null)

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Segreteria</p>
        <h1>Segnalazioni</h1>
        <p className="muted">Lamentele e disservizi riferiti dai soci, e richieste di manutenzione degli operatori: chi li ha in carico, da quanto, a che punto sono.</p>
      </div>

      <div className="agenda-nav" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
        <Link href="/dashboard/segnalazioni/nuova" className="btn">
          + Nuova segnalazione
        </Link>
        {FILTRI.map((f) => (
          <Link
            key={f.chiave}
            href={`/dashboard/segnalazioni?f=${f.chiave}`}
            className={`btn btn-sm ${f.chiave === filtro ? '' : 'btn-ghost'}`}
          >
            {f.testo} <span className="sg-conta">{conteggi[f.chiave]}</span>
          </Link>
        ))}
        {vedeManutenzione && (
          <Link href="/dashboard/segnalazioni/manutenzione" className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }}>
            Manutenzione →
          </Link>
        )}
        {vedeReport && (
          <Link
            href="/dashboard/segnalazioni/report"
            className="btn btn-sm btn-ghost"
            style={vedeManutenzione ? undefined : { marginLeft: 'auto' }}
          >
            Report →
          </Link>
        )}
      </div>

      <div className="card">
        {righe.length === 0 ? (
          <p className="vuoto">{filtro === 'manutenzioni' ? 'Non hai inviato richieste di manutenzione.' : 'Nessuna segnalazione con questo filtro.'}</p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Segnalazione</th>
                  <th>Tipologia</th>
                  <th>Urgenza</th>
                  <th>Stato</th>
                  <th>Assegnata a</th>
                  <th>Ricevuta</th>
                </tr>
              </thead>
              <tbody>
                {righe.map((s) => (
                  <tr key={s.id}>
                    <td className="cella-nowrap">
                      <Link href={`/dashboard/segnalazioni/${s.id}`}>#{s.numero}</Link>
                    </td>
                    <td>
                      <Link href={`/dashboard/segnalazioni/${s.id}`} className="cella-chi-nome">
                        {elenchi.settori.get(s.settore) ?? s.settore} · {elenchi.motivi.get(s.motivo) ?? s.motivo}
                      </Link>
                      <div className="cella-chi-dettagli sg-anteprima">
                        {s.socio_nome ? `${s.socio_nome} — ` : ''}
                        {s.descrizione}
                      </div>
                    </td>
                    <td className="cella-nowrap">
                      <span className={CLASSE_URGENZA[s.urgenza]}>{ETICHETTE_URGENZA[s.urgenza]}</span>
                    </td>
                    <td className="cella-nowrap">
                      <span className={CLASSE_LIVELLO[s.livello_urgenza] ?? 'badge'}>{s.livello_urgenza} / 5</span>
                    </td>
                    <td className="cella-nowrap">
                      {eManutenzione(s) ? (
                        <span className={`badge sg-colore-${coloreManutenzione(s)}`}>{ETICHETTA_COLORE[coloreManutenzione(s)]}</span>
                      ) : (
                        <span className={CLASSE_STATO[s.stato]}>{ETICHETTE_STATO[s.stato]}</span>
                      )}
                      {inRitardo(s, adesso) && <span className="badge badge-ko sg-ritardo">in ritardo</span>}
                    </td>
                    <td>{nome(s.assegnato_a) ?? <span className="muted">da assegnare</span>}</td>
                    <td className="cella-nowrap">{quando(s.ricevuta_il)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
