import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { caricaGruppi } from '@/lib/abbonamenti'
import { dataBreve as dataBreveAnno } from '@/lib/persone'
import NuovoGruppoForm from './NuovoGruppoForm'
import RigaProdotto from './RigaProdotto'

export const dynamic = 'force-dynamic'

export default async function GruppiAbbonamentiPage({
  searchParams,
}: {
  searchParams: { ordina?: string; dir?: string }
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

  const supabase = createSupabaseServiceClient()
  let queryProdotti = supabase.from('abbonamenti_prodotti').select('prodotto, numero_vendite, ultima_vendita, varianti')
  queryProdotti = ordinaPerData
    ? queryProdotti.order('ultima_vendita', { ascending: direzioneAttuale === 'asc', nullsFirst: direzioneAttuale === 'asc' })
    : queryProdotti.order('prodotto')

  const [gruppi, prodottiRisposta, mappaturaRisposta] = await Promise.all([
    caricaGruppi(),
    queryProdotti,
    supabase.from('abbonamenti_mappatura').select('prodotto, gruppo_id, no_abbonamento'),
  ])

  const erroreViste = prodottiRisposta.error
  const prodotti = prodottiRisposta.data ?? []

  const mappaGruppo = new Map<string, string | null>()
  const mappaNoAbbonamento = new Map<string, boolean>()
  for (const riga of mappaturaRisposta.data ?? []) {
    mappaGruppo.set(riga.prodotto, riga.gruppo_id)
    mappaNoAbbonamento.set(riga.prodotto, riga.no_abbonamento ?? false)
  }

  const daCategorizzare = prodotti.filter((p) => !mappaGruppo.get(p.prodotto)).length

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
                {daCategorizzare} prodott{daCategorizzare === 1 ? 'o' : 'i'} ancora da categorizzare.
              </p>
            )}
            <div className="tabella-wrap">
              <table className="tabella">
                <thead>
                  <tr>
                    <th>Prodotto (da Info4U)</th>
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
                      <span
                        className="th-aiuto"
                        title="Segna Sì per un prodotto che non è un vero abbonamento (visita medica, quota d'iscrizione, omaggio, tesseramento...): esce dal conteggio degli utenti attivi e dal report scadenze/rinnovi, sia come voce propria sia come possibile «rinnovo» di un'altra vendita."
                      >
                        No abbonamento
                      </span>
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
