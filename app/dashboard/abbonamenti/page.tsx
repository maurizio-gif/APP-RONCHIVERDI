import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { euro } from '@/lib/pipeline'
import { oggiRoma } from '@/lib/agenda'
import ObiettivoMensile from './ObiettivoMensile'

export const dynamic = 'force-dynamic'

type Somma = { vendite: number; fatturato: number }

function sommaRighe(righe: { numero_vendite: number; fatturato: number | null }[] | null): Somma {
  return (righe ?? []).reduce(
    (acc, r) => ({ vendite: acc.vendite + r.numero_vendite, fatturato: acc.fatturato + Number(r.fatturato ?? 0) }),
    { vendite: 0, fatturato: 0 }
  )
}

// Percentuale E differenza in euro, non solo la percentuale: un +5% su un
// mese piccolo e un +5% su un mese grande raccontano storie diverse, e la
// direzione vuole vedere subito quanti euro sono, non solo il rapporto.
function testoVariazione(attuale: number, precedente: number): string {
  if (precedente <= 0) return '—'
  const percentuale = Math.round(((attuale - precedente) / precedente) * 100)
  const differenza = attuale - precedente
  const segnoPercentuale = percentuale > 0 ? '+' : ''
  const segnoEuro = differenza > 0 ? '+' : differenza < 0 ? '-' : ''
  return `${segnoPercentuale}${percentuale}% (${segnoEuro}${euro(Math.abs(differenza))})`
}

// L'ultimo giorno valido di un mese: per il confronto "stesso periodo" un 31
// di un mese di 30 giorni (o un 29 febbraio su un anno non bisestile) va
// riportato all'ultimo giorno disponibile in quell'anno, non fuori mese.
function ultimoGiornoDelMese(anno: number, mese: number): number {
  return new Date(Date.UTC(anno, mese, 0)).getUTCDate()
}

export default async function AbbonamentiPage() {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  const oggi = oggiRoma()
  const annoCorrente = Number(oggi.slice(0, 4))
  const mese = Number(oggi.slice(5, 7))
  const giornoCorrente = Number(oggi.slice(8, 10))
  const nomeMese = new Date(`${oggi}T12:00:00Z`).toLocaleDateString('it-IT', { month: 'long', timeZone: 'UTC' })

  const supabase = createSupabaseServiceClient()

  // Sezione 1: stesso numero di giorni (dal 1 al giorno di oggi) messo a
  // confronto sui tre anni — non ha senso confrontare 18 giorni di
  // quest'anno con 30 giorni interi dell'anno scorso, quindi qui si taglia
  // sempre allo stesso punto del mese.
  const anniConfronto = [annoCorrente - 2, annoCorrente - 1, annoCorrente]
  const periodiPari = await Promise.all(
    anniConfronto.map(async (anno) => {
      const mm = String(mese).padStart(2, '0')
      const giornoFine = String(Math.min(giornoCorrente, ultimoGiornoDelMese(anno, mese))).padStart(2, '0')
      const { data } = await supabase
        .from('abbonamenti_giornalieri')
        .select('numero_vendite, fatturato')
        .gte('giorno', `${anno}-${mm}-01`)
        .lte('giorno', `${anno}-${mm}-${giornoFine}`)
      return { anno, ...sommaRighe(data) }
    })
  )

  // Sezione 2: il mese intero (non tagliato a oggi) degli ultimi due anni
  // già conclusi — a parte apposta, per non confonderlo con il confronto a
  // parità di giorni qui sopra: qui il mese corrente NON compare, perché non
  // è ancora finito.
  const anniMeseIntero = [annoCorrente - 2, annoCorrente - 1]
  const mesiInteri = await Promise.all(
    anniMeseIntero.map(async (anno) => {
      const mm = String(mese).padStart(2, '0')
      const { data } = await supabase
        .from('abbonamenti_mensili')
        .select('numero_vendite, fatturato')
        .eq('mese', `${anno}-${mm}-01`)
      return { anno, ...sommaRighe(data) }
    })
  )

  const meseCorrenteData = `${annoCorrente}-${String(mese).padStart(2, '0')}-01`
  const { data: obiettivoRiga } = await supabase
    .from('abbonamenti_obiettivi_mensili')
    .select('goal')
    .eq('mese', meseCorrenteData)
    .maybeSingle()
  const fatturatoAdOggi = periodiPari[periodiPari.length - 1]?.fatturato ?? 0

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Vendite</p>
        <h1>Abbonamenti</h1>
        <p className="muted">Le vendite di abbonamenti sincronizzate da Info4U, con reportistica giornaliera e mensile.</p>
      </div>

      <div className="card">
        <p className="filtri-titolo">
          Dal 1 al {giornoCorrente} {nomeMese} — confronto a parità di giorni
        </p>
        <div className="tabella-wrap">
          <table className="tabella">
            <thead>
              <tr>
                <th>Anno</th>
                <th>Vendite</th>
                <th>Fatturato</th>
                <th>Var. vs anno prec.</th>
              </tr>
            </thead>
            <tbody>
              {periodiPari.map((p, i) => (
                <tr key={p.anno} className={p.anno === annoCorrente ? 'is-oggi' : ''}>
                  <td>{p.anno}</td>
                  <td>{p.vendite || '—'}</td>
                  <td>{p.fatturato ? euro(p.fatturato) : '—'}</td>
                  <td>{i === 0 ? '—' : testoVariazione(p.fatturato, periodiPari[i - 1].fatturato)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ObiettivoMensile mese={meseCorrenteData} goalIniziale={obiettivoRiga?.goal ?? null} fatturatoAdOggi={fatturatoAdOggi} />
      </div>

      <div className="card">
        <p className="filtri-titolo">Fatturato di {nomeMese}, mese intero — anni passati</p>
        <div className="tabella-wrap">
          <table className="tabella">
            <thead>
              <tr>
                <th>Anno</th>
                <th>Vendite</th>
                <th>Fatturato</th>
              </tr>
            </thead>
            <tbody>
              {mesiInteri.map((m) => (
                <tr key={m.anno}>
                  <td>{m.anno}</td>
                  <td>{m.vendite || '—'}</td>
                  <td>{m.fatturato ? euro(m.fatturato) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <p className="filtri-titolo">Report</p>
        <div className="form-row">
          <Link href="/dashboard/abbonamenti/report" className="btn btn-grande">
            Report giornaliero
          </Link>
          <Link href="/dashboard/abbonamenti/andamento" className="btn btn-grande">
            Andamento mensile
          </Link>
        </div>
      </div>

      <div className="card">
        <p className="filtri-titolo">Configurazione</p>
        <p className="muted">
          I prodotti venduti in Info4U vanno raggruppati a mano (es. Soci Gold, Corsi, Tennis...) per comparire
          correttamente nei report qui sopra.
        </p>
        <Link href="/dashboard/abbonamenti/gruppi" className="btn btn-ghost btn-sm">
          Gestisci gruppi prodotto
        </Link>
      </div>
    </div>
  )
}
