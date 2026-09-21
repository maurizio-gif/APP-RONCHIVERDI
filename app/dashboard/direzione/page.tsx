import Link from 'next/link'
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
import { GraficoPerGruppo } from '@/app/dashboard/abbonamenti/GraficoPerGruppo'
import { StatCard } from './StatCard'
import { SplitCanali, type VoceCanale } from './SplitCanali'
import { GraficoContatti, type VoceContattiMese } from './GraficoContatti'

export const dynamic = 'force-dynamic'

type Somma = { vendite: number; fatturato: number }

function sommaRighe(righe: { numero_vendite: number; fatturato: number | null }[] | null): Somma {
  return (righe ?? []).reduce(
    (acc, r) => ({ vendite: acc.vendite + r.numero_vendite, fatturato: acc.fatturato + Number(r.fatturato ?? 0) }),
    { vendite: 0, fatturato: 0 }
  )
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

export default async function DirezionePage({
  searchParams,
}: {
  searchParams: { gruppi?: string }
}) {
  if (!(await utenteHaSezione('direzione'))) redirect('/dashboard')

  const supabase = createSupabaseServiceClient()
  const annoCorrente = Number(oggiRoma().slice(0, 4))

  const mtd = rangeMTD(annoCorrente)
  const mtdPrec = rangeMTD(annoCorrente - 1)
  const ytd = rangeYTD(annoCorrente)
  const ytdPrec = rangeYTD(annoCorrente - 1)

  // ─────────────────────────────────────────────────────── Abbonamenti venduti
  //
  // Stessi gruppi prodotto della pagina Abbonamenti (lib/abbonamenti.ts, gestiti
  // da /dashboard/abbonamenti/gruppi): un filtro multi-selezione identico,
  // così chi conosce già quella pagina lo ritrova qui uguale.

  const gruppi = await caricaGruppi()
  const gruppiValidi = new Set(gruppi.map((g) => g.id))
  const gruppiSelezionati = (searchParams.gruppi ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((id) => gruppiValidi.has(id))
  const filtroGruppoAttivo = gruppiSelezionati.length > 0

  function hrefToggleGruppo(id: string | null) {
    if (id === null) return '/dashboard/direzione'
    const attivi = new Set(gruppiSelezionati)
    if (attivi.has(id)) attivi.delete(id)
    else attivi.add(id)
    const params = new URLSearchParams()
    if (attivi.size > 0) params.set('gruppi', Array.from(attivi).join(','))
    const query = params.toString()
    return `/dashboard/direzione${query ? `?${query}` : ''}`
  }

  async function sommaGiornalieri(range: RangePeriodo): Promise<Somma> {
    let query = supabase
      .from('abbonamenti_giornalieri')
      .select('numero_vendite, fatturato')
      .gte('giorno', range.giornoDa)
      .lte('giorno', range.giornoA)
    if (filtroGruppoAttivo) query = query.in('gruppo_id', gruppiSelezionati)
    const { data } = await query
    return sommaRighe(data)
  }

  const [venditeMTD, venditeMTDPrec, venditeYTD, venditeYTDPrec] = await Promise.all([
    sommaGiornalieri(mtd),
    sommaGiornalieri(mtdPrec),
    sommaGiornalieri(ytd),
    sommaGiornalieri(ytdPrec),
  ])

  // Andamento ultimi 12 mesi per gruppo (fatturato e abbonati attivi a fine
  // mese): stessa logica e stesso filtro gruppo della pagina Abbonamenti,
  // vedi lib/abbonamenti.ts — caricaAndamentoPerGruppo.
  const meseCorrenteAbbonamenti = primoDelMese(oggiRoma())
  const ultimi12MesiAbbonamenti = Array.from({ length: 12 }, (_, i) => mesePiu(meseCorrenteAbbonamenti, i - 11))
  const { serieFatturatoMensile, legendaFatturato, erroreFatturatoMensile, serieAttiviMensile, legendaAttivi, erroreStoricoAttivi } =
    await caricaAndamentoPerGruppo(
      supabase,
      gruppi,
      gruppiSelezionati,
      filtroGruppoAttivo,
      meseCorrenteAbbonamenti,
      ultimi12MesiAbbonamenti
    )

  // Soci attivi: stesso giorno confrontato con un mese fa e un anno fa — non
  // una vendita, una fotografia (abbonamenti_attivi_al, vedi
  // scripts/sql/2026-09-21-abbonamenti-attivi.sql). A differenza dello
  // storico mensile congelato, la funzione risponde per qualunque data
  // passata: qui serve il giorno esatto, non l'ultimo del mese.
  const oggiSoci = oggiRoma()
  const unMeseFaSoci = stessoGiornoMesiFa(oggiSoci, -1)
  const unAnnoFaSoci = stessoGiornoMesiFa(oggiSoci, -12)

  async function totaleAttiviAl(giorno: string): Promise<number> {
    const { data } = await supabase.rpc('abbonamenti_attivi_al', { p_data: giorno })
    const righe = (data ?? []) as { gruppo_id: string | null; numero_attivi: number }[]
    return righe
      .filter((r) => !filtroGruppoAttivo || gruppiSelezionati.includes(r.gruppo_id ?? ''))
      .reduce((tot, r) => tot + r.numero_attivi, 0)
  }

  const [sociAttiviOggi, sociAttiviMeseFa, sociAttiviAnnoFa] = await Promise.all([
    totaleAttiviAl(oggiSoci),
    totaleAttiviAl(unMeseFaSoci),
    totaleAttiviAl(unAnnoFaSoci),
  ])

  // ─────────────────────────────────────────────────────────── Contatti acquisiti

  async function statistiche(range: RangePeriodo): Promise<Statistiche> {
    const { data } = await supabase.rpc('statistiche_richieste', { p_da: range.da, p_a: range.a })
    return (data ?? STATISTICHE_VUOTE) as Statistiche
  }

  const [contattiMTD, contattiMTDPrec, contattiYTD, contattiYTDPrec] = await Promise.all([
    statistiche(mtd),
    statistiche(mtdPrec),
    statistiche(ytd),
    statistiche(ytdPrec),
  ])

  const splitContattiYTD = splitContatti(contattiYTD.coppie_utm)
  const contattiPerCanaleYTD = perCanaleGranulare(contattiYTD.coppie_utm)

  // Ultimi 12 mesi (compreso quello in corso, parziale), sito vs in sede: una
  // lettura diretta di form_contatti invece che 12 chiamate alla RPC — la
  // tabella ha poche decine di righe, un'unica select è più semplice e
  // altrettanto leggera.
  const ultimi12Mesi = Array.from({ length: 12 }, (_, i) => mesePiu(primoDelMese(oggiRoma()), i - 11))
  const { data: contattiRecentiRighe } = await supabase
    .from('form_contatti')
    .select('created_at, origine')
    .gte('created_at', mezzanotteRoma(ultimi12Mesi[0]))

  const contattiPerMese = new Map<string, VoceContattiMese>()
  for (const r of contattiRecentiRighe ?? []) {
    const mese = primoDelMese(giornoDiIstante(r.created_at))
    const voce = contattiPerMese.get(mese) ?? { mese, sito: 0, sede: 0 }
    if (provenienzaDiOrigine(r.origine).chiave === 'guest-register') voce.sede += 1
    else voce.sito += 1
    contattiPerMese.set(mese, voce)
  }
  const serieContattiMensile = ultimi12Mesi.map((m) => contattiPerMese.get(m) ?? { mese: m, sito: 0, sede: 0 })

  // ──────────────────────────────────────────────── Vendite per primo canale

  const rigaCanaleVendita = await supabase
    .from('abbonamenti_giornalieri_canale')
    .select('ha_richiesta, prima_origine, numero_vendite, fatturato')
    .gte('giorno', ytd.giornoDa)
    .lte('giorno', ytd.giornoA)
  const erroreCanaleVendita = rigaCanaleVendita.error

  const mappaCanaliVendita = new Map<string, RigaCanaleVendita>()
  for (const r of rigaCanaleVendita.data ?? []) {
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
          Aggiornata al {dataBreve(oggiRoma())} — MTD confrontato a parità di giorni con {annoCorrente - 1}, YTD dal 1
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

      <div className="card">
        <div className="card-head">
          <h2>Abbonamenti venduti</h2>
          <span className="muted">Vendite, non costi</span>
        </div>
        <div className="filtri">
          <p className="filtri-titolo">Gruppo (selezione multipla)</p>
          <div className="filtri-gruppi">
            <fieldset className="filtro-gruppo">
              <Link href={hrefToggleGruppo(null)} className={`chip${!filtroGruppoAttivo ? ' is-attivo' : ''}`}>
                Tutti
              </Link>
              {gruppi.map((g) => (
                <Link
                  key={g.id}
                  href={hrefToggleGruppo(g.id)}
                  className={`chip${gruppiSelezionati.includes(g.id) ? ' is-attivo' : ''}`}
                >
                  {g.nome}
                </Link>
              ))}
            </fieldset>
          </div>
        </div>
        <div className="griglia-stat">
          <StatCard
            label="Vendite MTD"
            valore={String(venditeMTD.vendite)}
            nota={`${annoCorrente - 1}: ${venditeMTDPrec.vendite}`}
            percentuale={variazionePercentuale(venditeMTD.vendite, venditeMTDPrec.vendite)}
          />
          <StatCard
            label="Fatturato MTD"
            valore={euro(venditeMTD.fatturato) ?? '—'}
            nota={`${annoCorrente - 1}: ${euro(venditeMTDPrec.fatturato) ?? '—'}`}
            percentuale={variazionePercentuale(venditeMTD.fatturato, venditeMTDPrec.fatturato)}
          />
          <StatCard
            label="Vendite YTD"
            valore={String(venditeYTD.vendite)}
            nota={`${annoCorrente - 1}: ${venditeYTDPrec.vendite}`}
            percentuale={variazionePercentuale(venditeYTD.vendite, venditeYTDPrec.vendite)}
          />
          <StatCard
            label="Fatturato YTD"
            valore={euro(venditeYTD.fatturato) ?? '—'}
            nota={`${annoCorrente - 1}: ${euro(venditeYTDPrec.fatturato) ?? '—'}`}
            percentuale={variazionePercentuale(venditeYTD.fatturato, venditeYTDPrec.fatturato)}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Soci attivi</h2>
          <span className="muted">Persone con almeno un abbonamento in corso, non scaduto — stesso filtro gruppo qui sopra</span>
        </div>
        <div className="griglia-stat">
          <StatCard label="Oggi" valore={String(sociAttiviOggi)} nota={dataBreveAnno(oggiSoci)} />
          <StatCard
            label="Un mese fa"
            valore={String(sociAttiviMeseFa)}
            nota={dataBreveAnno(unMeseFaSoci)}
            percentuale={variazionePercentuale(sociAttiviOggi, sociAttiviMeseFa)}
            suffissoBadge="vs oggi"
          />
          <StatCard
            label="Un anno fa"
            valore={String(sociAttiviAnnoFa)}
            nota={dataBreveAnno(unAnnoFaSoci)}
            percentuale={variazionePercentuale(sociAttiviOggi, sociAttiviAnnoFa)}
            suffissoBadge="vs oggi"
          />
        </div>
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
            <h2>Andamento ultimi 12 mesi, per gruppo</h2>
          </div>
          <GraficoPerGruppo
            serie={serieFatturatoMensile}
            legenda={legendaFatturato}
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
            <h2>Andamento abbonati attivi, fine mese</h2>
          </div>
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
        <div className="card-head">
          <h2>Contatti acquisiti</h2>
        </div>
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
    </div>
  )
}
