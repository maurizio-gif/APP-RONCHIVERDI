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
  searchParams: { ordina?: string; dir?: string; solo?: string }
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
  const hrefOrdinaData = `/dashboard/abbonamenti/gruppi?ordina=ultima_vendita&dir=${prossimaDirezione}`

  // "Solo attivi": non tutti i 350+ prodotti da categorizzare, solo quelli
  // che hanno almeno un abbonato attivo adesso — molti prodotti da
  // categorizzare sono storici (es. "ESTATE RAGAZZI 2007") e non pesano sul
  // numero "Non categorizzato" del riquadro Utenti attivi in questo momento,
  // quelli sì. Vedi abbonamenti_prodotti_attivi_non_categorizzati,
  // scripts/sql/2026-09-21-abbonamenti-prodotti-attivi-non-categorizzati.sql.
  const soloAttivi = searchParams.solo === 'attivi'

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

  // Ordinati per priorità (più abbonati attivi prima), non alfabetico: qui
  // lo scopo è "quale sistemo per primo", non "trova un prodotto per nome".
  const prodotti = soloAttivi
    ? tuttiIProdotti
        .filter((p) => mappaAttiviNonCategorizzati.has(p.prodotto))
        .sort((a, b) => (mappaAttiviNonCategorizzati.get(b.prodotto) ?? 0) - (mappaAttiviNonCategorizzati.get(a.prodotto) ?? 0))
    : tuttiIProdotti

  const hrefTutti = (() => {
    const params = new URLSearchParams()
    if (ordinaPerData) {
      params.set('ordina', 'ultima_vendita')
      params.set('dir', direzioneAttuale)
    }
    const query = params.toString()
    return `/dashboard/abbonamenti/gruppi${query ? `?${query}` : ''}`
  })()
  const hrefSoloAttivi = (() => {
    const params = new URLSearchParams()
    params.set('solo', 'attivi')
    if (ordinaPerData) {
      params.set('ordina', 'ultima_vendita')
      params.set('dir', direzioneAttuale)
    }
    return `/dashboard/abbonamenti/gruppi?${params.toString()}`
  })()

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
            {daCategorizzare > 0 && (
              <p className="muted">
                {daCategorizzare} prodott{daCategorizzare === 1 ? 'o' : 'i'} ancora da categorizzare
                {daCategorizzareAttivi > 0 && !soloAttivi && (
                  <>
                    {' '}
                    — <Link href={hrefSoloAttivi}>{daCategorizzareAttivi} con abbonati attivi ora</Link>
                  </>
                )}
                .
              </p>
            )}
            {soloAttivi && (
              <p className="muted">
                Solo i {daCategorizzareAttivi} prodotti non categorizzati con almeno un abbonato attivo oggi, dal più
                urgente. <Link href={hrefTutti}>Mostra tutti i prodotti</Link>
              </p>
            )}
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
