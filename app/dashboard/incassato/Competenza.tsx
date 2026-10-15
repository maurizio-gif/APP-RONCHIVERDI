import Link from 'next/link'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { euro } from '@/lib/pipeline'
import { etichettaMese, mesePiu, primoDelMese } from '@/lib/agenda'

// L'incassato per COMPETENZA e i risconti passivi (vedi
// scripts/sql/2026-10-15-incassato-competenza.sql).
//
// Per cassa un annuale pagato a gennaio pesa tutto su gennaio; per competenza
// lo stesso incasso si spalma sui mesi dell'abbonamento, in proporzione ai
// giorni e secondo la durata venduta. I movimenti senza vendita (cauzioni,
// tesseramenti, prenotazioni…) restano nel giorno in cui sono entrati.
//
// I due numeri arrivano da viste materializzate ricalcolate ogni ora: il
// calcolo su tutta la storia dei movimenti richiede qualche secondo, troppo
// per una pagina.

type Supabase = ReturnType<typeof createSupabaseServiceClient>

type RigaMese = { mese: string; gruppo: string; cassa: number; competenza: number }
type RigaRisconto = { calcolato_al: string; gruppo: string; mese_rilascio: string; importo: number }

const eur = (n: number) => euro(n) ?? '—'

function Importo({ valore }: { valore: number }) {
  return <span className={valore < 0 ? 'importo-neg' : undefined}>{Math.abs(valore) < 0.005 ? '—' : eur(valore)}</span>
}

function Stat({ label, valore, nota }: { label: string; valore: string; nota?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-valore">{valore}</span>
      {nota && <span className="stat-nota">{nota}</span>}
    </div>
  )
}

const nomeMese = (giorno: string) =>
  new Date(`${giorno}T12:00:00Z`).toLocaleDateString('it-IT', { timeZone: 'UTC', month: 'long' })

const dataIt = (giorno: string) => `${giorno.slice(8, 10)}/${giorno.slice(5, 7)}/${giorno.slice(0, 4)}`

export async function Competenza({
  mese,
  oggi,
  hrefMese,
  supabase,
}: {
  mese: string
  oggi: string
  /** Il link alla stessa vista su un altro mese. */
  hrefMese: (mese: string) => string
  supabase: Supabase
}) {
  const anno = mese.slice(0, 4)
  const [{ data: mesi, error }, { data: risconti, error: erroreRisconti }] = await Promise.all([
    supabase
      .from('incassi_competenza_mensile')
      .select('mese, gruppo, cassa, competenza')
      .gte('mese', `${anno}-01-01`)
      .lte('mese', `${anno}-12-01`),
    supabase.from('risconti_passivi').select('calcolato_al, gruppo, mese_rilascio, importo').limit(2000),
  ])

  if (error || erroreRisconti) {
    return (
      <div className="card">
        <p className="vuoto">
          Non riesco a leggere la competenza: {(error ?? erroreRisconti)?.message}. Se le viste non esistono, esegui
          scripts/sql/2026-10-15-incassato-competenza.sql nel SQL Editor di Supabase.
        </p>
      </div>
    )
  }

  const righe = ((mesi ?? []) as RigaMese[]).map((r) => ({ ...r, cassa: Number(r.cassa), competenza: Number(r.competenza) }))
  const meseCorrente = primoDelMese(oggi)

  // L'anno del mese scelto, mese per mese.
  const perMese = new Map<string, { cassa: number; competenza: number }>()
  for (let i = 0; i < 12; i++) perMese.set(`${anno}-${String(i + 1).padStart(2, '0')}-01`, { cassa: 0, competenza: 0 })
  for (const r of righe) {
    const m = perMese.get(r.mese)
    if (!m) continue
    m.cassa += r.cassa
    m.competenza += r.competenza
  }
  const totaleAnno = Array.from(perMese.values()).reduce(
    (t, m) => ({ cassa: t.cassa + m.cassa, competenza: t.competenza + m.competenza }),
    { cassa: 0, competenza: 0 }
  )

  // Il mese scelto, per gruppo prodotto.
  const delMese = righe
    .filter((r) => r.mese === mese)
    .sort((a, b) => b.competenza - a.competenza || a.gruppo.localeCompare(b.gruppo, 'it'))
  const meseScelto = perMese.get(mese) ?? { cassa: 0, competenza: 0 }

  // I risconti passivi: per gruppo, e per mese in cui diventano ricavo.
  const elencoRisconti = ((risconti ?? []) as RigaRisconto[]).map((r) => ({ ...r, importo: Number(r.importo) }))
  const calcolatoAl = elencoRisconti[0]?.calcolato_al ?? oggi
  const totaleRisconti = elencoRisconti.reduce((s, r) => s + r.importo, 0)
  const fineAnno = `${oggi.slice(0, 4)}-12-01`
  const entroFineAnno = elencoRisconti.filter((r) => r.mese_rilascio <= fineAnno).reduce((s, r) => s + r.importo, 0)
  const riscontiPerGruppo = new Map<string, { totale: number; entroAnno: number; oltre: number }>()
  for (const r of elencoRisconti) {
    const g = riscontiPerGruppo.get(r.gruppo) ?? { totale: 0, entroAnno: 0, oltre: 0 }
    g.totale += r.importo
    if (r.mese_rilascio <= fineAnno) g.entroAnno += r.importo
    else g.oltre += r.importo
    riscontiPerGruppo.set(r.gruppo, g)
  }
  const gruppiRisconti = Array.from(riscontiPerGruppo.entries())
    .filter(([, g]) => Math.abs(g.totale) >= 0.005)
    .sort((a, b) => b[1].totale - a[1].totale)

  // Lo scadenzario: i prossimi 12 mesi uno per uno, il resto insieme.
  const ultimoDettaglio = mesePiu(meseCorrente, 11)
  const perRilascio = new Map<string, number>()
  let oltre = 0
  for (const r of elencoRisconti) {
    if (r.mese_rilascio > ultimoDettaglio) oltre += r.importo
    else perRilascio.set(r.mese_rilascio, (perRilascio.get(r.mese_rilascio) ?? 0) + r.importo)
  }
  const scadenzario = Array.from(perRilascio.entries()).sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <>
      <div className="griglia-stat">
        <Stat
          label={`Per competenza, ${etichettaMese(mese)}`}
          valore={eur(meseScelto.competenza)}
          nota="Gli incassi ridistribuiti sui giorni dell’abbonamento a cui si riferiscono."
        />
        <Stat
          label={`Per cassa, ${etichettaMese(mese)}`}
          valore={eur(meseScelto.cassa)}
          nota="I movimenti entrati nel mese, come nel riepilogo."
        />
        <Stat
          label="Risconti passivi ad oggi"
          valore={eur(totaleRisconti)}
          nota={`Incassi già ricevuti di competenza dei giorni dopo il ${dataIt(calcolatoAl)}.`}
        />
        <Stat
          label={`di cui diventano ricavo entro il ${oggi.slice(0, 4)}`}
          valore={eur(entroFineAnno)}
          nota={`Il resto, ${eur(totaleRisconti - entroFineAnno)}, negli anni successivi.`}
        />
      </div>

      <div className="card">
        <p className="filtri-titolo">{anno}, mese per mese</p>
        <p className="muted">
          Ogni incasso collegato a una vendita è spalmato dall’inizio dell’abbonamento alla fine che spetta dalla durata
          venduta (proroghe e sospensioni non la allungano), in proporzione ai giorni; rate e saldi compresi, anche se
          arrivano dopo. Gli altri movimenti (cauzioni, tesseramenti, prenotazioni, eliminazioni) restano nel mese in cui
          sono entrati. Sommati su tutti i mesi, cassa e competenza coincidono. I mesi futuri mostrano la parte già
          incassata che diventerà ricavo: crescono con i nuovi incassi.
        </p>
        <div className="tabella-wrap">
          <table className="tabella tabella-competenza">
            <thead>
              <tr>
                <th>Mese</th>
                <th className="cella-importo">Per cassa</th>
                <th className="cella-importo">Per competenza</th>
                <th className="cella-importo" title="Competenza meno cassa">Differenza</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(perMese.entries()).map(([m, v]) => (
                <tr key={m} className={m === mese ? 'riga-evidenziata' : undefined}>
                  <td>
                    <Link href={hrefMese(m)}>{nomeMese(m)}</Link>
                    {m > meseCorrente && <span className="nota-in-riga">da incassi già ricevuti</span>}
                    {m === meseCorrente && <span className="nota-in-riga">in corso</span>}
                  </td>
                  <td className="cella-importo">
                    <Importo valore={v.cassa} />
                  </td>
                  <td className="cella-importo">
                    <strong>
                      <Importo valore={v.competenza} />
                    </strong>
                  </td>
                  <td className="cella-importo">
                    <Importo valore={v.competenza - v.cassa} />
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Totale {anno}</strong>
                </td>
                <td className="cella-importo">
                  <strong>
                    <Importo valore={totaleAnno.cassa} />
                  </strong>
                </td>
                <td className="cella-importo">
                  <strong>
                    <Importo valore={totaleAnno.competenza} />
                  </strong>
                </td>
                <td className="cella-importo">
                  <strong>
                    <Importo valore={totaleAnno.competenza - totaleAnno.cassa} />
                  </strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <p className="filtri-titolo">{etichettaMese(mese)}, per gruppo prodotto</p>
        {delMese.length === 0 ? (
          <p className="vuoto">Nessun incasso di competenza di {etichettaMese(mese)}.</p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella tabella-competenza">
              <thead>
                <tr>
                  <th>Gruppo</th>
                  <th className="cella-importo">Per cassa</th>
                  <th className="cella-importo">Per competenza</th>
                  <th className="cella-importo">Differenza</th>
                </tr>
              </thead>
              <tbody>
                {delMese.map((r) => (
                  <tr key={r.gruppo}>
                    <td>{r.gruppo}</td>
                    <td className="cella-importo">
                      <Importo valore={r.cassa} />
                    </td>
                    <td className="cella-importo">
                      <strong>
                        <Importo valore={r.competenza} />
                      </strong>
                    </td>
                    <td className="cella-importo">
                      <Importo valore={r.competenza - r.cassa} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <p className="filtri-titolo">Risconti passivi al {dataIt(calcolatoAl)}</p>
        <p className="muted">
          La parte degli incassi già ricevuti che appartiene ai giorni successivi: abbonamenti pagati e non ancora
          goduti. Ricalcolati ogni ora.
        </p>
        <div className="tabella-wrap">
          <table className="tabella tabella-competenza">
            <thead>
              <tr>
                <th>Gruppo</th>
                <th className="cella-importo">Entro il {oggi.slice(0, 4)}</th>
                <th className="cella-importo">Dopo</th>
                <th className="cella-importo">Totale</th>
              </tr>
            </thead>
            <tbody>
              {gruppiRisconti.map(([nome, g]) => (
                <tr key={nome}>
                  <td>{nome}</td>
                  <td className="cella-importo">
                    <Importo valore={g.entroAnno} />
                  </td>
                  <td className="cella-importo">
                    <Importo valore={g.oltre} />
                  </td>
                  <td className="cella-importo">
                    <strong>
                      <Importo valore={g.totale} />
                    </strong>
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Totale</strong>
                </td>
                <td className="cella-importo">
                  <strong>
                    <Importo valore={entroFineAnno} />
                  </strong>
                </td>
                <td className="cella-importo">
                  <strong>
                    <Importo valore={totaleRisconti - entroFineAnno} />
                  </strong>
                </td>
                <td className="cella-importo">
                  <strong>
                    <Importo valore={totaleRisconti} />
                  </strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="filtri-titolo" style={{ marginTop: '1.25rem' }}>
          Quando diventano ricavo
        </p>
        <div className="tabella-wrap">
          <table className="tabella tabella-compatta tabella-competenza">
            <thead>
              <tr>
                <th>Mese</th>
                <th className="cella-importo">Importo</th>
              </tr>
            </thead>
            <tbody>
              {scadenzario.map(([m, importo]) => (
                <tr key={m}>
                  <td>
                    {etichettaMese(m)}
                    {m === meseCorrente && <span className="nota-in-riga">dal {Number(calcolatoAl.slice(8, 10)) + 1} a fine mese</span>}
                  </td>
                  <td className="cella-importo">
                    <Importo valore={importo} />
                  </td>
                </tr>
              ))}
              {Math.abs(oltre) >= 0.005 && (
                <tr>
                  <td>Dopo {etichettaMese(ultimoDettaglio)}</td>
                  <td className="cella-importo">
                    <Importo valore={oltre} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
