import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { caricaGruppi, caricaMacroSettori } from '@/lib/abbonamenti'
import { dataBreve, giornoDiIstante } from '@/lib/agenda'
import NuovoGruppoForm from './NuovoGruppoForm'
import NuovoMacroSettoreForm from './NuovoMacroSettoreForm'
import RigaGruppo from './RigaGruppo'
import RigaProdotto from './RigaProdotto'

export const dynamic = 'force-dynamic'

export default async function GruppiAbbonamentiPage() {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  const supabase = createSupabaseServiceClient()
  const [gruppi, macroSettori, prodottiRisposta, mappaturaRisposta] = await Promise.all([
    caricaGruppi(),
    caricaMacroSettori(),
    supabase
      .from('abbonamenti_prodotti')
      .select('prodotto, numero_vendite, ultima_vendita')
      .order('prodotto'),
    supabase.from('abbonamenti_mappatura').select('prodotto, gruppo_id'),
  ])

  const erroreViste = prodottiRisposta.error
  const prodotti = prodottiRisposta.data ?? []

  const mappaGruppo = new Map<string, string | null>()
  for (const riga of mappaturaRisposta.data ?? []) mappaGruppo.set(riga.prodotto, riga.gruppo_id)

  const daCategorizzare = prodotti.filter((p) => !mappaGruppo.get(p.prodotto)).length

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Abbonamenti</p>
        <h1>Gruppi prodotto</h1>
        <p className="muted">
          Ogni prodotto venduto in Info4U va assegnato a un gruppo per comparire correttamente nei report, e ogni
          gruppo a un macro settore (business unit) per i confronti fra aree — un prodotto non ancora assegnato
          conta come &quot;Non categorizzato&quot;.
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
            <p className="filtri-titolo">Macro settori (business unit)</p>
            <div className="filtri-gruppi">
              {macroSettori.length === 0 ? (
                <p className="muted">Nessun macro settore creato ancora — crea il primo qui sotto.</p>
              ) : (
                macroSettori.map((m) => (
                  <span key={m.id} className="chip">
                    {m.nome}
                  </span>
                ))
              )}
            </div>
            <NuovoMacroSettoreForm />
          </div>

          <div className="card">
            <p className="filtri-titolo">Gruppi</p>
            <div className="tabella-wrap">
              <table className="tabella">
                <thead>
                  <tr>
                    <th>Gruppo</th>
                    <th>Macro settore</th>
                  </tr>
                </thead>
                <tbody>
                  {gruppi.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="vuoto">
                        Nessun gruppo creato ancora — crea il primo qui sotto.
                      </td>
                    </tr>
                  ) : (
                    gruppi.map((g) => (
                      <RigaGruppo
                        key={g.id}
                        gruppoId={g.id}
                        nome={g.nome}
                        macroSettoreId={g.macro_settore_id}
                        macroSettori={macroSettori}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <NuovoGruppoForm />
          </div>

          <div className="card">
            <p className="filtri-titolo">Prodotti (da Info4U)</p>
            {daCategorizzare > 0 && (
              <p className="muted">
                {daCategorizzare} prodott{daCategorizzare === 1 ? 'o' : 'i'} ancora da categorizzare.
              </p>
            )}
            <div className="tabella-wrap">
              <table className="tabella">
                <thead>
                  <tr>
                    <th>Prodotto</th>
                    <th>Vendite totali</th>
                    <th>Ultima vendita</th>
                    <th>Gruppo</th>
                  </tr>
                </thead>
                <tbody>
                  {prodotti.map((p) => (
                    <RigaProdotto
                      key={p.prodotto}
                      prodotto={p.prodotto}
                      numeroVendite={p.numero_vendite}
                      ultimaVenditaTesto={p.ultima_vendita ? dataBreve(giornoDiIstante(p.ultima_vendita)) : '—'}
                      gruppoId={mappaGruppo.get(p.prodotto) ?? null}
                      gruppi={gruppi}
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
