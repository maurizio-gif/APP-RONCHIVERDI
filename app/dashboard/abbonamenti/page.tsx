import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { caricaAndamentoPerGruppo, caricaGruppi, etichettaMeseBreve, type VoceGruppoStack, type VoceLegendaStack, type VoceMeseStack } from '@/lib/abbonamenti'
import { euro, testoVariazione } from '@/lib/pipeline'
import { etichettaMese, mesePiu, oggiRoma, primoDelMese } from '@/lib/agenda'
import ObiettivoMensile from './ObiettivoMensile'
import { GraficoPerGruppo } from './GraficoPerGruppo'

// Rinnovati/non rinnovati sono uno stato (buono/da seguire), non
// un'identità di gruppo: colori di stato — gli stessi di badge-ok/badge-warn
// già usati nella tabella di dettaglio — non la palette categorica a 8
// colori usata per i gruppi prodotto negli altri due grafici qui sotto.
const COLORE_RINNOVATO = 'var(--ok)'
const COLORE_NON_RINNOVATO = 'var(--warn)'

// Nuovo/rinnovo (punto 5) non è un giudizio di merito come rinnovato/non
// rinnovato qui sopra — è solo una partizione del venduto in due categorie,
// nessuna "buona" o "da seguire" — quindi niente colori ok/warn: la stessa
// coppia neutra già usata altrove in pagina per due categorie senza
// giudizio (vedi .grafico-barra-sito/.grafico-barra-sede in globals.css).
const COLORE_NUOVO = 'var(--accent)'
const COLORE_RINNOVO = 'var(--info)'

export const dynamic = 'force-dynamic'

type Somma = { vendite: number; fatturato: number }

// Punto 4: non solo il totale del periodo ma anche la distinzione fra
// vendite nuove e rinnovi (vedi abbonamenti_vendite_tipo — un rinnovo è una
// vendita che segue, entro 30 giorni, la scadenza di un abbonamento
// precedente della stessa persona nello stesso gruppo prodotto). "Totale" è
// sempre nuovi + rinnovi, non una terza query: qui si somma una volta sola
// leggendo lo stesso flag `rinnovo`.
type SommaTipo = { totale: Somma; nuovi: Somma; rinnovi: Somma }

const RIGHE_TIPO = [
  { chiave: 'totale', etichetta: 'Totale' },
  { chiave: 'nuovi', etichetta: 'Nuovi' },
  { chiave: 'rinnovi', etichetta: 'Rinnovi' },
] as const

function sommaVuota(): Somma {
  return { vendite: 0, fatturato: 0 }
}

function sommaPerTipo(righe: { numero_vendite: number; fatturato: number | null; rinnovo: boolean }[] | null): SommaTipo {
  const risultato: SommaTipo = { totale: sommaVuota(), nuovi: sommaVuota(), rinnovi: sommaVuota() }
  for (const r of righe ?? []) {
    const vendite = r.numero_vendite
    const fatturato = Number(r.fatturato ?? 0)
    const voce = r.rinnovo ? risultato.rinnovi : risultato.nuovi
    voce.vendite += vendite
    voce.fatturato += fatturato
    risultato.totale.vendite += vendite
    risultato.totale.fatturato += fatturato
  }
  return risultato
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
        .from('abbonamenti_giornalieri_tipo')
        .select('numero_vendite, fatturato, rinnovo')
        .gte('giorno', `${anno}-${mm}-01`)
        .lte('giorno', `${anno}-${mm}-${giornoFine}`)
      if (filtroAttivo) query = query.in('gruppo_id', gruppiSelezionati)
      const { data, error } = await query
      return { anno, ...sommaPerTipo(data), error }
    })
  )
  const erroreConfrontoTipo = periodiPari.find((p) => p.error)?.error ?? null

  // Sezione 3: gli ultimi 12 mesi (compreso quello in corso, parziale), per
  // due grafici a barre impilate per gruppo — fatturato delle vendite e
  // abbonati attivi a fine mese. Logica condivisa con la Dashboard
  // Direzionale (vedi lib/abbonamenti.ts, caricaAndamentoPerGruppo): stessi
  // colori, stessa definizione di "attivo", un solo posto da aggiornare.
  const meseCorrenteData = `${annoCorrente}-${String(mese).padStart(2, '0')}-01`
  const ultimi12Mesi = Array.from({ length: 12 }, (_, i) => mesePiu(meseCorrenteData, i - 11))

  const {
    attiviOggiPerGruppo,
    erroreAttiviOggi,
    serieAttiviMensile,
    legendaAttivi,
    erroreStoricoAttivi,
  } = await caricaAndamentoPerGruppo(supabase, gruppi, gruppiSelezionati, filtroAttivo, meseCorrenteData, ultimi12Mesi)

  const gruppiAttiviMostrati = filtroAttivo ? gruppi.filter((g) => gruppiSelezionati.includes(g.id)) : gruppi
  const nonCategorizzatoAttivi = attiviOggiPerGruppo.get(null) ?? 0
  const totaleAttivi = Array.from(attiviOggiPerGruppo.values()).reduce((tot, n) => tot + n, 0)

  // Scadenze: mese corrente e i tre successivi, con quante di quelle
  // vendite hanno già un rinnovo nello stesso gruppo. Vista GIÀ aggregata
  // (abbonamenti_scadenze_mensili) e non le righe grezze: un mese di punta
  // (settembre, oltre 1500 scadenze) supera il limite di 1000 righe che
  // PostgREST impone comunque a una select, `.limit()` del client o no —
  // aggregando lato database il risultato resta poche righe, mai vicino al
  // limite. Il dettaglio persona per persona si legge nella pagina
  // /scadenze (vedi scripts/sql/2026-09-21-abbonamenti-scadenze.sql).
  const mesiScadenza = Array.from({ length: 4 }, (_, i) => mesePiu(meseCorrenteData, i))
  let queryScadenze = supabase
    .from('abbonamenti_scadenze_mensili')
    .select('mese, gruppo_id, rinnovato, numero')
    .gte('mese', mesiScadenza[0])
    .lt('mese', mesePiu(meseCorrenteData, 4))
  if (filtroAttivo) queryScadenze = queryScadenze.in('gruppo_id', gruppiSelezionati)
  const { data: scadenzeGrezze, error: erroreScadenze } = await queryScadenze

  const scadenzePerMese = new Map<string, { totale: number; daRichiamare: number }>()
  for (const r of scadenzeGrezze ?? []) {
    const meseRiga = primoDelMese(r.mese)
    const voce = scadenzePerMese.get(meseRiga) ?? { totale: 0, daRichiamare: 0 }
    voce.totale += r.numero
    if (!r.rinnovato) voce.daRichiamare += r.numero
    scadenzePerMese.set(meseRiga, voce)
  }

  function hrefScadenze(m: string) {
    const params = new URLSearchParams({ mese: m })
    if (filtroAttivo) params.set('gruppi', gruppiSelezionati.join(','))
    return `/dashboard/abbonamenti/scadenze?${params.toString()}`
  }

  // Ultimi 24 mesi (compreso quello in corso, parziale): finestra condivisa
  // dal grafico Andamento rinnovi qui sotto e dal grafico Andamento venduto
  // al punto 5 — due anni e non uno, a differenza degli altri grafici di
  // questa pagina (rimasti su ultimi12Mesi), per vedere la stagionalità anno
  // su anno.
  const ultimi24Mesi = Array.from({ length: 24 }, (_, i) => mesePiu(meseCorrenteData, i - 23))

  // Andamento rinnovi: stessa vista aggregata della card scadenze sopra,
  // stessa definizione di "rinnovato" (stesso gruppo, entro 30 giorni dalla
  // scadenza — vedi scripts/sql/2026-09-21-abbonamenti-scadenze-30-
  // giorni.sql), ma sui mesi passati invece dei 4 futuri. Due colori di
  // STATO (rinnovato/non rinnovato), non la palette dei gruppi: qui non si
  // distinguono identità diverse, si distingue buono da "da seguire" —
  // stessi colori del badge nella pagina di dettaglio.
  let queryRinnovi = supabase
    .from('abbonamenti_scadenze_mensili')
    .select('mese, gruppo_id, rinnovato, numero')
    .gte('mese', ultimi24Mesi[0])
    .lt('mese', mesePiu(meseCorrenteData, 1))
  if (filtroAttivo) queryRinnovi = queryRinnovi.in('gruppo_id', gruppiSelezionati)
  const { data: rinnoviGrezzi, error: erroreRinnovi } = await queryRinnovi

  const rinnoviPerMese = new Map<string, { rinnovati: number; nonRinnovati: number }>()
  for (const r of rinnoviGrezzi ?? []) {
    const meseRiga = primoDelMese(r.mese)
    const voce = rinnoviPerMese.get(meseRiga) ?? { rinnovati: 0, nonRinnovati: 0 }
    if (r.rinnovato) voce.rinnovati += r.numero
    else voce.nonRinnovati += r.numero
    rinnoviPerMese.set(meseRiga, voce)
  }

  const serieRinnoviMensile: VoceMeseStack[] = ultimi24Mesi.map((m) => {
    const voce = rinnoviPerMese.get(m) ?? { rinnovati: 0, nonRinnovati: 0 }
    const voci: VoceGruppoStack[] = [
      {
        gruppoId: 'rinnovati',
        nome: 'Rinnovati',
        colore: COLORE_RINNOVATO,
        valore: voce.rinnovati,
        valoreTesto: String(voce.rinnovati),
      },
      {
        gruppoId: 'non-rinnovati',
        nome: 'Non ancora rinnovati',
        colore: COLORE_NON_RINNOVATO,
        valore: voce.nonRinnovati,
        valoreTesto: String(voce.nonRinnovati),
      },
    ]
    const totale = voce.rinnovati + voce.nonRinnovati
    const percentoRinnovati = totale > 0 ? Math.round((voce.rinnovati / totale) * 100) : null
    return {
      mese: m,
      etichetta: etichettaMeseBreve(m),
      gruppi: voci,
      totale,
      totaleTesto: String(totale),
      etichettaSopra: percentoRinnovati !== null ? `${percentoRinnovati}%` : undefined,
      notaPercentuale: percentoRinnovati !== null ? `${percentoRinnovati}% rinnovati sul totale scaduto quel mese` : undefined,
    }
  })

  const legendaRinnovi: VoceLegendaStack[] = [
    { chiave: 'rinnovati', nome: 'Rinnovati', colore: COLORE_RINNOVATO },
    { chiave: 'non-rinnovati', nome: 'Non ancora rinnovati', colore: COLORE_NON_RINNOVATO },
  ]

  // Punto 5: come sopra ma sul VENDUTO (ogni vendita del periodo, non le
  // scadenze) e diviso non per gruppo prodotto ma nuovo/rinnovo — stessa
  // vista e definizione del punto 4 (abbonamenti_vendite_tipo), aggregata
  // per mese invece che per giorno (vedi abbonamenti_mensili_tipo:
  // 2026-09-22-abbonamenti-mensili-tipo.sql). L'altezza della barra segue il
  // fatturato (il grafico si chiama "Andamento VENDUTO"), il conteggio delle
  // vendite e il peso percentuale sul mese finiscono nel dettaglio del
  // pannello al passaggio del mouse, non nella barra stessa.
  let queryVenditeTipoMensile = supabase
    .from('abbonamenti_mensili_tipo')
    .select('mese, gruppo_id, rinnovo, numero_vendite, fatturato')
    .in('mese', ultimi24Mesi)
  if (filtroAttivo) queryVenditeTipoMensile = queryVenditeTipoMensile.in('gruppo_id', gruppiSelezionati)
  const { data: venditeTipoGrezze, error: erroreVenditeTipoMensile } = await queryVenditeTipoMensile

  const venditeTipoPerMese = new Map<string, { nuovi: Somma; rinnovi: Somma }>()
  for (const r of venditeTipoGrezze ?? []) {
    const voce = venditeTipoPerMese.get(r.mese) ?? { nuovi: sommaVuota(), rinnovi: sommaVuota() }
    const parte = r.rinnovo ? voce.rinnovi : voce.nuovi
    parte.vendite += r.numero_vendite
    parte.fatturato += Number(r.fatturato ?? 0)
    venditeTipoPerMese.set(r.mese, voce)
  }

  function dettaglioVenditeTipo(parte: Somma, totaleFatturato: number): string {
    const percento = totaleFatturato > 0 ? Math.round((parte.fatturato / totaleFatturato) * 100) : 0
    return `${parte.vendite} vendite · ${percento}%`
  }

  const serieVenditeTipoMensile: VoceMeseStack[] = ultimi24Mesi.map((m) => {
    const voce = venditeTipoPerMese.get(m) ?? { nuovi: sommaVuota(), rinnovi: sommaVuota() }
    const totaleFatturato = voce.nuovi.fatturato + voce.rinnovi.fatturato
    const voci: VoceGruppoStack[] = [
      {
        gruppoId: 'nuovi',
        nome: 'Nuovi',
        colore: COLORE_NUOVO,
        valore: voce.nuovi.fatturato,
        valoreTesto: euro(voce.nuovi.fatturato) ?? '—',
        dettaglio: dettaglioVenditeTipo(voce.nuovi, totaleFatturato),
      },
      {
        gruppoId: 'rinnovi',
        nome: 'Rinnovi',
        colore: COLORE_RINNOVO,
        valore: voce.rinnovi.fatturato,
        valoreTesto: euro(voce.rinnovi.fatturato) ?? '—',
        dettaglio: dettaglioVenditeTipo(voce.rinnovi, totaleFatturato),
      },
    ]
    return {
      mese: m,
      etichetta: etichettaMeseBreve(m),
      gruppi: voci,
      totale: totaleFatturato,
      totaleTesto: euro(totaleFatturato) ?? '—',
    }
  })

  const legendaVenditeTipo: VoceLegendaStack[] = [
    { chiave: 'nuovi', nome: 'Nuovi', colore: COLORE_NUOVO },
    { chiave: 'rinnovi', nome: 'Rinnovi', colore: COLORE_RINNOVO },
  ]

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
  const fatturatoAdOggi = periodiPari[periodiPari.length - 1]?.totale.fatturato ?? 0

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

      {erroreAttiviOggi && /abbonamenti_attivi_oggi/.test(erroreAttiviOggi.message) ? (
        <div className="card">
          <p className="vuoto">
            Manca la vista degli utenti attivi: esegui scripts/sql/2026-09-21-abbonamenti-attivi.sql (e le migration
            successive con lo stesso prefisso) nel SQL Editor di Supabase.
          </p>
        </div>
      ) : (
        <div className="card">
          <p className="filtri-titolo">
            <span className="numero-sezione" aria-hidden="true">
              1
            </span>
            Utenti attivi per gruppo, a oggi
          </p>
          <p className="muted">Persone con almeno un abbonamento in corso, non scaduto — non conta le vendite.</p>
          <div className="griglia-stat">
            {!filtroAttivo && (
              <div className={`stat${totaleAttivi > 0 ? '' : ' is-vuoto'}`}>
                <span className="stat-testa">
                  <span className="stat-label">Totale</span>
                </span>
                <span className="stat-valore">{totaleAttivi}</span>
                <span className="stat-nota">In tutti i gruppi</span>
              </div>
            )}
            {gruppiAttiviMostrati.map((g) => {
              const valore = attiviOggiPerGruppo.get(g.id) ?? 0
              return (
                <div key={g.id} className={`stat${valore > 0 ? '' : ' is-vuoto'}`}>
                  <span className="stat-testa">
                    <span className="stat-label">{g.nome}</span>
                  </span>
                  <span className="stat-valore">{valore}</span>
                </div>
              )
            })}
            {!filtroAttivo && nonCategorizzatoAttivi > 0 && (
              <Link href="/dashboard/abbonamenti/gruppi?solo=attivi" className="stat stat-warn">
                <span className="stat-testa">
                  <span className="stat-label">Non categorizzato</span>
                </span>
                <span className="stat-valore">{nonCategorizzatoAttivi}</span>
                <span className="stat-nota">Assegna un gruppo ai prodotti mancanti</span>
              </Link>
            )}
          </div>
        </div>
      )}

      {erroreScadenze && /abbonamenti_scadenze/.test(erroreScadenze.message) ? (
        <div className="card">
          <p className="vuoto">
            Manca la vista delle scadenze: esegui scripts/sql/2026-09-21-abbonamenti-scadenze.sql nel SQL Editor di
            Supabase.
          </p>
        </div>
      ) : (
        <div className="card">
          <p className="filtri-titolo">
            <span className="numero-sezione" aria-hidden="true">
              2
            </span>
            Abbonamenti in scadenza
          </p>
          <p className="muted">
            Mese corrente e i tre successivi — clicca un mese per l&apos;elenco e chi deve ancora rinnovare.
          </p>
          <div className="griglia-stat">
            {mesiScadenza.map((m) => {
              const voce = scadenzePerMese.get(m) ?? { totale: 0, daRichiamare: 0 }
              return (
                <Link key={m} href={hrefScadenze(m)} className={`stat${voce.totale > 0 ? '' : ' is-vuoto'}`}>
                  <span className="stat-testa">
                    <span className="stat-label">{etichettaMese(m)}</span>
                  </span>
                  <span className="stat-valore">{voce.totale}</span>
                  {voce.daRichiamare > 0 && <span className="stat-nota">{voce.daRichiamare} non ancora rinnovati</span>}
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {erroreRinnovi && /abbonamenti_scadenze/.test(erroreRinnovi.message) ? (
        <div className="card">
          <p className="vuoto">
            Manca la vista delle scadenze: esegui scripts/sql/2026-09-21-abbonamenti-scadenze.sql (e la migration
            successiva, sui 30 giorni) nel SQL Editor di Supabase.
          </p>
        </div>
      ) : (
        <div className="card">
          <p className="filtri-titolo">
            <span className="numero-sezione" aria-hidden="true">
              3
            </span>
            Andamento rinnovi, ultimi 24 mesi
          </p>
          <p className="muted">
            Abbonamenti scaduti ogni mese, rinnovati o no entro 30 giorni dalla scadenza (stesso gruppo prodotto). Il
            mese più recente può risultare sottostimato: se la scadenza è a meno di 30 giorni da oggi, la finestra di
            rinnovo non si è ancora chiusa.
          </p>
          <GraficoPerGruppo
            serie={serieRinnoviMensile}
            legenda={legendaRinnovi}
            etichettaAria="Abbonamenti scaduti, rinnovati o no entro 30 giorni, ultimi 24 mesi"
          />
        </div>
      )}

      <div className="card">
        <p className="filtri-titolo">
          <span className="numero-sezione" aria-hidden="true">
            4
          </span>
          Dal 1 al {giornoCorrente} {nomeMese} — confronto a parità di giorni
        </p>
        {erroreConfrontoTipo && /abbonamenti_giornalieri_tipo/.test(erroreConfrontoTipo.message) ? (
          <p className="vuoto">
            Manca la vista nuovo/rinnovo: esegui scripts/sql/2026-09-22-abbonamenti-vendite-tipo.sql nel SQL Editor
            di Supabase.
          </p>
        ) : (
          <>
            <p className="muted">
              Rinnovo: la persona aveva già un abbonamento nello stesso gruppo, scaduto entro 30 giorni prima
              dell&apos;inizio di questo. Nuovo: tutto il resto.
            </p>
            <div className="tabella-wrap">
              <table className="tabella">
                <thead>
                  <tr>
                    <th>Anno</th>
                    <th>Tipo</th>
                    <th>Vendite</th>
                    <th>Fatturato</th>
                    <th>Var. vs anno prec.</th>
                  </tr>
                </thead>
                <tbody>
                  {periodiPari.map((p, i) => {
                    const precedente = periodiPari[i - 1]
                    return RIGHE_TIPO.map((riga, j) => {
                      const somma = p[riga.chiave]
                      return (
                        <tr key={`${p.anno}-${riga.chiave}`} className={p.anno === annoCorrente ? 'is-oggi' : ''}>
                          {j === 0 && <td rowSpan={RIGHE_TIPO.length}>{p.anno}</td>}
                          <td className={riga.chiave === 'totale' ? undefined : 'muted'}>{riga.etichetta}</td>
                          <td>{somma.vendite || '—'}</td>
                          <td>{somma.fatturato ? euro(somma.fatturato) : '—'}</td>
                          <td>{i === 0 ? '—' : testoVariazione(somma.fatturato, precedente[riga.chiave].fatturato)}</td>
                        </tr>
                      )
                    })
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
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

      {erroreVenditeTipoMensile && /abbonamenti_mensili_tipo/.test(erroreVenditeTipoMensile.message) ? (
        <div className="card">
          <p className="vuoto">
            Manca la vista nuovo/rinnovo: esegui scripts/sql/2026-09-22-abbonamenti-mensili-tipo.sql nel SQL Editor
            di Supabase.
          </p>
        </div>
      ) : (
        <div className="card">
          <p className="filtri-titolo">
            <span className="numero-sezione" aria-hidden="true">
              5
            </span>
            Andamento VENDUTO, ultimi 24 mesi
          </p>
          <p className="muted">
            Fatturato delle vendite del mese, diviso fra nuovo e rinnovo (stessa definizione del punto 4). Passa il
            mouse (o il focus da tastiera) su una barra per il numero di vendite e il peso percentuale di ciascuna.
          </p>
          <GraficoPerGruppo
            serie={serieVenditeTipoMensile}
            legenda={legendaVenditeTipo}
            etichettaAria="Fatturato venduto, nuovo e rinnovo, ultimi 24 mesi"
          />
        </div>
      )}

      {erroreStoricoAttivi && /abbonamenti_attivi_storico/.test(erroreStoricoAttivi.message) ? (
        <div className="card">
          <p className="vuoto">
            Manca lo storico degli attivi: esegui scripts/sql/2026-09-21-abbonamenti-attivi.sql nel SQL Editor di
            Supabase.
          </p>
        </div>
      ) : (
        <div className="card">
          <p className="filtri-titolo">
            <span className="numero-sezione" aria-hidden="true">
              6
            </span>
            Andamento abbonati attivi, fine mese
          </p>
          <p className="muted">
            Per gruppo — passa il mouse (o il focus da tastiera) su una barra per il dettaglio. L&apos;ultimo mese è
            il conteggio di oggi, non ancora congelato.
          </p>
          <GraficoPerGruppo
            serie={serieAttiviMensile}
            legenda={legendaAttivi}
            etichettaAria="Abbonati attivi per gruppo, a fine mese, ultimi 12 mesi"
          />
        </div>
      )}

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
