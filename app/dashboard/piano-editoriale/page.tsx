import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { mappaNomiStaff } from '@/lib/staff'
import { ruoloPiano } from '@/lib/piano-editoriale-server'
import {
  COLONNE_VOCE,
  ETICHETTE_TIPO,
  ORARI_GIADA,
  ORE_SETTIMANALI,
  PREAVVISO_GIORNI,
  aggiungiGiorni,
  dataBreve,
  etichettaMese,
  meseValido,
  meseVicino,
  occupaTempo,
  oggiRoma,
  primaDataConPreavviso,
  settimaneDelMese,
  type AllegatoVoce,
  type VocePiano,
} from '@/lib/piano-editoriale'
import { NuovaRichiesta } from './NuovaRichiesta'
import { SchedaVoce } from './SchedaVoce'

export const dynamic = 'force-dynamic'

// Il piano editoriale: il calendario dei contenuti social richiesti a Giada
// (social media manager, 10 ore a settimana). Ogni responsabile scrive cosa
// vorrebbe pubblicato, con 14 giorni di preavviso; Giada risponde dalla
// stessa pagina. Il calendario è di tutti: si vede cosa c'è già e quanto è
// piena ogni settimana. Schema in scripts/sql/2026-11-10-piano-editoriale.sql.

const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
const FILTRI = [
  { chiave: 'tutte', testo: 'Tutte' },
  { chiave: 'mie', testo: 'Le mie' },
  { chiave: 'da_decidere', testo: 'Da decidere' },
] as const
type Filtro = (typeof FILTRI)[number]['chiave']

export default async function PianoEditorialePage({ searchParams }: { searchParams: { mese?: string; f?: string } }) {
  const ruolo = await ruoloPiano()
  if (!ruolo) redirect('/dashboard')

  const oggi = oggiRoma()
  const mese = meseValido(searchParams.mese) ? searchParams.mese : oggi.slice(0, 7)
  const filtro: Filtro = FILTRI.some((f) => f.chiave === searchParams.f) ? (searchParams.f as Filtro) : 'tutte'
  const settimane = settimaneDelMese(mese)
  const dal = settimane[0][0]
  const al = settimane[settimane.length - 1][6]

  const supabase = createSupabaseServiceClient()
  const [{ data: righe, error }, { data: staff }, { data: daDecidere }] = await Promise.all([
    supabase
      .from('piano_editoriale_voci')
      .select(COLONNE_VOCE)
      .gte('data_pubblicazione', dal)
      .lte('data_pubblicazione', al)
      .order('data_pubblicazione')
      .order('creato_il'),
    supabase.from('staff_users').select('email, nome, cognome'),
    // Le richieste ancora senza risposta, di qualunque mese: chi gestisce non
    // deve dimenticarne una perché è finita in un mese che non sta guardando.
    supabase
      .from('piano_editoriale_voci')
      .select(COLONNE_VOCE)
      .eq('stato', 'richiesta')
      .order('urgente', { ascending: false })
      .order('data_pubblicazione'),
  ])
  const nomi = mappaNomiStaff(staff ?? [])
  const nome = (email: string) => nomi[email] ?? email

  const voci = (righe ?? []) as VocePiano[]
  const inAttesa = (daDecidere ?? []) as VocePiano[]
  const perGiorno = new Map<string, VocePiano[]>()
  for (const v of voci) perGiorno.set(v.data_pubblicazione, [...(perGiorno.get(v.data_pubblicazione) ?? []), v])

  // Il lavoro di Giada per settimana (ore stimate delle voci che occupano
  // tempo, contate nella settimana della data di pubblicazione).
  const oreSettimana = (inizio: string) =>
    voci
      .filter((v) => occupaTempo(v.stato) && v.data_pubblicazione >= inizio && v.data_pubblicazione <= aggiungiGiorni(inizio, 6))
      .reduce((somma, v) => somma + Number(v.ore_stimate), 0)

  // L'elenco sotto il calendario.
  let elenco = filtro === 'da_decidere' ? inAttesa : voci
  if (filtro === 'mie') elenco = voci.filter((v) => v.richiesto_da === ruolo.email)

  const idElenco = elenco.map((v) => v.id)
  const { data: righeFile } = idElenco.length
    ? await supabase.from('piano_editoriale_allegati').select('id, voce_id, nome, tipo, byte').in('voce_id', idElenco)
    : { data: [] }
  const fileDi = new Map<string, AllegatoVoce[]>()
  for (const a of (righeFile ?? []) as AllegatoVoce[]) fileDi.set(a.voce_id, [...(fileDi.get(a.voce_id) ?? []), a])

  const reparti = Array.from(new Set([...voci, ...inAttesa].map((v) => v.reparto).filter((r): r is string => !!r))).sort(
    (a, b) => a.localeCompare(b, 'it')
  )
  const dataIniziale = primaDataConPreavviso(oggi)
  const href = (m: string, f: Filtro = filtro) => `/dashboard/piano-editoriale?mese=${m}${f === 'tutte' ? '' : `&f=${f}`}`

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Comunicazione</p>
        <h1>Piano editoriale</h1>
        <p className="muted">
          I post e i video che vuoi far pubblicare, per Giada (social media manager). Serve un preavviso di almeno{' '}
          {PREAVVISO_GIORNI} giorni: con meno la richiesta è «urgente» e decide lei se è fattibile.
        </p>
      </div>

      <NuovaRichiesta oggi={oggi} dataIniziale={dataIniziale} gestisce={ruolo.gestisce} reparti={reparti} />

      <section className="card pe-orari">
        <h2 className="pe-orari-titolo">Quando lavora Giada ({ORE_SETTIMANALI} ore a settimana)</h2>
        <ul className="pe-orari-elenco">
          {ORARI_GIADA.map((o) => (
            <li key={o.giorno}>
              <b>{o.nome}</b> {o.dalle}–{o.alle}
            </li>
          ))}
        </ul>
      </section>

      {ruolo.gestisce && inAttesa.length > 0 && filtro !== 'da_decidere' && (
        <p className="banner">
          {inAttesa.length === 1 ? 'C’è 1 richiesta' : `Ci sono ${inAttesa.length} richieste`} senza risposta
          {inAttesa.some((v) => v.urgente) ? `, di cui ${inAttesa.filter((v) => v.urgente).length} urgenti` : ''}.{' '}
          <Link href={href(mese, 'da_decidere')}>Vedile</Link>
        </p>
      )}

      <div className="agenda-nav pe-nav">
        <Link href={href(meseVicino(mese, -1))} className="btn btn-ghost btn-sm" aria-label="Mese precedente">
          ←
        </Link>
        <strong className="pe-mese">{etichettaMese(mese)}</strong>
        <Link href={href(meseVicino(mese, 1))} className="btn btn-ghost btn-sm" aria-label="Mese successivo">
          →
        </Link>
        {mese !== oggi.slice(0, 7) && (
          <Link href={href(oggi.slice(0, 7))} className="btn btn-ghost btn-sm">
            Oggi
          </Link>
        )}
      </div>

      {error && <p className="error-banner">Non riesco a leggere il calendario adesso. Riprova fra poco.</p>}

      <div className="pe-calendario" role="grid" aria-label={`Calendario ${etichettaMese(mese)}`}>
        <div className="pe-intestazione" role="row">
          {GIORNI.map((g) => (
            <span key={g} role="columnheader">
              {g}
            </span>
          ))}
          <span role="columnheader" className="pe-col-carico">
            Carico
          </span>
        </div>
        {settimane.map((sett) => {
          const ore = oreSettimana(sett[0])
          return (
            <div className="pe-settimana" role="row" key={sett[0]}>
              {sett.map((g) => {
                const delle = perGiorno.get(g) ?? []
                const fuori = !g.startsWith(mese)
                return (
                  <div
                    key={g}
                    role="gridcell"
                    className={`pe-giorno${fuori ? ' pe-fuori' : ''}${g === oggi ? ' pe-oggi' : ''}${
                      g < oggi ? ' pe-passato' : ''
                    }`}
                  >
                    <span className="pe-num">{Number(g.slice(8))}</span>
                    {delle.map((v) => (
                      <a
                        key={v.id}
                        href={`#voce-${v.id}`}
                        className={`pe-chip pe-stato-${v.stato}${v.urgente ? ' pe-chip-urgente' : ''}`}
                        title={`${ETICHETTE_TIPO[v.tipo]} · ${v.titolo}`}
                      >
                        <span className="pe-chip-tipo">{ETICHETTE_TIPO[v.tipo].split(' ')[0]}</span> {v.titolo}
                      </a>
                    ))}
                  </div>
                )
              })}
              <div className={`pe-carico${ore > ORE_SETTIMANALI ? ' pe-carico-pieno' : ''}`}>
                <b>{ore}</b> / {ORE_SETTIMANALI} h
                {ore > ORE_SETTIMANALI && <span className="pe-carico-nota">Settimana piena</span>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="agenda-nav pe-filtri">
        {FILTRI.map((f) => (
          <Link key={f.chiave} href={href(mese, f.chiave)} className={`btn btn-sm ${f.chiave === filtro ? '' : 'btn-ghost'}`}>
            {f.testo}
            {f.chiave === 'da_decidere' && inAttesa.length > 0 ? ` (${inAttesa.length})` : ''}
          </Link>
        ))}
      </div>

      {elenco.length === 0 ? (
        <div className="card">
          <p className="vuoto">
            {filtro === 'da_decidere'
              ? 'Nessuna richiesta in attesa di risposta.'
              : filtro === 'mie'
                ? `Non hai richieste in ${etichettaMese(mese)}.`
                : `Nessuna richiesta in ${etichettaMese(mese)}.`}
          </p>
        </div>
      ) : (
        <div className="pe-elenco">
          {elenco.map((v) => (
            <SchedaVoce
              key={v.id}
              voce={v}
              allegati={fileDi.get(v.id) ?? []}
              richiedente={nome(v.richiesto_da)}
              gestisce={ruolo.gestisce}
              propria={v.richiesto_da === ruolo.email}
            />
          ))}
        </div>
      )}
      <p className="muted pe-piede">Oggi è {dataBreve(oggi)}.</p>
    </>
  )
}
