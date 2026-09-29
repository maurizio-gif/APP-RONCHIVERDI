import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { euro, variazionePercentuale } from '@/lib/pipeline'
import { caricaAndamentoPerGruppo, caricaGruppi } from '@/lib/abbonamenti'
import {
  oggiRoma,
  dataBreve,
  mesePiu,
  mezzanotteRoma,
  primoDelMese,
  giornoDiIstante,
  stessoGiornoMesiFa,
} from '@/lib/agenda'
import { rangeMTD, rangeYTD, canaleVendita, type ProvenienzaVendita, type RangePeriodo } from '@/lib/direzione'
import { dataBreve as dataBreveAnno } from '@/lib/persone'
import { provenienzaDiOrigine } from '@/lib/provenienza'
import { canaleGranulare } from '@/lib/canaliTraffico'
import { percentuale, STATISTICHE_VUOTE, type CoppiaUtm, type Statistiche, type Voce } from '@/lib/analytics'
import { Ripartizione } from '@/app/dashboard/analytics/Ripartizione'
import { StatCard } from './StatCard'
import { SplitCanali, type VoceCanale } from './SplitCanali'
import { GraficoContatti, type VoceContattiMese } from './GraficoContatti'
import { GraficoVisiteSito, type VoceVisiteMese } from './GraficoVisiteSito'
import {
  ChipGruppi,
  FiltroGruppi,
  GraficoPerGruppoFiltrato,
  StatSociAttivi,
  StatVendite,
  type AttiviGruppo,
  type VenditeGruppo,
} from './FiltroGruppi'

export const dynamic = 'force-dynamic'

type RigaVendite = { gruppo_id: string | null; numero_vendite: number; fatturato: number | null }

type RigaCanaleGrezza = { ha_richiesta: boolean; prima_origine: string | null; numero_vendite: number; fatturato: number | null }

/** Le righe di vendita sommate per gruppo, senza filtro: lo applica il browser (FiltroGruppi.tsx). */
function perGruppo(righe: RigaVendite[]): VenditeGruppo[] {
  const mappa = new Map<string | null, VenditeGruppo>()
  for (const r of righe) {
    const voce = mappa.get(r.gruppo_id) ?? { gruppoId: r.gruppo_id, vendite: 0, fatturato: 0 }
    voce.vendite += r.numero_vendite
    voce.fatturato += Number(r.fatturato ?? 0)
    mappa.set(r.gruppo_id, voce)
  }
  return [...mappa.values()]
}

/**
 * PostgREST tronca comunque ogni risposta a 1000 righe, `.limit()` o no (lo
 * stesso bug corretto nel resoconto serale, lib/report-direzionale.ts): si
 * legge a pagine da 1000 finché ne torna una più corta. `pagina(da)` è la
 * query già con `.range(da, da + 999)`.
 */
async function leggiPaginato<T>(
  pagina: (da: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ righe: T[]; error: { message: string } | null }> {
  const righe: T[] = []
  let error: { message: string } | null = null
  for (let da = 0; da < 10000; da += 1000) {
    const risposta = await pagina(da)
    if (risposta.error) error = risposta.error
    righe.push(...(risposta.data ?? []))
    if (!risposta.data || risposta.data.length < 1000) break
  }
  return { righe, error }
}

/** Le coppie sorgente/mezzo grezze (RPC statistiche_richieste) piegate su sito/in sede/altro. */
function splitContatti(coppie: CoppiaUtm[]): VoceCanale[] {
  const mappa = new Map<string, VoceCanale>()
  for (const c of coppie) {
    const provenienza = provenienzaDiOrigine(c.origine)
    const voce = mappa.get(provenienza.chiave) ?? { provenienza, conteggio: 0 }
    voce.conteggio += Number(c.richieste)
    mappa.set(provenienza.chiave, voce)
  }
  return [...mappa.values()].sort((a, b) => b.conteggio - a.conteggio)
}

/** Le stesse coppie, piegate sul canale granulare (Meta organico, Meta ADV, Google ADV...). */
function perCanaleGranulare(coppie: CoppiaUtm[]): Voce[] {
  const conteggi = new Map<string, number>()
  for (const c of coppie) {
    const canale = canaleGranulare(c)
    conteggi.set(canale, (conteggi.get(canale) ?? 0) + Number(c.richieste))
  }
  return [...conteggi.entries()]
    .map(([voce, richieste]) => ({ voce, richieste }))
    .sort((a, b) => b.richieste - a.richieste)
}

type RigaCanaleVendita = { provenienza: ProvenienzaVendita; vendite: number; fatturato: number }

function RipartizioneCanaliVendita({ voci, totaleFatturato }: { voci: RigaCanaleVendita[]; totaleFatturato: number }) {
  if (voci.length === 0) return <p className="vuoto">Nessuna vendita in questo periodo.</p>
  return (
    <div className="tabella-wrap">
      <table className="tabella">
        <thead>
          <tr>
            <th>Canale</th>
            <th>Vendite</th>
            <th>Fatturato</th>
            <th>% fatturato</th>
          </tr>
        </thead>
        <tbody>
          {voci.map((v) => (
            <tr key={v.provenienza.chiave}>
              <td>
                <span className={`tag-provenienza ${v.provenienza.classe}`}>{v.provenienza.etichetta}</span>
              </td>
              <td>{v.vendite}</td>
              <td>{euro(v.fatturato) ?? '—'}</td>
              <td className="muted">{percentuale(v.fatturato, totaleFatturato)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function DirezionePage() {
  if (!(await utenteHaSezione('direzione'))) redirect('/dashboard')

  const supabase = createSupabaseServiceClient()
  const oggi = oggiRoma()
  const annoCorrente = Number(oggi.slice(0, 4))

  const mtd = rangeMTD(annoCorrente)
  const mtdPrec = rangeMTD(annoCorrente - 1)
  const ytd = rangeYTD(annoCorrente)
  const ytdPrec = rangeYTD(annoCorrente - 1)

  // Ultimi 12 mesi (compreso quello in corso, parziale): la stessa finestra
  // per i grafici abbonamenti, contatti e accessi al sito.
  const meseCorrente = primoDelMese(oggi)
  const ultimi12Mesi = Array.from({ length: 12 }, (_, i) => mesePiu(meseCorrente, i - 11))

  // Tutte le letture qui sotto sono indipendenti l'una dall'altra: partono
  // insieme (un solo Promise.all più in basso) invece che una dopo l'altra —
  // prima erano una decina di attese in fila, e la pagina ne pagava la somma.

  // ─────────────────────────────────────────────────────── Abbonamenti venduti
  //
  // Stessi gruppi prodotto della pagina Abbonamenti (lib/abbonamenti.ts, gestiti
  // da /dashboard/abbonamenti/gruppi): un filtro multi-selezione identico,
  // così chi conosce già quella pagina lo ritrova qui uguale. Il filtro però
  // lo applica il browser (FiltroGruppi.tsx): qui si legge tutto UNA volta,
  // già spezzato per gruppo, così cambiare gruppo non torna sul server.

  async function venditeGiornaliere(range: RangePeriodo): Promise<RigaVendite[]> {
    const { righe } = await leggiPaginato<RigaVendite>((da) =>
      supabase
        .from('abbonamenti_giornalieri')
        .select('gruppo_id, numero_vendite, fatturato')
        .gte('giorno', range.giornoDa)
        .lte('giorno', range.giornoA)
        .range(da, da + 999)
    )
    return righe
  }

  // YTD = i mesi già chiusi dell'anno (da abbonamenti_mensili, una riga per
  // mese×gruppo) + il mese in corso, che è esattamente l'MTD già letto qui
  // sopra (stesso giorno di fine, stessa parità di giorni). Prima lo YTD si
  // leggeva da abbonamenti_giornalieri, una riga per giorno×gruppo: oltre
  // 2000 righe, quindi tre pagine da 1000 in fila per anno, ognuna delle quali
  // rifaceva da capo l'aggregazione dell'intera tabella abbonamenti. Stesso
  // risultato, verificato gruppo per gruppo sul database: le due viste
  // tagliano giorni e mesi nello stesso fuso.
  const mesiChiusiYTD = [annoCorrente, annoCorrente - 1].flatMap((anno) =>
    Array.from({ length: Number(oggi.slice(5, 7)) - 1 }, (_, i) => `${anno}-${String(i + 1).padStart(2, '0')}-01`)
  )

  async function caricaVendite() {
    const [venditeMTD, venditeMTDPrec, mensiliYTD] = await Promise.all([
      venditeGiornaliere(mtd),
      venditeGiornaliere(mtdPrec),
      // A gennaio non c'è ancora nessun mese chiuso: YTD = MTD.
      mesiChiusiYTD.length === 0
        ? Promise.resolve([])
        : leggiPaginato<RigaVendite & { mese: string }>((da) =>
            supabase
              .from('abbonamenti_mensili')
              .select('mese, gruppo_id, numero_vendite, fatturato')
              .in('mese', mesiChiusiYTD)
              .range(da, da + 999)
          ).then((r) => r.righe),
    ])
    const annoDi = (r: { mese: string }) => Number(r.mese.slice(0, 4))
    return {
      mtd: perGruppo(venditeMTD),
      mtdPrec: perGruppo(venditeMTDPrec),
      ytd: perGruppo([...mensiliYTD.filter((r) => annoDi(r) === annoCorrente), ...venditeMTD]),
      ytdPrec: perGruppo([...mensiliYTD.filter((r) => annoDi(r) === annoCorrente - 1), ...venditeMTDPrec]),
    }
  }

  // Soci attivi: stesso giorno confrontato con un mese fa e un anno fa — non
  // una vendita, una fotografia (abbonamenti_attivi_al, vedi
  // scripts/sql/2026-09-21-abbonamenti-attivi.sql). A differenza dello
  // storico mensile congelato, la funzione risponde per qualunque data
  // passata: qui serve il giorno esatto, non l'ultimo del mese.
  const unMeseFaSoci = stessoGiornoMesiFa(oggi, -1)
  const unAnnoFaSoci = stessoGiornoMesiFa(oggi, -12)

  async function attiviAl(giorno: string): Promise<AttiviGruppo[]> {
    const { data } = await supabase.rpc('abbonamenti_attivi_al', { p_data: giorno })
    const righe = (data ?? []) as { gruppo_id: string | null; numero_attivi: number }[]
    return righe.map((r) => ({ gruppoId: r.gruppo_id, attivi: r.numero_attivi }))
  }

  // ─────────────────────────────────────────────────────────── Contatti acquisiti

  async function statistiche(range: RangePeriodo): Promise<Statistiche> {
    const { data } = await supabase.rpc('statistiche_richieste', { p_da: range.da, p_a: range.a })
    return (data ?? STATISTICHE_VUOTE) as Statistiche
  }

  // Andamento ultimi 12 mesi per gruppo (fatturato e abbonati attivi a fine
  // mese): stessa logica della pagina Abbonamenti, vedi lib/abbonamenti.ts —
  // caricaAndamentoPerGruppo. Senza filtro: lo applica GraficoPerGruppoFiltrato.
  // Aspetta solo i gruppi (servono per nomi e colori), non il resto.
  const gruppiInArrivo = caricaGruppi()

  const [
    gruppi,
    { serieFatturatoMensile, legendaFatturato, erroreFatturatoMensile, serieAttiviMensile, legendaAttivi, erroreStoricoAttivi },
    vendite,
    [sociOggi, sociMeseFa, sociAnnoFa],
    [contattiMTD, contattiMTDPrec, contattiYTD, contattiYTDPrec],
    { data: contattiRecentiRighe },
    { data: sessioniMensiliRighe, error: erroreSessioniMensili },
    { righe: righeCanaleVendita, error: erroreCanaleVendita },
  ] = await Promise.all([
    gruppiInArrivo,
    gruppiInArrivo.then((g) => caricaAndamentoPerGruppo(supabase, g, [], false, meseCorrente, ultimi12Mesi)),
    caricaVendite(),
    Promise.all([attiviAl(oggi), attiviAl(unMeseFaSoci), attiviAl(unAnnoFaSoci)]),
    Promise.all([statistiche(mtd), statistiche(mtdPrec), statistiche(ytd), statistiche(ytdPrec)]),
    // Sito vs in sede, ultimi 12 mesi: una lettura diretta di form_contatti
    // invece che 12 chiamate alla RPC — la tabella ha poche decine di righe,
    // un'unica select è più semplice e altrettanto leggera.
    supabase.from('form_contatti').select('created_at, origine').gte('created_at', mezzanotteRoma(ultimi12Mesi[0])),
    // Accessi singoli e sessioni del sito: sessioni ha già decine di migliaia
    // di righe (a differenza di form_contatti), quindi l'aggregazione per mese
    // arriva già pronta da sessioni_mensili invece che da una select grezza —
    // vedi scripts/sql/2026-09-21-sessioni-mensili.sql.
    supabase.from('sessioni_mensili').select('mese, sessioni, persone').gte('mese', ultimi12Mesi[0]),
    // Vendite per primo canale, da inizio anno: uno YTD per giorno×canale
    // supera facilmente le 1000 righe (vedi leggiPaginato).
    leggiPaginato<RigaCanaleGrezza>((da) =>
      supabase
        .from('abbonamenti_giornalieri_canale')
        .select('ha_richiesta, prima_origine, numero_vendite, fatturato')
        .gte('giorno', ytd.giornoDa)
        .lte('giorno', ytd.giornoA)
        .range(da, da + 999)
    ),
  ])

  const splitContattiYTD = splitContatti(contattiYTD.coppie_utm)
  const contattiPerCanaleYTD = perCanaleGranulare(contattiYTD.coppie_utm)

  const contattiPerMese = new Map<string, VoceContattiMese>()
  for (const r of contattiRecentiRighe ?? []) {
    const mese = primoDelMese(giornoDiIstante(r.created_at))
    const voce = contattiPerMese.get(mese) ?? { mese, sito: 0, sede: 0 }
    if (provenienzaDiOrigine(r.origine).chiave === 'guest-register') voce.sede += 1
    else voce.sito += 1
    contattiPerMese.set(mese, voce)
  }
  const serieContattiMensile = ultimi12Mesi.map((m) => contattiPerMese.get(m) ?? { mese: m, sito: 0, sede: 0 })

  const sessioniPerMese = new Map<string, VoceVisiteMese>()
  for (const r of sessioniMensiliRighe ?? []) sessioniPerMese.set(r.mese, { mese: r.mese, persone: r.persone, sessioni: r.sessioni })
  const serieVisiteMensile = ultimi12Mesi.map((m) => sessioniPerMese.get(m) ?? { mese: m, persone: 0, sessioni: 0 })

  // ──────────────────────────────────────────────── Vendite per primo canale

  const mappaCanaliVendita = new Map<string, RigaCanaleVendita>()
  for (const r of righeCanaleVendita) {
    const provenienza = canaleVendita({ haRichiesta: r.ha_richiesta, primaOrigine: r.prima_origine })
    const voce = mappaCanaliVendita.get(provenienza.chiave) ?? { provenienza, vendite: 0, fatturato: 0 }
    voce.vendite += r.numero_vendite
    voce.fatturato += Number(r.fatturato ?? 0)
    mappaCanaliVendita.set(provenienza.chiave, voce)
  }
  const canaliVendita = [...mappaCanaliVendita.values()].sort((a, b) => b.fatturato - a.fatturato)
  const fatturatoTotaleCanali = canaliVendita.reduce((s, v) => s + v.fatturato, 0)

  const mancanoTabelle = /abbonamenti_giornalieri_canale|persone_primo_canale/.test(
    erroreCanaleVendita?.message ?? ''
  )

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Direzione</p>
        <h1>Dashboard direzionale</h1>
        <p className="muted">
          Aggiornata al {dataBreve(oggi)} — MTD confrontato a parità di giorni con {annoCorrente - 1}, YTD dal 1
          gennaio.
        </p>
      </div>

      {mancanoTabelle && (
        <div className="card">
          <p className="vuoto">
            Mancano tabelle/viste di reportistica: esegui scripts/sql/2026-09-21-dashboard-direzionale.sql nel SQL
            Editor di Supabase.
          </p>
        </div>
      )}

      <FiltroGruppi gruppi={gruppi.map((g) => ({ id: g.id, nome: g.nome }))}>
        <div className="card">
          <div className="card-head">
            <h2>Abbonamenti venduti</h2>
            <span className="muted">Vendite, non costi</span>
          </div>
          <div className="filtri">
            <p className="filtri-titolo">Gruppo (selezione multipla)</p>
            <div className="filtri-gruppi">
              <ChipGruppi />
            </div>
          </div>
          <StatVendite
            annoPrecedente={annoCorrente - 1}
            mtd={vendite.mtd}
            mtdPrec={vendite.mtdPrec}
            ytd={vendite.ytd}
            ytdPrec={vendite.ytdPrec}
          />
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Soci attivi</h2>
            <span className="muted">Persone con almeno un abbonamento in corso, non scaduto — stesso filtro gruppo qui sopra</span>
          </div>
          <StatSociAttivi
            oggi={{ nota: dataBreveAnno(oggi), perGruppo: sociOggi }}
            meseFa={{ nota: dataBreveAnno(unMeseFaSoci), perGruppo: sociMeseFa }}
            annoFa={{ nota: dataBreveAnno(unAnnoFaSoci), perGruppo: sociAnnoFa }}
          />
        </div>

        {erroreFatturatoMensile && /abbonamenti_mensili/.test(erroreFatturatoMensile.message) ? (
          <div className="card">
            <p className="vuoto">
              Manca la vista di reportistica: esegui scripts/sql/2026-09-18-abbonamenti-gruppi.sql nel SQL Editor di
              Supabase.
            </p>
          </div>
        ) : (
          <div className="card">
            <div className="card-head">
              <h2>Fatturato mensile per gruppo</h2>
            </div>
            <GraficoPerGruppoFiltrato
              serie={serieFatturatoMensile}
              legenda={legendaFatturato}
              formato="euro"
              etichettaAria="Fatturato per gruppo, ultimi 12 mesi"
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
            <div className="card-head">
              <h2>Numero soci attivi per mese</h2>
            </div>
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

      <div className="card">
        <div className="card-head">
          <h2>Contatti acquisiti</h2>
        </div>
        <p className="muted">
          In questa sezione è possibile verificare il numero di lead acquisiti tra web e Walk-in.
        </p>
        <div className="griglia-stat">
          <StatCard
            label="Contatti MTD"
            valore={String(contattiMTD.richieste)}
            nota={`${annoCorrente - 1}: ${contattiMTDPrec.richieste}`}
            percentuale={variazionePercentuale(contattiMTD.richieste, contattiMTDPrec.richieste)}
          />
          <StatCard
            label="Contatti YTD"
            valore={String(contattiYTD.richieste)}
            nota={`${annoCorrente - 1}: ${contattiYTDPrec.richieste}`}
            percentuale={variazionePercentuale(contattiYTD.richieste, contattiYTDPrec.richieste)}
          />
        </div>
        <p className="filtri-titolo">Sito vs in sede (Walk-in) — da inizio anno</p>
        <SplitCanali voci={splitContattiYTD} totale={contattiYTD.richieste} />
        <p className="filtri-titolo">Andamento ultimi 12 mesi</p>
        <GraficoContatti serie={serieContattiMensile} />
      </div>

      <Ripartizione
        titolo="Contatti per canale — da inizio anno"
        voci={contattiPerCanaleYTD}
        totale={contattiYTD.richieste}
        nota="Piattaforma e organico/a pagamento separati (es. «Meta organico» vs «Meta ADV»): più dettagliato del canale di traffico di Analytics, che li accorpa."
      />

      <Ripartizione
        titolo="Contatti per attività di interesse — da inizio anno"
        voci={contattiYTD.attivita}
        totale={contattiYTD.richieste}
        nota="L'attività scelta nel form del sito (Tennis, Nuoto, Padel...); chi si registra al banco senza specificarla conta come «(non indicata)»."
      />

      <div className="card">
        <div className="card-head">
          <h2>Vendite per primo canale di acquisizione</h2>
          <span className="muted">Da inizio anno</span>
        </div>
        <p className="muted" style={{ marginTop: 0, fontSize: 'var(--text-xs)' }}>
          Il canale è quello della primissima richiesta mai fatta da chi ha comprato, non della vendita stessa. Chi
          non ha mai avuto una richiesta nel CRM (rinnovi, acquisti in reception) finisce in «Non attribuito», che
          oggi è la maggioranza dello storico.
        </p>
        <RipartizioneCanaliVendita voci={canaliVendita} totaleFatturato={fatturatoTotaleCanali} />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Accessi al sito, ultimi 12 mesi</h2>
        </div>
        {erroreSessioniMensili && /sessioni_mensili/.test(erroreSessioniMensili.message) ? (
          <p className="vuoto">
            Manca la vista sessioni_mensili: esegui scripts/sql/2026-09-21-sessioni-mensili.sql nel SQL Editor di
            Supabase.
          </p>
        ) : (
          <GraficoVisiteSito serie={serieVisiteMensile} />
        )}
      </div>
    </div>
  )
}
