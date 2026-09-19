import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { euro } from '@/lib/pipeline'
import { dataBreve, giornoPiu, mezzanotteRoma, oggiRoma, oraBreve } from '@/lib/agenda'
import { caricaDateAzioniDesk } from '@/lib/percorsoVendita-server'
import { eLavorata } from '@/lib/percorsoVendita'
import { PercorsoVendita } from '../PercorsoVendita'

export const dynamic = 'force-dynamic'

type RigaVendita = {
  data_vendita: string
  abbonamento: string | null
  variante: string | null
  totale: number | null
  operatore_nome: string | null
  persona_id: string | null
  persone: { nome: string | null; cognome: string | null } | null
}

const FILTRI_LAVORATE = ['tutte', 'si', 'no'] as const
type FiltroLavorate = (typeof FILTRI_LAVORATE)[number]

const ETICHETTE_FILTRO: Record<FiltroLavorate, string> = {
  tutte: 'Tutte',
  si: 'Lavorate',
  no: 'Non lavorate',
}

export default async function DettaglioGiornoPage({
  searchParams,
}: {
  searchParams: { data?: string; lavorate?: string }
}) {
  if (!(await utenteHaSezione('abbonamenti'))) redirect('/dashboard')

  const oggi = oggiRoma()
  const giorno = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.data ?? '') ? searchParams.data! : oggi
  const filtro: FiltroLavorate = (FILTRI_LAVORATE as readonly string[]).includes(searchParams.lavorate ?? '')
    ? (searchParams.lavorate as FiltroLavorate)
    : 'tutte'

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('abbonamenti')
    .select('data_vendita, abbonamento, variante, totale, operatore_nome, persona_id, persone(nome, cognome)')
    .gte('data_vendita', mezzanotteRoma(giorno))
    .lt('data_vendita', mezzanotteRoma(giornoPiu(giorno, 1)))
    .order('data_vendita', { ascending: false })

  const venditeGiorno = (data ?? []) as unknown as RigaVendita[]

  // Solo per le persone di questo giorno, non per l'anagrafica intera (vedi
  // lib/percorsoVendita-server.ts): un giorno ne porta al massimo qualche
  // decina. Serve sia per il tag qui sotto sia per il filtro.
  const dateAzioni = await caricaDateAzioniDesk(
    supabase,
    venditeGiorno.map((v) => v.persona_id)
  )
  const eLavorataRiga = (v: RigaVendita) =>
    Boolean(v.persona_id) && eLavorata(v.data_vendita, dateAzioni.get(v.persona_id!) ?? [])

  const vendite =
    filtro === 'tutte' ? venditeGiorno : venditeGiorno.filter((v) => (filtro === 'si') === eLavorataRiga(v))
  const totaleGiorno = vendite.reduce((s, v) => s + Number(v.totale ?? 0), 0)

  function hrefFiltro(f: FiltroLavorate) {
    const params = new URLSearchParams({ data: giorno })
    if (f !== 'tutte') params.set('lavorate', f)
    return `/dashboard/abbonamenti/giorno?${params.toString()}`
  }

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Abbonamenti</p>
        <h1>Dettaglio del giorno</h1>
        <p className="muted">
          Ogni abbonamento venduto in {dataBreve(giorno)}, dal più recente al più vecchio — {vendite.length} vendite,{' '}
          {euro(totaleGiorno)}.
        </p>
        <Link href="/dashboard/abbonamenti" className="muted">
          ← Torna ad Abbonamenti
        </Link>
      </div>

      <div className="report-mese-nav">
        <Link href={`/dashboard/abbonamenti/giorno?data=${giornoPiu(giorno, -1)}`} className="btn btn-ghost btn-sm">
          ← Giorno prec.
        </Link>
        <form action="/dashboard/abbonamenti/giorno" method="get" className="form-row">
          <input type="date" name="data" defaultValue={giorno} max={oggi} />
          <button type="submit" className="btn btn-ghost btn-sm">
            Vai
          </button>
        </form>
        {giorno < oggi ? (
          <Link href={`/dashboard/abbonamenti/giorno?data=${giornoPiu(giorno, 1)}`} className="btn btn-ghost btn-sm">
            Giorno succ. →
          </Link>
        ) : (
          <span className="btn btn-ghost btn-sm" aria-disabled="true">
            Giorno succ. →
          </span>
        )}
      </div>

      <div className="filtri">
        <p className="filtri-titolo">Storia commerciale</p>
        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
            {FILTRI_LAVORATE.map((f) => (
              <Link key={f} href={hrefFiltro(f)} className={`chip${filtro === f ? ' is-attivo' : ''}`}>
                {ETICHETTE_FILTRO[f]}
              </Link>
            ))}
          </fieldset>
        </div>
      </div>

      {error && /abbonamenti/.test(error.message) ? (
        <div className="card">
          <p className="vuoto">Errore nel leggere le vendite: {error.message}</p>
        </div>
      ) : vendite.length === 0 ? (
        <div className="card">
          <p className="vuoto">
            {venditeGiorno.length === 0
              ? 'Nessuna vendita in questo giorno.'
              : 'Nessuna vendita corrisponde al filtro scelto.'}
          </p>
        </div>
      ) : (
        <div className="card">
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Ora</th>
                  <th>Prodotto</th>
                  <th>Cliente</th>
                  <th>Operatore</th>
                  <th>Importo</th>
                </tr>
              </thead>
              <tbody>
                {vendite.map((v, i) => (
                  <tr key={i}>
                    <td className="cella-nowrap">{oraBreve(v.data_vendita)}</td>
                    <td>
                      {v.abbonamento ?? '—'}
                      {v.variante && <span className="muted"> · {v.variante}</span>}
                    </td>
                    <td>
                      {v.persone ? `${v.persone.nome ?? ''} ${v.persone.cognome ?? ''}`.trim() || '—' : '—'}
                      {/* In evidenza solo se c'è una storia — chi non ne ha
                          (un rinnovo al banco, un walk-in mai passato dal
                          sito) non porta nessun tag, invece di un "non
                          lavorato" che affollerebbe la lista senza dire
                          niente di più della sua stessa assenza. Il
                          percorso vero e proprio si legge aprendo, sotto —
                          vedi PercorsoVendita. */}
                      {eLavorataRiga(v) && (
                        <span className="badge badge-ok" style={{ marginLeft: '0.5rem' }}>
                          Lavorato
                        </span>
                      )}
                      <PercorsoVendita personaId={v.persona_id} dataVendita={v.data_vendita} />
                    </td>
                    <td>{v.operatore_nome ?? '—'}</td>
                    <td>{v.totale ? euro(v.totale) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
