import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { caricaGruppi } from '@/lib/abbonamenti'
import { euro, testoVariazione } from '@/lib/pipeline'
import { mesePiu, oggiRoma } from '@/lib/agenda'
import ObiettivoMensile from './ObiettivoMensile'
import { GraficoMensile } from './GraficoMensile'

export const dynamic = 'force-dynamic'

type Somma = { vendite: number; fatturato: number }

function sommaRighe(righe: { numero_vendite: number; fatturato: number | null }[] | null): Somma {
  return (righe ?? []).reduce(
    (acc, r) => ({ vendite: acc.vendite + r.numero_vendite, fatturato: acc.fatturato + Number(r.fatturato ?? 0) }),
    { vendite: 0, fatturato: 0 }
  )
}

// L'ultimo giorno valido di un mese: per il confronto "stesso periodo" un 31
// di un mese di 30 giorni (o un 29 febbraio su un anno non bisestile) va
// riportato all'ultimo giorno disponibile in quell'anno, non fuori mese.
function ultimoGiornoDelMese(anno: number, mese: number): number {
  return new Date(Date.UTC(anno, mese, 0)).getUTCDate()
}

export default async function AbbonamentiPage({
  searchParams,
}: {
  searchParams: { gruppi?: string }
}) {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  const oggi = oggiRoma()
  const annoCorrente = Number(oggi.slice(0, 4))
  const mese = Number(oggi.slice(5, 7))
  const giornoCorrente = Number(oggi.slice(8, 10))
  const nomeMese = new Date(`${oggi}T12:00:00Z`).toLocaleDateString('it-IT', { month: 'long', timeZone: 'UTC' })

  const gruppi = await caricaGruppi()
  const gruppiValidi = new Set(gruppi.map((g) => g.id))
  const gruppiSelezionati = (searchParams.gruppi ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((id) => gruppiValidi.has(id))
  const filtroAttivo = gruppiSelezionati.length > 0

  // "Tutti" azzera la selezione; ogni gruppo si accende/spegne senza toccare
  // gli altri già selezionati — è un filtro multi-selezione, non un singolo
  // valore come nelle altre pagine di abbonamenti.
  function hrefToggle(id: string | null) {
    if (id === null) return '/dashboard/abbonamenti'
    const attivi = new Set(gruppiSelezionati)
    if (attivi.has(id)) attivi.delete(id)
    else attivi.add(id)
    const params = new URLSearchParams()
    if (attivi.size > 0) params.set('gruppi', Array.from(attivi).join(','))
    const query = params.toString()
    return `/dashboard/abbonamenti${query ? `?${query}` : ''}`
  }

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
      let query = supabase
        .from('abbonamenti_giornalieri')
        .select('numero_vendite, fatturato')
        .gte('giorno', `${anno}-${mm}-01`)
        .lte('giorno', `${anno}-${mm}-${giornoFine}`)
      if (filtroAttivo) query = query.in('gruppo_id', gruppiSelezionati)
      const { data } = await query
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
      let query = supabase
        .from('abbonamenti_mensili')
        .select('numero_vendite, fatturato')
        .eq('mese', `${anno}-${mm}-01`)
      if (filtroAttivo) query = query.in('gruppo_id', gruppiSelezionati)
      const { data } = await query
      return { anno, ...sommaRighe(data) }
    })
  )

  // Sezione 3: gli ultimi 12 mesi (compreso quello in corso, parziale) per
  // il grafico a barre — stessi filtri delle sezioni sopra, più lo split fra
  // vendite lavorate (una richiesta, una trattativa o un'azione della
  // segreteria dietro) e non (vedi abbonamenti_mensili_lavorati e
  // lib/attivitaCommerciale.ts per la stessa classificazione altrove).
  const meseCorrenteData = `${annoCorrente}-${String(mese).padStart(2, '0')}-01`
  const ultimi12Mesi = Array.from({ length: 12 }, (_, i) => mesePiu(meseCorrenteData, i - 11))
  let queryMensile = supabase
    .from('abbonamenti_mensili_lavorati')
    .select('mese, lavorata, numero_vendite, fatturato')
    .gte('mese', ultimi12Mesi[0])
  if (filtroAttivo) queryMensile = queryMensile.in('gruppo_id', gruppiSelezionati)
  const { data: righeUltimi12 } = await queryMensile

  const fatturatoPerMese = new Map<string, { lavorato: number; nonLavorato: number }>()
  for (const r of righeUltimi12 ?? []) {
    const voce = fatturatoPerMese.get(r.mese) ?? { lavorato: 0, nonLavorato: 0 }
    if (r.lavorata) voce.lavorato += Number(r.fatturato ?? 0)
    else voce.nonLavorato += Number(r.fatturato ?? 0)
    fatturatoPerMese.set(r.mese, voce)
  }
  const serieMensile = ultimi12Mesi.map((m) => {
    const v = fatturatoPerMese.get(m) ?? { lavorato: 0, nonLavorato: 0 }
    return { mese: m, lavorato: v.lavorato, nonLavorato: v.nonLavorato }
  })

  // L'obiettivo segue lo stesso filtro delle statistiche sopra: "Tutti" mostra
  // il generale, un solo gruppo selezionato mostra e permette di impostare il
  // suo. Più gruppi insieme sono una combinazione qualunque, senza una riga
  // sua nella tabella (vedi la migration) — lì il campo resta nascosto invece
  // di sommare obiettivi di gruppi diversi come se fosse un dato solo.
  const gruppoSingolo = gruppiSelezionati.length === 1 ? gruppiSelezionati[0] : null
  const nomeGruppoSingolo = gruppoSingolo ? (gruppi.find((g) => g.id === gruppoSingolo)?.nome ?? null) : null
  const mostraObiettivo = !filtroAttivo || gruppoSingolo !== null

  let queryObiettivo = supabase.from('abbonamenti_obiettivi_mensili').select('goal').eq('mese', meseCorrenteData)
  queryObiettivo = gruppoSingolo ? queryObiettivo.eq('gruppo_id', gruppoSingolo) : queryObiettivo.is('gruppo_id', null)
  const obiettivoRiga = mostraObiettivo ? (await queryObiettivo.maybeSingle()).data : null
  const fatturatoAdOggi = periodiPari[periodiPari.length - 1]?.fatturato ?? 0

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Vendite</p>
        <h1>Abbonamenti</h1>
        <p className="muted">Le vendite di abbonamenti sincronizzate da Info4U, con reportistica giornaliera e mensile.</p>
      </div>

      <div className="filtri">
        <p className="filtri-titolo">Gruppo (selezione multipla)</p>
        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
            <Link href={hrefToggle(null)} className={`chip${!filtroAttivo ? ' is-attivo' : ''}`}>
              Tutti
            </Link>
            {gruppi.map((g) => (
              <Link
                key={g.id}
                href={hrefToggle(g.id)}
                className={`chip${gruppiSelezionati.includes(g.id) ? ' is-attivo' : ''}`}
              >
                {g.nome}
              </Link>
            ))}
          </fieldset>
        </div>
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
        {mostraObiettivo ? (
          <ObiettivoMensile
            // Forza un nuovo componente (e quindi lo stato iniziale giusto)
            // quando cambia il contesto: senza key, passare da un gruppo
            // all'altro riuserebbe l'istanza e il valore mostrato resterebbe
            // quello del gruppo precedente finché non si tocca il campo.
            key={gruppoSingolo ?? 'generale'}
            mese={meseCorrenteData}
            gruppoId={gruppoSingolo}
            etichettaContesto={nomeGruppoSingolo}
            goalIniziale={obiettivoRiga?.goal ?? null}
            fatturatoAdOggi={fatturatoAdOggi}
          />
        ) : (
          <p className="muted">Seleziona un solo gruppo per vedere o impostare il suo obiettivo del mese.</p>
        )}
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
        <p className="filtri-titolo">Andamento ultimi 12 mesi</p>
        <GraficoMensile serie={serieMensile} />
      </div>

      <div className="card">
        <p className="filtri-titolo">Report</p>
        <div className="form-row">
          <Link href="/dashboard/abbonamenti/giorno" className="btn btn-grande">
            Dettaglio abbonamenti del giorno
          </Link>
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
