import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { oggiRoma } from '@/lib/agenda'
import { caricaGruppi } from '@/lib/abbonamenti'
import { mappaNomiStaff, ordinaPerCognome, type RigaStaff } from '@/lib/staff'
import {
  AB,
  AC,
  CM,
  ETICHETTE_AB,
  ETICHETTE_AC,
  ETICHETTE_CM,
  ETICHETTE_LD,
  ETICHETTE_ORDINE,
  GIORNI,
  LD,
  NESSUN_ASSEGNATARIO,
  ORDINI,
  PER_PAGINA,
  SCELTE_RAPIDE,
  descriviFiltri,
  giorni,
  inParametri,
  leggiFiltri,
  numeroFiltri,
} from '@/lib/contatti-filtri'
import { ScriptContattiMancante, cercaContatti } from '@/lib/contatti-filtri-server'
import { ElencoContatti } from './ElencoContatti'

export const dynamic = 'force-dynamic'

type Parametri = Record<string, string | string[] | undefined>

// Contatti › Filtri: una lista personalizzata sull'intera anagrafica. Si
// combinano condizioni su abbonamento, accessi, lead e dati del socio (tutte
// insieme: «attivi che non vengono da 30 giorni», «lead non contattati degli
// ultimi 7 giorni»), si guarda chi le soddisfa, si sceglie chi tenere e si
// scarica o si copia. Tutto passa dall'URL — una lista si salva fra i
// preferiti o si manda a un collega — e il filtro vero sta nel database
// (`contatti_filtrati`, vedi scripts/sql/2026-10-29-contatti-filtri.sql).
export default async function FiltriContattiPage({ searchParams }: { searchParams: Parametri }) {
  if (!(await utenteHaSezione('persone'))) redirect('/dashboard')

  const db = createSupabaseServiceClient()
  const { filtri, ordine, pagina } = leggiFiltri(searchParams)
  const [gruppi, { data: staff }] = await Promise.all([
    caricaGruppi(),
    db.from('staff_users').select('email, nome, cognome'),
  ])
  const staffOrdinato = ordinaPerCognome((staff ?? []) as RigaStaff[])
  const nomiStaff = mappaNomiStaff(staffOrdinato)
  const nomiGruppi = Object.fromEntries(gruppi.map((g) => [g.id as string, g.nome as string]))

  let risultato: Awaited<ReturnType<typeof cercaContatti>> | null = null
  let errore: string | null = null
  let scriptMancante = false
  const haFiltri = numeroFiltri(filtri) > 0 || ordine !== 'cognome'
  try {
    risultato = await cercaContatti(db, filtri, ordine, pagina)
  } catch (e) {
    if (e instanceof ScriptContattiMancante) scriptMancante = true
    else errore = e instanceof Error ? e.message : 'Errore nella lettura dei contatti.'
  }

  const base = inParametri(filtri, { ord: ordine === 'cognome' ? undefined : ordine })
  const hrefCon = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams(base)
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) q.delete(k)
      else q.set(k, v)
    }
    const s = q.toString()
    return `/dashboard/persone/filtri${s ? `?${s}` : ''}`
  }
  const attivi = descriviFiltri(filtri, { gruppi: nomiGruppi, staff: nomiStaff })
  const totale = risultato?.totale ?? 0
  const pagine = Math.max(1, Math.ceil(totale / PER_PAGINA))
  const rapidaAttiva = (p: Record<string, string>) => {
    const a = new URLSearchParams(p)
    const b = new URLSearchParams(base)
    a.delete('ord')
    b.delete('ord')
    return a.toString() === b.toString()
  }
  const oggi = oggiRoma()
  const selectGiorni = (nome: string, valore: number | undefined, predefinito: number) => (
    <select name={nome} defaultValue={String(valore ?? predefinito)} aria-label="Giorni">
      {GIORNI.map((g) => (
        <option key={g} value={g}>
          {giorni(g)}
        </option>
      ))}
    </select>
  )

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Anagrafica</p>
        <h1>Contatti</h1>
        <p className="muted">
          Costruisci una lista su misura: combina le condizioni, guarda chi le soddisfa, scegli i nominativi e scaricali o
          copiali. I filtri valgono sull&apos;intera anagrafica, storico incluso.
        </p>
        <nav className="agenda-nav accessi-nav" aria-label="Contatti">
          <Link href="/dashboard/persone" className="btn btn-sm btn-ghost">
            Elenco e ricerca
          </Link>
          <Link href="/dashboard/persone/filtri" className="btn btn-sm" aria-current="page">
            Filtri e liste
          </Link>
        </nav>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Scelte rapide</h2>
          <span className="muted">un clic e la lista è pronta</span>
        </div>
        <div className="contatti-rapide">
          {SCELTE_RAPIDE.map((s) => (
            <Link
              key={s.chiave}
              href={`/dashboard/persone/filtri?${new URLSearchParams(s.parametri).toString()}`}
              className={`chip ${rapidaAttiva(s.parametri) ? 'is-attivo' : ''}`}
              title={s.nota}
            >
              {s.etichetta}
            </Link>
          ))}
        </div>
      </div>

      <form method="get" className="card contatti-filtri">
        <div className="card-head">
          <h2>Filtri</h2>
          <span className="muted">tutte le condizioni scelte valgono insieme</span>
        </div>

        <div className="field" style={{ marginBottom: '1.1rem' }}>
          <label htmlFor="q">Cerca per nome, cognome, email o cellulare</label>
          <input id="q" name="q" type="search" defaultValue={filtri.q ?? ''} placeholder="Facoltativo" autoComplete="off" />
        </div>

        <div className="contatti-gruppi-filtri">
          <fieldset>
            <legend>Abbonamento</legend>
            <label>
              <span>Stato</span>
              <select name="ab" defaultValue={filtri.ab ?? ''}>
                <option value="">Indifferente</option>
                {AB.map((a) => (
                  <option key={a} value={a}>
                    {ETICHETTE_AB[a]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Quanto (per «in scadenza», «scaduto da poco» e «da più tempo»)</span>
              {selectGiorni('abg', filtri.abg, 30)}
            </label>
            <label>
              <span>Solo nel gruppo di prodotti</span>
              <select name="gr" defaultValue={filtri.gr ?? ''}>
                <option value="">Tutti i prodotti</option>
                {gruppi.map((g) => (
                  <option key={g.id as string} value={g.id as string}>
                    {g.nome as string}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          <fieldset>
            <legend>Ingressi in sede</legend>
            <label>
              <span>Frequenza</span>
              <select name="ac" defaultValue={filtri.ac ?? ''}>
                <option value="">Indifferente</option>
                {AC.map((a) => (
                  <option key={a} value={a}>
                    {ETICHETTE_AC[a]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Da quanto (per «non entra» e «è entrato»)</span>
              {selectGiorni('acg', filtri.acg, 30)}
            </label>
          </fieldset>

          <fieldset>
            <legend>Lead</legend>
            <label>
              <span>Stato</span>
              <select name="ld" defaultValue={filtri.ld ?? ''}>
                <option value="">Indifferente</option>
                {LD.filter((l) => l !== 'qualsiasi').map((l) => (
                  <option key={l} value={l}>
                    {ETICHETTE_LD[l]}
                  </option>
                ))}
                <option value="qualsiasi">Ha almeno un lead</option>
              </select>
            </label>
            <label>
              <span>Solo lead nati negli ultimi</span>
              <select name="lda" defaultValue={filtri.lda ? String(filtri.lda) : ''}>
                <option value="">Qualsiasi data</option>
                {[7, 14, 30, 60, 90].map((g) => (
                  <option key={g} value={g}>
                    {giorni(g)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>«Ferma» da (in gestione, senza novità)</span>
              {selectGiorni('ldg', filtri.ldg, 14)}
            </label>
            <label>
              <span>Trattativa seguita da</span>
              <select name="ass" defaultValue={filtri.ass ?? ''}>
                <option value="">Chiunque</option>
                <option value={NESSUN_ASSEGNATARIO}>Nessuno (da assegnare)</option>
                {staffOrdinato.map((s) => (
                  <option key={s.email} value={s.email}>
                    {nomiStaff[s.email] ?? s.email}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          <fieldset>
            <legend>Altri dati</legend>
            <label>
              <span>Certificato medico</span>
              <select name="cm" defaultValue={filtri.cm ?? ''}>
                <option value="">Indifferente</option>
                {CM.map((c) => (
                  <option key={c} value={c}>
                    {ETICHETTE_CM[c]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Compleanno entro</span>
              <select name="cp" defaultValue={filtri.cp ? String(filtri.cp) : ''}>
                <option value="">Indifferente</option>
                {[7, 14, 30].map((g) => (
                  <option key={g} value={g}>
                    {giorni(g)}
                  </option>
                ))}
              </select>
            </label>
            <div className="contatti-eta">
              <label>
                <span>Età da</span>
                <input type="number" name="eta_da" min={0} max={120} defaultValue={filtri.etaDa ?? ''} />
              </label>
              <label>
                <span>a</span>
                <input type="number" name="eta_a" min={0} max={120} defaultValue={filtri.etaA ?? ''} />
              </label>
              <label>
                <span>Sesso</span>
                <select name="sx" defaultValue={filtri.sx ?? ''}>
                  <option value="">Tutti</option>
                  <option value="F">Donne</option>
                  <option value="M">Uomini</option>
                </select>
              </label>
            </div>
            <label className="check-riga">
              <input type="checkbox" name="rs" value="1" defaultChecked={!!filtri.rs} />
              <span>Con rate scadute non pagate</span>
            </label>
            <label className="check-riga">
              <input type="checkbox" name="em" value="1" defaultChecked={!!filtri.em} />
              <span>Solo con email</span>
            </label>
            <label className="check-riga">
              <input type="checkbox" name="ce" value="1" defaultChecked={!!filtri.ce} />
              <span>Solo con cellulare</span>
            </label>
          </fieldset>
        </div>

        <div className="contatti-form-azioni">
          <label>
            <span className="muted">Ordina per</span>
            <select name="ord" defaultValue={ordine}>
              {ORDINI.map((o) => (
                <option key={o} value={o}>
                  {ETICHETTE_ORDINE[o]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn">
            Applica i filtri
          </button>
          {haFiltri && (
            <Link href="/dashboard/persone/filtri" className="btn btn-ghost">
              Azzera
            </Link>
          )}
        </div>
      </form>

      {scriptMancante && (
        <div className="card card-avviso">
          <p className="card-nota">Manca lo script SQL dei filtri: esegui scripts/sql/2026-10-29-contatti-filtri.sql nel SQL Editor di Supabase.</p>
        </div>
      )}
      {errore && (
        <div className="card card-avviso">
          <p className="card-nota">{errore}</p>
        </div>
      )}

      {risultato && (
        <div className="card">
          <div className="card-head">
            <h2>{totale.toLocaleString('it-IT')} {totale === 1 ? 'contatto' : 'contatti'}</h2>
            <span className="muted">
              {haFiltri ? 'che soddisfano tutti i filtri' : 'in anagrafica: scegli dei filtri per restringere'}
              {pagine > 1 ? ` · pagina ${pagina} di ${pagine}` : ''}
            </span>
          </div>

          {attivi.length > 0 && (
            <div className="contatti-attivi">
              {attivi.map((a) => (
                <Link key={a.etichetta} href={hrefCon(Object.fromEntries(a.togli.map((k) => [k, undefined])))} className="chip is-attivo" title="Togli questo filtro">
                  {a.etichetta} <span aria-hidden="true">×</span>
                </Link>
              ))}
            </div>
          )}

          {risultato.righe.length === 0 ? (
            <p className="vuoto">Nessun contatto soddisfa tutti i filtri: prova a toglierne qualcuno.</p>
          ) : (
            <>
              <ElencoContatti
                key={`${base.toString()}|${pagina}`}
                righe={risultato.righe}
                totale={totale}
                parametri={base.toString()}
                oggi={oggi}
                nomiStaff={nomiStaff}
              />
              {pagine > 1 && (
                <div className="accessi-paginazione">
                  {pagina > 1 ? (
                    <Link className="btn btn-sm btn-ghost" href={hrefCon({ p: String(pagina - 1) })}>
                      ← Precedenti
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="muted">
                    {(pagina - 1) * PER_PAGINA + 1}–{(pagina - 1) * PER_PAGINA + risultato.righe.length} di {totale.toLocaleString('it-IT')}
                  </span>
                  {pagina < pagine ? (
                    <Link className="btn btn-sm btn-ghost" href={hrefCon({ p: String(pagina + 1) })}>
                      Successivi →
                    </Link>
                  ) : (
                    <span />
                  )}
                </div>
              )}
              <p className="muted report-nota">
                Email e cellulari sono dati personali: per comunicazioni commerciali servono il consenso e le regole sulla privacy del Club.
              </p>
            </>
          )}
        </div>
      )}
    </>
  )
}
