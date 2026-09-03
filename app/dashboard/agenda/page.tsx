import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { puoCancellare } from '@/lib/auth/permessi'
import {
  dataLunga,
  giornoPiu,
  mesePiu,
  oggiRoma,
  perGiorno,
  primoDelMese,
  ultimoDelMese,
  voceDaContatto,
  voceDaTask,
  type VoceAgenda,
} from '@/lib/agenda'
import { ATTIVITA_IN_AGENDA } from '@/lib/richieste'
import { CalendarioAgenda } from '@/components/CalendarioAgenda'
import { TabellaAgenda } from '@/components/TabellaAgenda'
import { VistaTabs } from '@/components/VistaTabs'
import { NuovaVoce } from './NuovaVoce'

export const dynamic = 'force-dynamic'

/**
 * Quanto guarda avanti e indietro la vista a lista. Indietro serve solo a
 * ripescare gli arretrati ancora da fare — il passato già chiuso non si
 * elenca, si consulta dal calendario andando al suo mese.
 */
const GIORNI_AVANTI = 90
const GIORNI_INDIETRO = 180

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: { vista?: string; da?: string; solo?: string }
}) {
  if (!(await utenteHaSezione('agenda'))) {
    redirect('/dashboard')
  }

  const oggi = oggiRoma()
  const daRichiesto = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.da ?? '') ? searchParams.da! : oggi
  const vista = searchParams.vista === 'lista' ? 'lista' : 'calendario'

  // Il calendario carica il mese che mostra; la lista una finestra intorno a
  // oggi. Le due viste chiedono al database solo quello che disegnano.
  const mese = primoDelMese(daRichiesto)
  const inizio = vista === 'calendario' ? mese : giornoPiu(oggi, -GIORNI_INDIETRO)
  const fine = vista === 'calendario' ? ultimoDelMese(mese) : giornoPiu(oggi, GIORNI_AVANTI)

  const soloAppuntamenti = searchParams.solo === 'appuntamenti'
  const soloMie = searchParams.solo === 'mie'
  const email = emailCorrente()

  const supabase = createSupabaseServiceClient()
  const [{ data: task }, { data: contatti }, { data: staff }, possoCancellare] = await Promise.all([
    supabase
      .from('task')
      .select('id, titolo, tipo, data, ora, durata_minuti, stato, note, assegnato_a, esito_tipo, esito')
      .gte('data', inizio)
      .lte('data', fine),
    supabase
      .from('form_contatti')
      .select(
        'id, azione, data_scelta, ora_scelta, nome, cognome, email, cellulare, attivita_label, messaggio, gestito, esito_tipo, esito'
      )
      .gte('data_scelta', inizio)
      .lte('data_scelta', fine)
      // Solo Club e Family: sono le richieste che passano dalla segreteria e
      // che hanno un appuntamento da tenere. Le altre vanno diritte al
      // responsabile del corso e vivono nella sua sezione (lib/richieste.ts),
      // non in questo calendario.
      .in('attivita', ATTIVITA_IN_AGENDA),
    supabase.from('staff_users').select('email').order('email'),
    puoCancellare(email),
  ])

  let voci: VoceAgenda[] = [
    ...(task ?? []).map(voceDaTask),
    ...(contatti ?? []).map(voceDaContatto).filter((v): v is VoceAgenda => v !== null),
  ]

  // Le voci annullate restano fuori dalla vista normale: sono lì per storia,
  // non per lavorarle.
  voci = voci.filter((v) => v.stato !== 'annullato')
  if (soloAppuntamenti) voci = voci.filter((v) => v.ora !== null)
  if (soloMie) voci = voci.filter((v) => v.assegnatoA === email || v.origine === 'form_contatti')

  const daFare = voci.filter((v) => v.daFare).length
  const appuntamenti = voci.filter((v) => v.ora !== null).length

  // Per il datalist del form: chi può essere assegnatario di una voce.
  const operatori = (staff ?? []).map((s) => s.email as string)

  // Nella lista il passato conta solo se è ancora aperto: gli arretrati vanno
  // recuperati, le cose già fatte no.
  const vociLista = voci.filter((v) => v.data >= oggi || v.daFare)
  const giorniLista = [...new Set(vociLista.map((v) => v.data))].sort()
  const perGiornata = perGiorno(vociLista)

  function link(parametri: { vista?: string; da?: string; solo?: string | null }) {
    const params = new URLSearchParams()
    params.set('vista', parametri.vista ?? vista)
    if (parametri.da) params.set('da', parametri.da)
    const filtro = parametri.solo === undefined ? searchParams.solo : parametri.solo
    if (filtro) params.set('solo', filtro)
    return `/dashboard/agenda?${params.toString()}`
  }

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Agenda</p>
        <h1>Agenda</h1>
        <p className="muted">
          Appuntamenti prenotati dal sito e cose da fare della segreteria, nello stesso calendario.
        </p>
      </div>

      <VistaTabs
        vista={vista}
        base="/dashboard/agenda"
        tabs={[
          { chiave: 'calendario', etichetta: 'Calendario' },
          { chiave: 'lista', etichetta: 'Lista', contatore: daFare },
        ]}
        altriParametri={{ da: vista === 'calendario' ? searchParams.da : undefined, solo: searchParams.solo }}
      />

      <div className="agenda-barra">
        <div className="agenda-nav">
          <Link className={`btn btn-sm ${searchParams.solo ? 'btn-ghost' : ''}`} href={link({ da: daRichiesto, solo: null })}>
            Tutto
          </Link>
          <Link
            className={`btn btn-sm ${soloAppuntamenti ? '' : 'btn-ghost'}`}
            href={link({ da: daRichiesto, solo: 'appuntamenti' })}
          >
            Solo con orario
          </Link>
          <Link
            className={`btn btn-sm ${soloMie ? '' : 'btn-ghost'}`}
            href={link({ da: daRichiesto, solo: 'mie' })}
          >
            Le mie
          </Link>
        </div>
      </div>

      <div className="griglia-stat">
        <div className="stat">
          <span className="stat-valore">{appuntamenti}</span>
          <span className="stat-label">
            {vista === 'calendario' ? 'Con orario, questo mese' : 'Con orario, in elenco'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-valore">{daFare}</span>
          <span className="stat-label">Ancora da fare</span>
        </div>
      </div>

      {vista === 'calendario' ? (
        <CalendarioAgenda
          voci={voci}
          mese={mese}
          oggi={oggi}
          emailCorrente={email}
          operatori={operatori}
          puoCancellare={possoCancellare}
          linkMesePrecedente={link({ da: mesePiu(mese, -1) })}
          linkMeseSuccessivo={link({ da: mesePiu(mese, 1) })}
          linkOggi={link({ da: oggi })}
          nuovaVoce={<NuovaVoce giornoPredefinito={oggi} operatori={operatori} />}
        />
      ) : (
        <>
          {giorniLista.map((giorno) => {
            const delGiorno = perGiornata.get(giorno) ?? []
            return (
              <div className={`card agenda-giorno${giorno === oggi ? ' is-oggi' : ''}`} key={giorno}>
                <div className="card-head">
                  <h2 className="agenda-giorno-titolo">
                    {dataLunga(giorno)}
                    {giorno === oggi && <span className="badge" style={{ marginLeft: '0.5rem' }}>oggi</span>}
                    {giorno < oggi && (
                      <span className="badge badge-warn" style={{ marginLeft: '0.5rem' }}>
                        arretrato
                      </span>
                    )}
                  </h2>
                  <span className="muted">
                    {delGiorno.length} {delGiorno.length === 1 ? 'voce' : 'voci'}
                  </span>
                </div>
                <TabellaAgenda
                  voci={delGiorno}
                  emailCorrente={email}
                  operatori={operatori}
                  puoCancellare={possoCancellare}
                />
              </div>
            )
          })}

          {vociLista.length === 0 && <p className="vuoto">Niente in agenda con questi filtri.</p>}

          <div className="agenda-nuova">
            <NuovaVoce giornoPredefinito={oggi} operatori={operatori} />
          </div>
        </>
      )}
    </>
  )
}
