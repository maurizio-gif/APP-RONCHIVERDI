import Link from 'next/link'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { leggiPaginato } from '@/lib/supabase/leggiPaginato'
import { caricaGruppi } from '@/lib/abbonamenti'
import { dataIt, euroIntero, oggiRoma } from '@/lib/tesseramenti'

// Chi ha pagato con IVA a zero e non ha una tessera CSI in corso.
//
// La tessera è la condizione del non assoggettamento all'IVA degli abbonamenti
// ai soci (art. 4 del DPR 633/72, la dicitura sulle righe delle ricevute): chi
// ha pagato così senza una tessera valida è un'esposizione da regolarizzare.
// L'elenco viene dalla funzione iva_zero_senza_tessera (vedi
// scripts/sql/2026-10-29-tessere-csi.sql): le ricevute annullate non contano,
// conta il netto, e per ogni persona ci sono l'abbonamento reale in corso (la
// stessa definizione del report abbonamenti), da quando è iscritta e l'ultima
// tessera avuta.
//
// Chi non ha il codice fiscale in anagrafica non si può abbinare alle tessere
// di CSI: è segnalato, perché la tessera potrebbe esserci senza che si veda.

type SearchParams = Record<string, string | undefined>

const PERIODI = [
  { chiave: '3', etichetta: '3 mesi', mesi: 3 },
  { chiave: '6', etichetta: '6 mesi', mesi: 6 },
  { chiave: '12', etichetta: '12 mesi', mesi: 12 },
  { chiave: '24', etichetta: '24 mesi', mesi: 24 },
  { chiave: 'tutto', etichetta: 'Tutto', mesi: null },
] as const
const TITOLI = [
  { chiave: 'art4', etichetta: 'Art. 4 (soci)', valore: 'art. 4' },
  { chiave: 'art15', etichetta: 'Art. 15', valore: 'art. 15' },
  { chiave: 'tutte', etichetta: 'Ogni IVA zero', valore: null },
] as const
const SOLO = [
  { chiave: 'tutti', etichetta: 'Tutti' },
  { chiave: 'abbonamento', etichetta: 'Con abbonamento in corso' },
] as const

type RigaIva = {
  persona_id: string
  nome: string | null
  cognome: string | null
  codice_fiscale: string | null
  n_ricevute: number
  importo: number | string
  primo_pagamento: string | null
  ultimo_pagamento: string | null
  abbonamento: string | null
  gruppo_id: string | null
  data_inizio: string | null
  data_fine: string | null
  iscritto_dal: string | null
  ultima_tessera: string | null
  ultima_tessera_scadenza: string | null
}

/** Sottrae `mesi` mesi a una data aaaa-mm-gg. */
function menoMesi(iso: string, mesi: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - mesi)
  return d.toISOString().slice(0, 10)
}

export async function VistaIvaZero({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createSupabaseServiceClient()
  const oggi = oggiRoma()

  const periodo = PERIODI.find((p) => p.chiave === searchParams.periodo) ?? PERIODI[2]
  const titolo = TITOLI.find((t) => t.chiave === searchParams.titolo) ?? TITOLI[0]
  const solo = SOLO.find((s) => s.chiave === searchParams.solo) ?? SOLO[0]
  // I dati delle ricevute partono dal 1 gennaio 2023.
  const dal = periodo.mesi ? menoMesi(oggi, periodo.mesi) : '2023-01-01'

  const [{ righe, error }, gruppi] = await Promise.all([
    leggiPaginato<RigaIva>((da) =>
      supabase
        .rpc('iva_zero_senza_tessera', { p_dal: dal, p_titolo: titolo.valore })
        .range(da, da + 999) as unknown as PromiseLike<{ data: RigaIva[] | null; error: { message: string } | null }>
    ),
    caricaGruppi(),
  ])
  const nomeGruppo = new Map(gruppi.map((g) => [g.id, g.nome]))

  // Prima chi ha un abbonamento reale in corso (è chi va regolarizzato adesso),
  // poi gli altri, ognuno dal pagamento più recente.
  const conAbbonamento = righe.filter((r) => !!r.abbonamento)
  const elenco = (solo.chiave === 'abbonamento' ? conAbbonamento : righe).slice().sort((a, b) => {
    if (!!a.abbonamento !== !!b.abbonamento) return a.abbonamento ? -1 : 1
    return (b.ultimo_pagamento ?? '').localeCompare(a.ultimo_pagamento ?? '')
  })
  const importoTotale = elenco.reduce((s, r) => s + Number(r.importo), 0)
  const senzaCf = elenco.filter((r) => !r.codice_fiscale || r.codice_fiscale.trim().length !== 16).length

  const href = (campi: { periodo?: string; titolo?: string; solo?: string }) => {
    const p = new URLSearchParams({ sezione: 'iva' })
    const per = campi.periodo ?? periodo.chiave
    const tit = campi.titolo ?? titolo.chiave
    const sol = campi.solo ?? solo.chiave
    if (per !== '12') p.set('periodo', per)
    if (tit !== 'art4') p.set('titolo', tit)
    if (sol !== 'tutti') p.set('solo', sol)
    return `/dashboard/tesseramenti?${p.toString()}`
  }

  return (
    <>
      <p className="muted">
        Chi ha avuto pagamenti con IVA a zero e non ha una tessera CSI in corso. La tessera è la condizione del non
        assoggettamento all&apos;IVA degli abbonamenti ai soci: per ognuno ci sono l&apos;abbonamento reale in corso, da
        quando è iscritto e l&apos;ultima tessera avuta.
      </p>

      <div className="griglia-stat">
        <div className={`stat${elenco.length > 0 ? ' stat-warn' : ' stat-ok'}`}>
          <span className="stat-label">Persone senza tessera in corso</span>
          <span className="stat-valore">{elenco.length.toLocaleString('it-IT')}</span>
          <span className="stat-nota">Con pagamenti a IVA zero negli ultimi {periodo.etichetta.toLowerCase()}.</span>
        </div>
        <div className="stat">
          <span className="stat-label">Con abbonamento reale in corso</span>
          <span className="stat-valore">{conAbbonamento.length.toLocaleString('it-IT')}</span>
          <span className="stat-nota">Da regolarizzare adesso: pagano e frequentano.</span>
        </div>
        <div className="stat">
          <span className="stat-label">Incassato a IVA zero</span>
          <span className="stat-valore">{euroIntero(importoTotale)}</span>
          <span className="stat-nota">Netto delle ricevute annullate, di queste persone.</span>
        </div>
      </div>

      <div className="card">
        <div className="check-sosp-filtri">
          <div className="check-sosp-gruppo" role="group" aria-label="Periodo">
            {PERIODI.map((p) => (
              <Link
                key={p.chiave}
                href={href({ periodo: p.chiave })}
                className={`chip${periodo.chiave === p.chiave ? ' is-attivo' : ''}`}
                aria-current={periodo.chiave === p.chiave ? 'true' : undefined}
                scroll={false}
              >
                {p.etichetta}
              </Link>
            ))}
          </div>
          <div className="check-sosp-gruppo" role="group" aria-label="Dicitura IVA">
            {TITOLI.map((t) => (
              <Link
                key={t.chiave}
                href={href({ titolo: t.chiave })}
                className={`chip${titolo.chiave === t.chiave ? ' is-attivo' : ''}`}
                aria-current={titolo.chiave === t.chiave ? 'true' : undefined}
                scroll={false}
              >
                {t.etichetta}
              </Link>
            ))}
          </div>
          <div className="check-sosp-gruppo" role="group" aria-label="Abbonamento">
            {SOLO.map((s) => (
              <Link
                key={s.chiave}
                href={href({ solo: s.chiave })}
                className={`chip${solo.chiave === s.chiave ? ' is-attivo' : ''}`}
                aria-current={solo.chiave === s.chiave ? 'true' : undefined}
                scroll={false}
              >
                {s.etichetta}
              </Link>
            ))}
          </div>
        </div>

        {error ? (
          <p className="vuoto">
            Non riesco a leggere l&apos;elenco: {error.message}. Se manca la funzione, esegui
            scripts/sql/2026-10-29-tessere-csi.sql nel SQL Editor di Supabase.
          </p>
        ) : elenco.length === 0 ? (
          <div className="vuoto-buono">
            <span className="vuoto-glifo" aria-hidden="true">
              ✓
            </span>
            <p className="vuoto-titolo">Nessuno con pagamenti a IVA zero e senza tessera in corso</p>
          </div>
        ) : (
          <>
            {senzaCf > 0 && (
              <p className="field-hint">
                {senzaCf.toLocaleString('it-IT')} persone non hanno il codice fiscale in anagrafica: la tessera potrebbe
                esserci su CSI senza che si veda. Sono segnate nella tabella.
              </p>
            )}
            <div className="tabella-wrap">
              <table className="tabella tabella-compatta">
                <thead>
                  <tr>
                    <th>Nominativo</th>
                    <th>Abbonamento reale in corso</th>
                    <th>Iscritto dal</th>
                    <th>Pagamenti a IVA zero</th>
                    <th>Ultima tessera</th>
                  </tr>
                </thead>
                <tbody>
                  {elenco.map((r) => {
                    const nominativo = [r.cognome, r.nome].filter(Boolean).join(' ') || 'Senza nome'
                    const cfOk = !!r.codice_fiscale && r.codice_fiscale.trim().length === 16
                    return (
                      <tr key={r.persona_id} className={r.abbonamento ? 'riga-evidenza' : undefined}>
                        <td className="cella-persona">
                          <Link href={`/dashboard/persone/${r.persona_id}`}>{nominativo}</Link>
                          {!cfOk && <span className="nota-in-riga">senza codice fiscale</span>}
                        </td>
                        <td>
                          {r.abbonamento ? (
                            <>
                              <strong>{r.abbonamento}</strong>
                              <span className="nota-in-riga">
                                {r.gruppo_id && nomeGruppo.get(r.gruppo_id) ? `${nomeGruppo.get(r.gruppo_id)} · ` : ''}
                                dal {dataIt(r.data_inizio)} al {dataIt(r.data_fine)}
                              </span>
                            </>
                          ) : (
                            <span className="muted">Nessuno in corso</span>
                          )}
                        </td>
                        <td className="cella-nowrap">{dataIt(r.iscritto_dal)}</td>
                        <td className="cella-nowrap">
                          <strong>{euroIntero(Number(r.importo))}</strong>
                          <span className="nota-in-riga">
                            {r.n_ricevute} {r.n_ricevute === 1 ? 'ricevuta' : 'ricevute'} · ultima {dataIt(r.ultimo_pagamento)}
                          </span>
                        </td>
                        <td className="cella-nowrap">
                          {r.ultima_tessera ? (
                            <>
                              <span className="badge badge-ko">Scaduta</span>
                              <span className="nota-in-riga">
                                {r.ultima_tessera} il {dataIt(r.ultima_tessera_scadenza)}
                              </span>
                            </>
                          ) : (
                            <span className="badge badge-warn">Mai tesserato</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  )
}
