import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { caricaGruppi } from '@/lib/abbonamenti'
import { dataBreve as dataBreveAnno } from '@/lib/persone'
import { euro } from '@/lib/pipeline'
import NuovoGruppoForm from './NuovoGruppoForm'
import RigaProdotto from './RigaProdotto'
import AiutoTooltip from '@/app/components/AiutoTooltip'

export const dynamic = 'force-dynamic'

export default async function GruppiAbbonamentiPage({
  searchParams,
}: {
  searchParams: { ordina?: string; dir?: string; solo?: string; cerca?: string }
}) {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  // Solo la colonna Ultima vendita è ordinabile per ora (l'unica per cui è
  // stata chiesta): di default la tabella resta alfabetica per prodotto,
  // come prima. Il default della prima volta che si clicca è "dal più
  // recente" (desc) — è il verso che serve per trovare in fretta i prodotti
  // rimasti fermi da anni, guardando in fondo.
  const ordinaPerData = searchParams.ordina === 'ultima_vendita'
  const direzioneAttuale = searchParams.dir === 'asc' ? 'asc' : 'desc'
  const prossimaDirezione = ordinaPerData && direzioneAttuale === 'desc' ? 'asc' : 'desc'

  // "Solo attivi": non tutti i 350+ prodotti da categorizzare, solo quelli
  // che hanno almeno un abbonato attivo adesso — molti prodotti da
  // categorizzare sono storici (es. "ESTATE RAGAZZI 2007") e non pesano sul
  // numero "Non categorizzato" del riquadro Utenti attivi in questo momento,
  // quelli sì. Vedi abbonamenti_prodotti_attivi_non_categorizzati,
  // scripts/sql/2026-09-21-abbonamenti-prodotti-attivi-non-categorizzati.sql.
  const soloAttivi = searchParams.solo === 'attivi'
  // "Solo non categorizzati": tutti quelli senza gruppo, a prescindere da
  // se hanno abbonati attivi ora — un filtro più largo di "solo attivi",
  // per chi vuole ripulire l'intero elenco e non solo l'urgenza del
  // momento.
  const soloNonCategorizzati = searchParams.solo === 'non_categorizzati'
  const cercaValore = (searchParams.cerca ?? '').trim()

  // Un unico costruttore di URL per tutti i link di filtro/ordinamento
  // della pagina, così cambiare uno stato (es. il chip "Non
  // categorizzati") non fa perdere gli altri già attivi (es. una ricerca
  // in corso) — ognuno riparte dai parametri correnti e sovrascrive solo
  // quello che gli interessa.
  function costruisciHref(
    override: { ordina?: boolean; dir?: 'asc' | 'desc'; solo?: string | null; cerca?: string | null } = {},
  ) {
    const params = new URLSearchParams()
    const usaOrdinamento = override.ordina ?? ordinaPerData
    if (usaOrdinamento) {
      params.set('ordina', 'ultima_vendita')
      params.set('dir', override.dir ?? direzioneAttuale)
    }
    const solo = override.solo !== undefined ? override.solo : (searchParams.solo ?? null)
    if (solo) params.set('solo', solo)
    const cerca = override.cerca !== undefined ? override.cerca : cercaValore || null
    if (cerca) params.set('cerca', cerca)
    const query = params.toString()
    return `/dashboard/abbonamenti/gruppi${query ? `?${query}` : ''}`
  }

  const hrefOrdinaData = costruisciHref({ ordina: true, dir: prossimaDirezione })

  const supabase = createSupabaseServiceClient()
  let queryProdotti = supabase
    .from('abbonamenti_prodotti')
    .select('prodotto, numero_vendite, ultima_vendita, varianti, importo_listino_recente')
  queryProdotti = ordinaPerData
    ? queryProdotti.order('ultima_vendita', { ascending: direzioneAttuale === 'asc', nullsFirst: direzioneAttuale === 'asc' })
    : queryProdotti.order('prodotto')

  const [gruppi, prodottiRisposta, mappaturaRisposta, prodottiAttiviRisposta] = await Promise.all([
    caricaGruppi(),
    queryProdotti,
    supabase.from('abbonamenti_mappatura').select('prodotto, gruppo_id, no_abbonamento'),
    supabase.from('abbonamenti_prodotti_attivi_non_categorizzati').select('prodotto, numero_attivi'),
  ])

  const erroreViste = prodottiRisposta.error
  const erroreProdottiAttivi = prodottiAttiviRisposta.error

  const mappaGruppo = new Map<string, string | null>()
  const mappaNoAbbonamento = new Map<string, boolean>()
  for (const riga of mappaturaRisposta.data ?? []) {
    mappaGruppo.set(riga.prodotto, riga.gruppo_id)
    mappaNoAbbonamento.set(riga.prodotto, riga.no_abbonamento ?? false)
  }

  const mappaAttiviNonCategorizzati = new Map<string, number>()
  for (const riga of prodottiAttiviRisposta.data ?? []) mappaAttiviNonCategorizzati.set(riga.prodotto, riga.numero_attivi)

  const tuttiIProdotti = prodottiRisposta.data ?? []
  const daCategorizzare = tuttiIProdotti.filter((p) => !mappaGruppo.get(p.prodotto)).length
  const daCategorizzareAttivi = mappaAttiviNonCategorizzati.size

  // Filtro di stato (tutti / non categorizzati / con abbonati attivi),
  // poi la ricerca per nome sopra il risultato — i due si combinano,
  // ognuno restringe ulteriormente quello che ha lasciato l'altro.
  let prodotti = tuttiIProdotti
  if (soloAttivi) {
    prodotti = prodotti.filter((p) => mappaAttiviNonCategorizzati.has(p.prodotto))
  } else if (soloNonCategorizzati) {
    prodotti = prodotti.filter((p) => !mappaGruppo.get(p.prodotto))
  }
  if (cercaValore) {
    const query = cercaValore.toLowerCase()
    prodotti = prodotti.filter((p) => p.prodotto.toLowerCase().includes(query))
  }
  // Ordinati per priorità (più abbonati attivi prima), non alfabetico: qui
  // lo scopo è "quale sistemo per primo", non "trova un prodotto per nome".
  if (soloAttivi) {
    prodotti = [...prodotti].sort(
      (a, b) => (mappaAttiviNonCategorizzati.get(b.prodotto) ?? 0) - (mappaAttiviNonCategorizzati.get(a.prodotto) ?? 0),
    )
  }

  const hrefTutti = costruisciHref({ solo: null })
  const hrefSoloNonCategorizzati = costruisciHref({ solo: 'non_categorizzati' })
  const hrefSoloAttivi = costruisciHref({ solo: 'attivi' })

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Abbonamenti</p>
        <h1>Gruppi prodotto</h1>
        <p className="muted">
          Ogni prodotto venduto in Info4U va assegnato a un gruppo per comparire correttamente nei report — un
          prodotto non ancora assegnato conta come &quot;Non categorizzato&quot;.
        </p>
        <Link href="/dashboard/abbonamenti" className="muted">
          ← Torna ad Abbonamenti
        </Link>
      </div>

      {erroreViste && /abbonamenti_prodotti|abbonamenti_mappatura|abbonamenti_gruppi/.test(erroreViste.message) ? (
        <div className="card">
          <p className="vuoto">
            Mancano le tabelle/viste di reportistica: esegui scripts/sql/2026-09-18-abbonamenti-gruppi.sql nel SQL
            Editor di Supabase.
          </p>
        </div>
      ) : (
        <>
          <div className="card">
            <p className="filtri-titolo">Gruppi esistenti</p>
            <div className="filtri-gruppi">
              {gruppi.length === 0 ? (
                <p className="muted">Nessun gruppo creato ancora — crea il primo qui sotto.</p>
              ) : (
                gruppi.map((g) => (
                  <span key={g.id} className="chip">
                    {g.nome}
                  </span>
                ))
              )}
            </div>
            <NuovoGruppoForm />
          </div>

          <div className="card">
            <div className="filtri-gruppi">
              <Link href={hrefTutti} className={`chip${!soloAttivi && !soloNonCategorizzati ? ' is-attivo' : ''}`}>
                Tutti <span className="chip-conteggio">{tuttiIProdotti.length}</span>
              </Link>
              <Link href={hrefSoloNonCategorizzati} className={`chip${soloNonCategorizzati ? ' is-attivo' : ''}`}>
                Non categorizzati <span className="chip-conteggio">{daCategorizzare}</span>
              </Link>
              <Link href={hrefSoloAttivi} className={`chip${soloAttivi ? ' is-attivo' : ''}`}>
                Con abbonati attivi ora <span className="chip-conteggio">{daCategorizzareAttivi}</span>
              </Link>
            </div>

            {/* GET semplice, niente JS: ricaricare la pagina con ?cerca=...
                è coerente con come funzionano già gli altri filtri qui
                (ordinamento, stato) — tutti link/form, non stato client. Gli
                input nascosti portano avanti lo stato/l'ordinamento
                correnti, così la ricerca si combina con loro invece di
                azzerarli. */}
            <form action="/dashboard/abbonamenti/gruppi" method="get" className="form-row">
              {ordinaPerData && (
                <>
                  <input type="hidden" name="ordina" value="ultima_vendita" />
                  <input type="hidden" name="dir" value={direzioneAttuale} />
                </>
              )}
              {searchParams.solo && <input type="hidden" name="solo" value={searchParams.solo} />}
              <div className="field">
                <input type="search" name="cerca" placeholder="Cerca prodotto…" defaultValue={cercaValore} />
              </div>
              <button type="submit" className="btn btn-ghost btn-sm">
                Cerca
              </button>
              {cercaValore && (
                <Link href={costruisciHref({ cerca: null })} className="muted">
                  Cancella ricerca
                </Link>
              )}
            </form>

            <p className="muted">
              {prodotti.length} prodott{prodotti.length === 1 ? 'o' : 'i'}
              {soloAttivi && ' non categorizzati con almeno un abbonato attivo oggi, dal più urgente'}
              {soloNonCategorizzati && ' ancora da categorizzare'}
              {cercaValore && (
                <>
                  {' '}
                  per “{cercaValore}”
                </>
              )}
              .
            </p>
            {erroreProdottiAttivi && /abbonamenti_prodotti_attivi_non_categorizzati/.test(erroreProdottiAttivi.message) && (
              <p className="vuoto">
                Manca la vista di priorità: esegui
                scripts/sql/2026-09-21-abbonamenti-prodotti-attivi-non-categorizzati.sql nel SQL Editor di Supabase.
              </p>
            )}
            <div className="tabella-wrap">
              <table className="tabella">
                <thead>
                  <tr>
                    <th>Prodotto (da Info4U)</th>
                    {soloAttivi && <th>Attivi ora</th>}
                    <th>Vendite totali</th>
                    <th>
                      <Link href={hrefOrdinaData} className="th-ordina">
                        Ultima vendita
                        {ordinaPerData && (
                          <span className="th-ordina-freccia" aria-hidden="true">
                            {direzioneAttuale === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </Link>
                    </th>
                    <th>Gruppo</th>
                    <th>
                      <AiutoTooltip testo="Segna Sì per un prodotto che non è un vero abbonamento (visita medica, quota d'iscrizione, omaggio, tesseramento...): esce dal conteggio degli utenti attivi e dal report scadenze/rinnovi, sia come voce propria sia come possibile «rinnovo» di un'altra vendita.">
                        No abbonamento
                      </AiutoTooltip>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {prodotti.map((p) => (
                    <RigaProdotto
                      key={p.prodotto}
                      prodotto={p.prodotto}
                      numeroVendite={p.numero_vendite}
                      ultimaVenditaTesto={dataBreveAnno(p.ultima_vendita)}
                      gruppoId={mappaGruppo.get(p.prodotto) ?? null}
                      gruppi={gruppi}
                      noAbbonamento={mappaNoAbbonamento.get(p.prodotto) ?? false}
                      varianti={p.varianti ?? []}
                      importoListinoTesto={euro(p.importo_listino_recente)}
                      attiviOra={soloAttivi ? (mappaAttiviNonCategorizzati.get(p.prodotto) ?? 0) : undefined}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
