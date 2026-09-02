import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import {
  OPZIONI_CONFRONTO,
  OPZIONI_PERIODO,
  STATISTICHE_VUOTE,
  calcolaEstremi,
  classeVariazione,
  confrontoDa,
  dataBreve,
  formattaVariazione,
  percentuale,
  periodoDa,
  serieCompleta,
  variazione,
  type Statistiche,
  type Voce,
} from '@/lib/analytics'
import { CANALI, canaleDiRichiesta } from '@/lib/richieste'
import { ETICHETTE_STATO, eStatoValido } from '@/lib/pipeline'
import { GraficoGiorni } from './GraficoGiorni'
import { Ripartizione } from './Ripartizione'

export const dynamic = 'force-dynamic'

/**
 * Le combinazioni grezze (attività + settore + origine) piegate sui canali.
 * La mappatura vive in lib/richieste.ts e non in SQL: due copie della
 * tabella di instradamento sarebbero due verità da tenere allineate.
 */
function perCanale(s: Statistiche): Voce[] {
  const conteggi = new Map<string, number>()
  for (const c of s.combinazioni) {
    const canale = canaleDiRichiesta(c)
    const etichetta = canale?.label ?? '(non instradata)'
    conteggi.set(etichetta, (conteggi.get(etichetta) ?? 0) + Number(c.richieste))
  }
  return [...conteggi.entries()]
    .map(([voce, richieste]) => ({ voce, richieste }))
    .sort((a, b) => b.richieste - a.richieste)
}

/** Gli stati della trattativa con l'etichetta italiana invece della chiave. */
function statiLeggibili(voci: Voce[]): Voce[] {
  return voci.map((v) => ({
    ...v,
    voce: eStatoValido(v.voce) ? ETICHETTE_STATO[v.voce] : v.voce,
  }))
}

function Totale({
  titolo,
  valore,
  prima,
  piuEMeglio = true,
  suffisso,
}: {
  titolo: string
  valore: number | string
  prima?: number | null
  piuEMeglio?: boolean
  suffisso?: string
}) {
  const delta =
    typeof valore === 'number' && prima !== undefined && prima !== null
      ? variazione(valore, prima)
      : null
  const mostraDelta = typeof valore === 'number' && prima !== undefined && prima !== null

  return (
    <div className="stat">
      <span className="stat-valore">
        {valore}
        {suffisso}
      </span>
      <span className="stat-label">{titolo}</span>
      {mostraDelta && (
        <span className={`badge ${classeVariazione(delta, piuEMeglio)}`} style={{ marginTop: '0.5rem' }}>
          {formattaVariazione(delta)}
        </span>
      )}
    </div>
  )
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: { periodo?: string; confronto?: string }
}) {
  if (!(await utenteHaSezione('analytics'))) {
    redirect('/dashboard')
  }

  const periodo = periodoDa(searchParams.periodo)
  const confronto = confrontoDa(searchParams.confronto)
  const estremi = calcolaEstremi(periodo.giorni, confronto)

  const supabase = createSupabaseServiceClient()
  const [{ data: ora, error }, { data: prima }] = await Promise.all([
    supabase.rpc('statistiche_richieste', {
      p_da: estremi.da.toISOString(),
      p_a: estremi.a.toISOString(),
    }),
    estremi.confronto
      ? supabase.rpc('statistiche_richieste', {
          p_da: estremi.confronto.da.toISOString(),
          p_a: estremi.confronto.a.toISOString(),
        })
      : Promise.resolve({ data: null }),
  ])

  if (error) console.error('Analytics non calcolate:', error.message)

  const s = (ora ?? STATISTICHE_VUOTE) as Statistiche
  const c = (prima ?? null) as Statistiche | null

  const serie = serieCompleta(s.giorni, estremi.da, estremi.a)
  const canali = perCanale(s)
  const canaliPrima = c ? perCanale(c) : null

  function link(p: { periodo?: string; confronto?: string }) {
    const params = new URLSearchParams()
    params.set('periodo', p.periodo ?? periodo.valore)
    params.set('confronto', p.confronto ?? confronto)
    return `/dashboard/analytics?${params.toString()}`
  }

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Amministrazione</p>
        <h1>Analytics</h1>
        <p className="muted">
          Da {dataBreve(estremi.da)} a {dataBreve(estremi.a)}
          {estremi.confronto && (
            <> · confronto con {dataBreve(estremi.confronto.da)} – {dataBreve(estremi.confronto.a)}</>
          )}
        </p>
      </div>

      <div className="agenda-barra">
        <div className="agenda-nav">
          {OPZIONI_PERIODO.map((p) => (
            <Link
              key={p.valore}
              className={`btn btn-sm ${p.valore === periodo.valore ? '' : 'btn-ghost'}`}
              href={link({ periodo: p.valore })}
            >
              {p.etichetta}
            </Link>
          ))}
        </div>
        <div className="agenda-nav">
          {OPZIONI_CONFRONTO.map((o) => (
            <Link
              key={o.valore}
              className={`btn btn-sm ${o.valore === confronto ? '' : 'btn-ghost'}`}
              href={link({ confronto: o.valore })}
            >
              {o.etichetta}
            </Link>
          ))}
        </div>
      </div>

      <div className="griglia-stat">
        <Totale titolo="Richieste" valore={s.richieste} prima={c?.richieste} />
        <Totale titolo="Persone nuove" valore={s.persone_nuove} prima={c?.persone_nuove} />
        <Totale titolo="Con appuntamento" valore={s.con_appuntamento} prima={c?.con_appuntamento} />
        <Totale
          titolo="Lavorate"
          valore={percentuale(s.lavorate, s.richieste)}
          suffisso=""
        />
      </div>

      <div className="griglia-stat">
        <Totale titolo="Trattative aperte" valore={s.trattative_aperte} prima={c?.trattative_aperte} />
        <Totale titolo="Vinte" valore={s.trattative_vinte} prima={c?.trattative_vinte} />
        {/* Sulle perse una crescita non è una buona notizia: il colore del
            badge va letto al contrario. */}
        <Totale
          titolo="Perse"
          valore={s.trattative_perse}
          prima={c?.trattative_perse}
          piuEMeglio={false}
        />
        <Totale
          titolo="Vinte sul chiuso"
          valore={percentuale(s.trattative_vinte, s.trattative_vinte + s.trattative_perse)}
        />
      </div>

      {s.richieste === 0 && s.trattative_aperte === 0 ? (
        <div className="card">
          <p className="vuoto">
            Nessuna richiesta in questo periodo. I numeri si popolano da sé con i form del sito.
          </p>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-head">
              <h2>Andamento</h2>
              <span className="muted">richieste per giorno</span>
            </div>
            <GraficoGiorni serie={serie} />
          </div>

          <Ripartizione
            titolo="Richieste per canale"
            voci={canali}
            vociConfronto={canaliPrima}
            totale={s.richieste}
            nota={`Gli ${CANALI.length} canali di instradamento: chi non corrisponde a nessuno compare come «non instradata».`}
          />

          <div className="visite-colonne">
            <Ripartizione
              titolo="Per attività"
              voci={s.attivita}
              vociConfronto={c?.attivita}
              totale={s.richieste}
            />
            <Ripartizione
              titolo="Per stato della trattativa"
              voci={statiLeggibili(s.stati_trattativa)}
              vociConfronto={c ? statiLeggibili(c.stati_trattativa) : null}
              totale={s.richieste}
              nota="Le richieste dei corsi non aprono una trattativa: vanno diritte al responsabile."
            />
            <Ripartizione
              titolo="Per sorgente (UTM)"
              voci={s.sorgenti}
              vociConfronto={c?.sorgenti}
              totale={s.richieste}
            />
            <Ripartizione
              titolo="Per mezzo"
              voci={s.mezzi}
              vociConfronto={c?.mezzi}
              totale={s.richieste}
            />
            <Ripartizione
              titolo="Per campagna"
              voci={s.campagne}
              vociConfronto={c?.campagne}
              totale={s.richieste}
            />
            <Ripartizione
              titolo="Per termine di ricerca"
              voci={s.termini}
              vociConfronto={c?.termini}
              totale={s.richieste}
            />
            <Ripartizione titolo="Per CTA" voci={s.cta} totale={s.richieste} />
            <Ripartizione titolo="Per pagina" voci={s.pagine} totale={s.richieste} />
            <Ripartizione
              titolo="Trattative per assegnatario"
              voci={s.assegnatari}
              totale={s.assegnatari.reduce((t, v) => t + v.richieste, 0)}
            />
            <Ripartizione
              titolo="Lavorate da"
              voci={s.lavorate_da}
              totale={s.lavorate}
              nota="Chi ha segnato la richiesta come presa in carico."
            />
          </div>
        </>
      )}
    </>
  )
}
