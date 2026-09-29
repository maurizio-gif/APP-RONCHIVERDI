import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { leggiPaginato } from '@/lib/supabase/leggiPaginato'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { caricaAndamentoPerGruppo, caricaGruppi, etichettaMeseBreve, type VoceGruppoStack, type VoceLegendaStack, type VoceMeseStack } from '@/lib/abbonamenti'
import { etichettaMese, mesePiu, oggiRoma, primoDelMese } from '@/lib/agenda'
import { GraficoPerGruppo } from './GraficoPerGruppo'
import { ChipGruppi, FiltroGruppi, GraficoPerGruppoFiltrato } from './FiltroGruppi'
import {
  AndamentoRinnovi,
  AndamentoVenduto,
  AttiviOggiPerGruppo,
  ObiettivoDelMese,
  ScadenzeProssime,
  TabellaConfrontoAnni,
  type RigaScadenze,
  type RigaVenditeTipo,
  type RigaVenditeTipoMese,
} from './SezioniFiltrate'
import { COLORE_NUOVO, COLORE_RINNOVO } from './colori'

export const dynamic = 'force-dynamic'

// L'ultimo giorno valido di un mese: per il confronto "stesso periodo" un 31
// di un mese di 30 giorni (o un 29 febbraio su un anno non bisestile) va
// riportato all'ultimo giorno disponibile in quell'anno, non fuori mese.
function ultimoGiornoDelMese(anno: number, mese: number): number {
  return new Date(Date.UTC(anno, mese, 0)).getUTCDate()
}

type RigaVenditeTipoGrezza = { gruppo_id: string | null; rinnovo: boolean; numero_vendite: number; fatturato: number | null }

function venditeTipo(r: RigaVenditeTipoGrezza): RigaVenditeTipo {
  return { gruppoId: r.gruppo_id, rinnovo: r.rinnovo, vendite: Number(r.numero_vendite), fatturato: Number(r.fatturato ?? 0) }
}

// Il filtro gruppi (i chip in cima) lo applica il browser, vedi
// FiltroGruppi.tsx e SezioniFiltrate.tsx: la pagina legge tutto UNA volta,
// senza filtro e già spezzato per gruppo, così cambiare gruppo non torna sul
// server — prima ogni chip rifaceva qui tutte le letture, una dopo l'altra,
// alcune da più secondi l'una (le viste nuovo/rinnovo e scadenze cercano per
// ogni vendita un abbonamento precedente o successivo della stessa persona).
export default async function AbbonamentiPage() {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  const oggi = oggiRoma()
  const annoCorrente = Number(oggi.slice(0, 4))
  const mese = Number(oggi.slice(5, 7))
  const giornoCorrente = Number(oggi.slice(8, 10))
  const nomeMese = new Date(`${oggi}T12:00:00Z`).toLocaleDateString('it-IT', { month: 'long', timeZone: 'UTC' })

  const supabase = createSupabaseServiceClient()

  // Sezione 4: stesso numero di giorni (dal 1 al giorno di oggi) messo a
  // confronto sui tre anni — non ha senso confrontare 18 giorni di
  // quest'anno con 30 giorni interi dell'anno scorso, quindi qui si taglia
  // sempre allo stesso punto del mese. Una riga per giorno×gruppo×tipo: con
  // tutti i gruppi insieme un mese si avvicina alle 1000 righe, quindi si
  // pagina (vedi leggiPaginato).
  const anniConfronto = [annoCorrente - 2, annoCorrente - 1, annoCorrente]
  async function venditeTipoDelPeriodo(anno: number) {
    const mm = String(mese).padStart(2, '0')
    const giornoFine = String(Math.min(giornoCorrente, ultimoGiornoDelMese(anno, mese))).padStart(2, '0')
    const { righe, error } = await leggiPaginato<RigaVenditeTipoGrezza>((da) =>
      supabase
        .from('abbonamenti_giornalieri_tipo')
        .select('gruppo_id, rinnovo, numero_vendite, fatturato')
        .gte('giorno', `${anno}-${mm}-01`)
        .lte('giorno', `${anno}-${mm}-${giornoFine}`)
        .range(da, da + 999)
    )
    return { anno, righe: righe.map(venditeTipo), error }
  }

  // Sezione 6: gli ultimi 12 mesi (compreso quello in corso, parziale) di
  // abbonati attivi a fine mese, per gruppo — più gli attivi di oggi della
  // sezione 1. Logica condivisa con la Dashboard Direzionale (vedi
  // lib/abbonamenti.ts, caricaAndamentoPerGruppo): stessi colori, stessa
  // definizione di "attivo", un solo posto da aggiornare.
  const meseCorrenteData = `${annoCorrente}-${String(mese).padStart(2, '0')}-01`
  const ultimi12Mesi = Array.from({ length: 12 }, (_, i) => mesePiu(meseCorrenteData, i - 11))

  // Scadenze: mese corrente e i tre successivi (sezione 2). Ultimi 24 mesi,
  // compreso quello in corso (parziale): finestra condivisa dal grafico
  // Andamento rinnovi (sezione 3) e dal grafico Andamento venduto (sezione 5)
  // — due anni e non uno, a differenza del grafico attivi (rimasto su
  // ultimi12Mesi), per vedere la stagionalità anno su anno.
  const mesiScadenza = Array.from({ length: 4 }, (_, i) => mesePiu(meseCorrenteData, i))
  const ultimi24Mesi = Array.from({ length: 24 }, (_, i) => mesePiu(meseCorrenteData, i - 23))

  // Sezioni 2 e 3 leggono la stessa vista GIÀ aggregata
  // (abbonamenti_scadenze_mensili, una riga per mese×gruppo×rinnovato) e non
  // le righe grezze: un mese di punta (settembre, oltre 1500 scadenze)
  // supererebbe da solo il limite di 1000 righe di PostgREST. Una lettura
  // sola per le due finestre (24 mesi passati + 3 futuri), invece di due:
  // stessa definizione di "rinnovato" (stesso gruppo, entro 30 giorni dalla
  // scadenza — vedi scripts/sql/2026-09-21-abbonamenti-scadenze-30-
  // giorni.sql). Il dettaglio persona per persona si legge nella pagina
  // /scadenze (vedi scripts/sql/2026-09-21-abbonamenti-scadenze.sql).
  async function caricaScadenze() {
    const { righe, error } = await leggiPaginato<{
      mese: string
      gruppo_id: string | null
      rinnovato: boolean
      numero: number
      valore: number | null
    }>((da) =>
      supabase
        .from('abbonamenti_scadenze_mensili')
        .select('mese, gruppo_id, rinnovato, numero, valore')
        .gte('mese', ultimi24Mesi[0])
        .lt('mese', mesePiu(meseCorrenteData, 4))
        .range(da, da + 999)
    )
    const scadenze: RigaScadenze[] = righe.map((r) => ({
      mese: primoDelMese(r.mese),
      gruppoId: r.gruppo_id,
      rinnovato: r.rinnovato,
      numero: Number(r.numero),
      valore: Number(r.valore ?? 0),
    }))
    return { scadenze, error }
  }

  // Punto 5: il VENDUTO (ogni vendita del periodo, non le scadenze) diviso
  // nuovo/rinnovo — stessa vista e definizione del punto 4
  // (abbonamenti_vendite_tipo), aggregata per mese invece che per giorno (vedi
  // abbonamenti_mensili_tipo: 2026-09-22-abbonamenti-mensili-tipo.sql).
  async function caricaVenditeTipoMensili() {
    const { righe, error } = await leggiPaginato<RigaVenditeTipoGrezza & { mese: string }>((da) =>
      supabase
        .from('abbonamenti_mensili_tipo')
        .select('mese, gruppo_id, rinnovo, numero_vendite, fatturato')
        .in('mese', ultimi24Mesi)
        .range(da, da + 999)
    )
    const vendite: RigaVenditeTipoMese[] = righe.map((r) => ({ mese: primoDelMese(r.mese), ...venditeTipo(r) }))
    return { vendite, error }
  }

  // Tutte le letture sono indipendenti: partono insieme, invece che una dopo
  // l'altra come prima. L'andamento per gruppo aspetta solo i gruppi (servono
  // per nomi e colori), non il resto.
  const gruppiInArrivo = caricaGruppi()
  const [
    gruppi,
    { attiviOggiPerGruppo, erroreAttiviOggi, serieAttiviMensile, legendaAttivi, erroreStoricoAttivi },
    periodiPari,
    { scadenze, error: erroreScadenze },
    { vendite: venditeTipoMensili, error: erroreVenditeTipoMensile },
    { data: passGrezzi, error: errorePass },
    { data: obiettiviGrezzi },
  ] = await Promise.all([
    gruppiInArrivo,
    gruppiInArrivo.then((g) => caricaAndamentoPerGruppo(supabase, g, [], false, meseCorrenteData, ultimi12Mesi)),
    Promise.all(anniConfronto.map(venditeTipoDelPeriodo)),
    caricaScadenze(),
    caricaVenditeTipoMensili(),
    // Sezione PASS: quanti pass (gruppo Pass) scadono ogni mese e quanti di
    // quei clienti hanno sottoscritto un vero abbonamento (un gruppo diverso
    // da Pass) entro i 30 giorni successivi alla scadenza — vedi
    // abbonamenti_pass_conversioni/abbonamenti_pass_mensili
    // (2026-09-24-abbonamenti-pass-conversioni.sql).
    supabase
      .from('abbonamenti_pass_mensili')
      .select('mese, guest_pass, pass_scaduti, convertiti')
      .gte('mese', ultimi24Mesi[0])
      .lt('mese', mesePiu(meseCorrenteData, 1)),
    // Tutti gli obiettivi del mese, generale (gruppo_id null) e per gruppo:
    // quale mostrare dipende dal filtro, e lo sceglie ObiettivoDelMese.
    supabase.from('abbonamenti_obiettivi_mensili').select('gruppo_id, goal').eq('mese', meseCorrenteData),
  ])
  const erroreConfrontoTipo = periodiPari.find((p) => p.error)?.error ?? null
  const attiviOggi = Array.from(attiviOggiPerGruppo, ([gruppoId, attivi]) => ({ gruppoId, attivi }))
  const obiettivi = (obiettiviGrezzi ?? []).map((o) => ({ gruppoId: o.gruppo_id as string | null, goal: o.goal as number | null }))

  // La barra PASS somma le due quantità (pass scaduti + abbonamenti
  // sottoscritti a seguito), non le partiziona: un pass convertito conta sia
  // da un lato sia dall'altro, perché qui la domanda non è "quanti pass sono
  // stati smaltiti" ma "quanto pesano le due cose l'una accanto all'altra".
  // Non risente del filtro gruppi della pagina: la sezione è già ancorata al
  // gruppo Pass da sola.
  const passPerMese = new Map<string, { guestPass: number; scaduti: number; convertiti: number }>()
  for (const r of passGrezzi ?? []) {
    passPerMese.set(primoDelMese(r.mese), { guestPass: r.guest_pass, scaduti: r.pass_scaduti, convertiti: r.convertiti })
  }

  const seriePassMensile: VoceMeseStack[] = ultimi24Mesi.map((m) => {
    const voce = passPerMese.get(m) ?? { guestPass: 0, scaduti: 0, convertiti: 0 }
    const voci: VoceGruppoStack[] = [
      {
        gruppoId: 'pass-scaduti',
        nome: 'Pass scaduti',
        colore: COLORE_NUOVO,
        valore: voce.scaduti,
        valoreTesto: String(voce.scaduti),
        dettaglio: `${voce.guestPass} guest pass`,
      },
      {
        gruppoId: 'pass-convertiti',
        nome: 'Abbonamenti sottoscritti a seguito',
        colore: COLORE_RINNOVO,
        valore: voce.convertiti,
        valoreTesto: String(voce.convertiti),
      },
    ]
    const totale = voce.scaduti + voce.convertiti
    return { mese: m, etichetta: etichettaMeseBreve(m), gruppi: voci, totale, totaleTesto: String(totale) }
  })

  const legendaPass: VoceLegendaStack[] = [
    { chiave: 'pass-scaduti', nome: 'Pass scaduti', colore: COLORE_NUOVO },
    { chiave: 'pass-convertiti', nome: 'Abbonamenti sottoscritti a seguito', colore: COLORE_RINNOVO },
  ]

  // Stesso dato aggregato del tasso di rinnovo complessivo (sezione 3), ma
  // per il tasso di conversione pass → abbonamento sull'intera finestra.
  const totaliPass = Array.from(passPerMese.values()).reduce(
    (acc, v) => ({ scaduti: acc.scaduti + v.scaduti, convertiti: acc.convertiti + v.convertiti }),
    { scaduti: 0, convertiti: 0 }
  )
  const percentoConversionePass =
    totaliPass.scaduti > 0 ? Math.round((totaliPass.convertiti / totaliPass.scaduti) * 100) : null

  const mesiScadenzaEtichettati = mesiScadenza.map((m) => ({ mese: m, etichetta: etichettaMese(m) }))
  const ultimi24MesiEtichettati = ultimi24Mesi.map((m) => ({ mese: m, etichetta: etichettaMeseBreve(m) }))
  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Vendite</p>
        <h1>Abbonamenti</h1>
        <p className="muted">Le vendite di abbonamenti sincronizzate da Info4U, con reportistica giornaliera e mensile.</p>
      </div>

      <FiltroGruppi gruppi={gruppi.map((g) => ({ id: g.id, nome: g.nome }))}>
        <div className="filtri">
          <p className="filtri-titolo">Gruppo (selezione multipla)</p>
          <div className="filtri-gruppi">
            <ChipGruppi />
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
            <AttiviOggiPerGruppo attivi={attiviOggi} />
          </div>
        )}

        {erroreScadenze && /abbonamenti_scadenze/.test(erroreScadenze.message) ? (
          <div className="card">
            <p className="vuoto">
              Manca la vista delle scadenze: esegui scripts/sql/2026-09-21-abbonamenti-scadenze.sql (e la migration
              successiva, sui 30 giorni) nel SQL Editor di Supabase.
            </p>
          </div>
        ) : (
          <>
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
              <ScadenzeProssime mesi={mesiScadenzaEtichettati} righe={scadenze} />
            </div>

            <div className="card">
              <p className="filtri-titolo">
                <span className="numero-sezione" aria-hidden="true">
                  3
                </span>
                Andamento rinnovi, ultimi 24 mesi
              </p>
              <p className="muted">
                Abbonamenti scaduti ogni mese, rinnovati o no entro 30 giorni dalla scadenza (stesso gruppo prodotto).
                Il mese più recente può risultare sottostimato: se la scadenza è a meno di 30 giorni da oggi, la
                finestra di rinnovo non si è ancora chiusa.
              </p>
              <AndamentoRinnovi mesi={ultimi24MesiEtichettati} righe={scadenze} />
            </div>
          </>
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
              <TabellaConfrontoAnni
                anni={periodiPari.map((p) => ({ anno: p.anno, righe: p.righe }))}
                annoCorrente={annoCorrente}
              />
            </>
          )}
          <ObiettivoDelMese
            mese={meseCorrenteData}
            obiettivi={obiettivi}
            righeAnnoCorrente={periodiPari[periodiPari.length - 1]?.righe ?? []}
          />
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
            <AndamentoVenduto mesi={ultimi24MesiEtichettati} righe={venditeTipoMensili} />
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
            <GraficoPerGruppoFiltrato
              serie={serieAttiviMensile}
              legenda={legendaAttivi}
              formato="numero"
              etichettaAria="Abbonati attivi per gruppo, a fine mese, ultimi 12 mesi"
            />
          </div>
        )}
      </FiltroGruppi>

      {errorePass && /abbonamenti_pass_mensili/.test(errorePass.message) ? (
        <div className="card">
          <p className="vuoto">
            Manca la vista Pass: esegui scripts/sql/2026-09-24-abbonamenti-pass-conversioni.sql nel SQL Editor di
            Supabase.
          </p>
        </div>
      ) : (
        <div className="card">
          <p className="filtri-titolo">
            <span className="numero-sezione" aria-hidden="true">
              7
            </span>
            PASS, ultimi 24 mesi
          </p>
          <p className="muted">
            Pass in scadenza ogni mese e abbonamenti sottoscritti a seguito: la persona ha aperto un abbonamento di un
            altro gruppo entro 30 giorni dalla scadenza del pass.
          </p>
          {percentoConversionePass !== null && (
            <div className="griglia-stat">
              <div className="stat stat-ok">
                <span className="stat-testa">
                  <span className="stat-label">Tasso di conversione pass → abbonamento, ultimi 24 mesi</span>
                </span>
                <span className="stat-valore">{percentoConversionePass}%</span>
                <span className="stat-nota">
                  {totaliPass.convertiti} abbonamenti sottoscritti su {totaliPass.scaduti} pass scaduti
                </span>
              </div>
            </div>
          )}
          <GraficoPerGruppo
            serie={seriePassMensile}
            legenda={legendaPass}
            etichettaAria="Pass scaduti e abbonamenti sottoscritti a seguito, ultimi 24 mesi"
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
          <Link href="/dashboard/abbonamenti/rinnovi" className="btn btn-grande">
            Rinnovi Core
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
