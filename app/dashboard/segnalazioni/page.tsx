import Link from 'next/link'
import { redirect } from 'next/navigation'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import {
  CLASSE_STATO,
  CLASSE_URGENZA,
  ETICHETTE_STATO,
  ETICHETTE_URGENZA,
  SEZIONE_SEGNALAZIONI,
  SEZIONE_SEGNALAZIONI_REPORT,
  aperta,
  inRitardo,
  quando,
  type Segnalazione,
} from '@/lib/segnalazioni'
import { leggiSegnalazioni, nomiElenchi, nomiStaff } from '@/lib/segnalazioni-server'

export const dynamic = 'force-dynamic'

// Le segnalazioni dei soci. Il filtro di partenza è «Da prendere in carico»:
// è il lavoro che aspetta qualcuno. In ritardo = non presa in carico o non
// risolta entro il tempo della sua urgenza (lib/segnalazioni.ts).

const FILTRI = [
  { chiave: 'nuove', testo: 'Da prendere in carico' },
  { chiave: 'mie', testo: 'Le mie' },
  { chiave: 'ritardo', testo: 'In ritardo' },
  { chiave: 'aperte', testo: 'Tutte le aperte' },
  { chiave: 'chiuse', testo: 'Chiuse' },
] as const
type Filtro = (typeof FILTRI)[number]['chiave']

export default async function SegnalazioniPage({ searchParams }: { searchParams: { f?: string } }) {
  if (!(await utenteHaSezione(SEZIONE_SEGNALAZIONI))) redirect('/dashboard')
  const io = emailCorrente()
  const vedeReport = await utenteHaSezione(SEZIONE_SEGNALAZIONI_REPORT)
  const filtro: Filtro = FILTRI.some((f) => f.chiave === searchParams.f) ? (searchParams.f as Filtro) : 'nuove'

  const [tutte, elenchi, nomi] = await Promise.all([leggiSegnalazioni(), nomiElenchi(), nomiStaff()])
  const adesso = new Date()

  const regole: Record<Filtro, (s: Segnalazione) => boolean> = {
    nuove: (s) => s.stato === 'ricevuta',
    mie: (s) => aperta(s) && s.assegnato_a === io,
    ritardo: (s) => inRitardo(s, adesso),
    aperte: aperta,
    chiuse: (s) => !aperta(s),
  }
  const conteggi = Object.fromEntries(FILTRI.map((f) => [f.chiave, tutte.filter(regole[f.chiave]).length])) as Record<Filtro, number>
  const righe = tutte.filter(regole[filtro]).slice(0, 300)
  const nome = (email: string | null) => (email ? (nomi.get(email) ?? email) : null)

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Segreteria</p>
        <h1>Segnalazioni soci</h1>
        <p className="muted">Lamentele e disservizi riferiti dai soci: chi li ha in carico, da quanto, a che punto sono.</p>
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
        {vedeReport && (
          <Link href="/dashboard/segnalazioni/report" className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }}>
            Report →
          </Link>
        )}
      </div>

      <div className="card">
        {righe.length === 0 ? (
          <p className="vuoto">Nessuna segnalazione con questo filtro.</p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Segnalazione</th>
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
                      <span className={CLASSE_STATO[s.stato]}>{ETICHETTE_STATO[s.stato]}</span>
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
