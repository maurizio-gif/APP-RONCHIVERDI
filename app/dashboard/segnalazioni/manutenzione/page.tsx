import Link from 'next/link'
import { redirect } from 'next/navigation'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import {
  ETICHETTA_COLORE,
  SEZIONE_MANUTENZIONE,
  aperta,
  coloreManutenzione,
  eManutenzione,
  inRitardo,
  type ColoreManutenzione,
} from '@/lib/segnalazioni'
import { leggiSegnalazioni, nomiElenchi, nomiStaff, operatoriManutenzione } from '@/lib/segnalazioni-server'
import { RigaManutenzione } from './RigaManutenzione'

export const dynamic = 'force-dynamic'

// La manutenzione: una riga per richiesta, col colore dello stato. Rosso da
// fare (nessuna data), giallo programmata (c'è la data prevista), verde fatta.
// Il responsabile scrive la data direttamente in riga e, quando serve, sceglie
// chi interviene; chi esegue segna fatto. L'origine resta sempre una
// segnalazione (tipologia «Manutenzione»): la riga porta alla sua scheda, con
// storia e foto.

const FILTRI = [
  { chiave: 'aperte', testo: 'Da fare e programmate' },
  { chiave: 'rosso', testo: 'Da fare' },
  { chiave: 'giallo', testo: 'Programmate' },
  { chiave: 'verde', testo: 'Fatte' },
  { chiave: 'tutte', testo: 'Tutte' },
] as const
type Filtro = (typeof FILTRI)[number]['chiave']

const ORDINE_COLORE: Record<ColoreManutenzione, number> = { rosso: 0, giallo: 1, verde: 2, grigio: 3 }

export default async function ManutenzionePage({ searchParams }: { searchParams: { f?: string } }) {
  if (!(await utenteHaSezione(SEZIONE_MANUTENZIONE))) redirect('/dashboard')
  const filtro: Filtro = FILTRI.some((f) => f.chiave === searchParams.f) ? (searchParams.f as Filtro) : 'aperte'

  const [tutteLeRighe, elenchi, nomi, manutentori] = await Promise.all([
    leggiSegnalazioni(),
    nomiElenchi(),
    nomiStaff(),
    operatoriManutenzione(),
  ])
  const adesso = new Date()
  const richieste = tutteLeRighe.filter((s) => eManutenzione(s) && s.stato !== 'archiviata')

  const regole: Record<Filtro, (c: ColoreManutenzione) => boolean> = {
    aperte: (c) => c === 'rosso' || c === 'giallo',
    rosso: (c) => c === 'rosso',
    giallo: (c) => c === 'giallo',
    verde: (c) => c === 'verde',
    tutte: () => true,
  }
  const conteggi = Object.fromEntries(
    FILTRI.map((f) => [f.chiave, richieste.filter((s) => regole[f.chiave](coloreManutenzione(s))).length])
  ) as Record<Filtro, number>

  // Prima il rosso, poi il giallo per data prevista (le più vicine in alto),
  // poi il verde dal più recente; a parità, le più urgenti.
  const righe = richieste
    .filter((s) => regole[filtro](coloreManutenzione(s)))
    .sort((a, b) => {
      const ca = coloreManutenzione(a)
      const cb = coloreManutenzione(b)
      if (ca !== cb) return ORDINE_COLORE[ca] - ORDINE_COLORE[cb]
      if (ca === 'giallo') return (a.intervento_previsto_il ?? '').localeCompare(b.intervento_previsto_il ?? '')
      if (ca === 'verde') return (b.risolta_il ?? '').localeCompare(a.risolta_il ?? '')
      return b.livello_urgenza - a.livello_urgenza || a.ricevuta_il.localeCompare(b.ricevuta_il)
    })
    .slice(0, 300)

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">
          <Link href="/dashboard/segnalazioni">← Segnalazioni</Link>
        </p>
        <h1>Manutenzione</h1>
        <p className="muted">
          Le richieste degli operatori, una riga per intervento. Inserisci la data prevista per programmarlo; quando è
          fatto, segnalo come fatto.
        </p>
      </div>

      <div className="sg-legenda" aria-label="Legenda dei colori">
        <span className="badge sg-colore-rosso">Da fare</span> senza data
        <span className="badge sg-colore-giallo">Programmato</span> con la data prevista
        <span className="badge sg-colore-verde">Fatto</span> intervento eseguito
      </div>

      <div className="agenda-nav" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
        <Link href="/dashboard/segnalazioni/nuova" className="btn">
          + Nuova richiesta
        </Link>
        {FILTRI.map((f) => (
          <Link
            key={f.chiave}
            href={`/dashboard/segnalazioni/manutenzione?f=${f.chiave}`}
            className={`btn btn-sm ${f.chiave === filtro ? '' : 'btn-ghost'}`}
          >
            {f.testo} <span className="sg-conta">{conteggi[f.chiave]}</span>
          </Link>
        ))}
      </div>

      <div className="card">
        {righe.length === 0 ? (
          <p className="vuoto">Nessuna richiesta con questo filtro.</p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella sg-tabella-manutenzione">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Intervento</th>
                  <th>Urgenza</th>
                  <th>Richiesto da</th>
                  <th>Interviene</th>
                  <th>Data prevista</th>
                  <th>Stato</th>
                </tr>
              </thead>
              <tbody>
                {righe.map((s) => (
                  <RigaManutenzione
                    key={s.id}
                    id={s.id}
                    numero={s.numero}
                    titolo={`${elenchi.settori.get(s.settore) ?? s.settore} · ${elenchi.motivi.get(s.motivo) ?? s.motivo}`}
                    descrizione={s.descrizione}
                    livello={s.livello_urgenza}
                    richiestoDa={nomi.get(s.raccolta_da) ?? s.raccolta_da}
                    ricevutaIl={s.ricevuta_il}
                    colore={coloreManutenzione(s)}
                    aperta={aperta(s)}
                    inRitardo={inRitardo(s, adesso)}
                    assegnatoA={s.assegnato_a}
                    dataPrevista={s.intervento_previsto_il}
                    fattaIl={s.risolta_il}
                    manutentori={manutentori}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
