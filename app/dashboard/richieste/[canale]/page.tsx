import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { eCommerciale, puoCancellare, puoRiassegnare } from '@/lib/auth/permessi'
import { canaleDaChiave } from '@/lib/richieste'
import { ETICHETTE_STATO, STATI, eStatoValido, type StatoTrattativa } from '@/lib/pipeline'
import { RigaRichiesta, type ContestoTrattativa, type Richiesta } from '../RigaRichiesta'
import type { DatiTrattativa } from '../Trattativa'

export const dynamic = 'force-dynamic'

// Una pagina sola per tutti i canali (vedi lib/richieste.ts): sette copie
// quasi identiche divergerebbero al primo ritocco, e aggiungere un corso
// diventerebbe un file in più invece di una riga di dati.
export default async function CanalePage({
  params,
  searchParams,
}: {
  params: { canale: string }
  searchParams: { mostra?: string; stato?: string }
}) {
  const canale = canaleDaChiave(params.canale)
  if (!canale) notFound()

  // Il permesso è la chiave del canale: chi ha solo il padel non apre il
  // tennis nemmeno scrivendo l'indirizzo a mano.
  const sezioni = await getSezioniConsentite(emailCorrente())
  if (!sezioni.includes(canale.chiave)) redirect('/dashboard')

  // Lo stato arriva dai riquadri del riepilogo. Si accetta solo un valore
  // della pipeline: un parametro inventato non deve svuotare l'elenco senza
  // spiegazione, deve semplicemente non filtrare.
  const statoRichiesto = eStatoValido(searchParams.stato) ? searchParams.stato : null

  // Filtrando per stato si guarda tutta la storia, non solo il da lavorare:
  // «vinte» e «perse» sono per definizione richieste già chiuse, e col filtro
  // di default l'elenco sarebbe sempre vuoto — un link che promette un numero
  // e porta a una pagina vuota è peggio di nessun link.
  const soloDaLavorare = !statoRichiesto && searchParams.mostra !== 'tutte'

  const supabase = createSupabaseServiceClient()
  let query = supabase
    .from('form_contatti')
    .select(
      'id, created_at, nome, cognome, email, cellulare, attivita_label, settore, azione, data_scelta, ora_scelta, messaggio, dettagli, minore_nome, minore_cognome, minore_data_nascita, marketing, gestito, gestito_da, gestito_il, note, utm_source, utm_campaign, opportunita_id, esito_tipo, esito, persona_id'
    )
    .order('created_at', { ascending: false })
    .limit(200)

  // I form inline di pagina (Chinesis) non fanno scegliere un'attività: il
  // loro canale si aggancia all'origine del payload.
  query = canale.origine
    ? query.in('origine', canale.origine)
    : query.in('attivita', canale.attivita)

  // Il tennis è l'unica attività con due responsabili: il settore scelto nel
  // form decide di chi è la richiesta.
  if (canale.settore) query = query.eq('settore', canale.settore)
  if (soloDaLavorare) query = query.eq('gestito', false)

  // Il totale da lavorare non dipende dal filtro in pagina: serve a sapere
  // quanto resta anche mentre si guarda lo storico completo.
  let queryDaLavorare = supabase
    .from('form_contatti')
    .select('*', { count: 'exact', head: true })
    .eq('gestito', false)
  queryDaLavorare = canale.origine
    ? queryDaLavorare.in('origine', canale.origine)
    : queryDaLavorare.in('attivita', canale.attivita)
  if (canale.settore) queryDaLavorare = queryDaLavorare.eq('settore', canale.settore)

  // ── Prima ondata: tutto ciò che non dipende da nient'altro ────────────
  //
  // Ogni lettura è una richiesta HTTP a Supabase, e il database risponde in
  // frazioni di millisecondo: quello che si paga è il viaggio, non il lavoro.
  // Aspettarle una per volta sommava cinque andate e ritorni prima di
  // disegnare la pagina; qui partono insieme e si paga il più lento.
  const [
    { data, error },
    { count: daLavorare },
    { data: tuttoLoStaff },
    possoCancellare,
    sonoCommerciale,
    possoRiassegnare,
    { data: staffCommerciale },
  ] = await Promise.all([
    query,
    queryDaLavorare,
    supabase.from('staff_users').select('email').order('email'),
    puoCancellare(emailCorrente()),
    eCommerciale(emailCorrente()),
    puoRiassegnare(emailCorrente()),
    // Serve solo dove esistono le trattative, ma chiederlo qui costa nulla:
    // viaggia in parallelo con le altre invece di aggiungere un'ondata.
    canale.inAgenda
      ? supabase.from('staff_users').select('email').eq('commerciale', true).order('email')
      : Promise.resolve({ data: [] as { email: string }[] }),
  ])

  if (error) {
    console.error('Richieste non lette:', error.message)
  }

  const richieste = (data ?? []) as unknown as Richiesta[]
  const operatori = (tuttoLoStaff ?? []).map((x) => x.email as string)

  // Chi ha già scritto prima. Il database riconosce la persona e riusa la
  // trattativa aperta (trova_o_crea_opportunita), ma non lascia alcun segno:
  // stato e assegnatario non cambiano, quindi la seconda richiesta arriva in
  // elenco identica a un contatto nuovo. Questa lettura è ciò che permette di
  // dirlo in riga, senza aprire nulla.
  //
  // Si contano le richieste di tutti i canali, non solo di questo: chi ha
  // chiesto del nuoto e poi dell'abbonamento è comunque una persona che
  // conosciamo già, ed è l'informazione che cambia la telefonata.
  const personaIds = [...new Set(richieste.map((x) => x.persona_id).filter(Boolean))] as string[]
  const trattativaIds = [...new Set(richieste.map((x) => x.opportunita_id).filter(Boolean))] as string[]

  // ── Seconda ondata: solo ciò che ha bisogno degli id appena letti ──────
  const [{ data: righeStessePersone }, { data: trattative }] = await Promise.all([
    personaIds.length
      ? supabase
          .from('form_contatti')
          .select('id, persona_id, created_at')
          .in('persona_id', personaIds)
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] as { id: string; persona_id: string; created_at: string }[] }),
    canale.inAgenda && trattativaIds.length
      ? supabase.from('opportunita').select('id, stato, assegnato_a, motivo_perso').in('id', trattativaIds)
      : Promise.resolve({ data: [] as any[] }),
  ])

  // Per ogni richiesta: che numero è nella storia di quella persona, quante
  // sono in tutto, e quando è arrivata quella prima di lei.
  const storicoPersona = new Map<string, { ordinale: number; totale: number; precedenteIl: string | null }>()
  const perPersona = new Map<string, { id: string; created_at: string }[]>()
  for (const riga of righeStessePersone ?? []) {
    const chiave = riga.persona_id as string
    if (!perPersona.has(chiave)) perPersona.set(chiave, [])
    perPersona.get(chiave)!.push({ id: riga.id as string, created_at: riga.created_at as string })
  }
  for (const elenco of perPersona.values()) {
    elenco.forEach((riga, indice) => {
      storicoPersona.set(riga.id, {
        ordinale: indice + 1,
        totale: elenco.length,
        precedenteIl: indice > 0 ? elenco[indice - 1].created_at : null,
      })
    })
  }

  // Le trattative servono solo dove esiste un team che se le prende in
  // carico: negli altri canali il responsabile è unico e il canale è già
  // l'assegnazione, quindi non si costruisce nulla.
  let contesto: ContestoTrattativa | undefined
  if (canale.inAgenda) {
    contesto = {
      io: emailCorrente(),
      sonoCommerciale,
      possoRiassegnare,
      commerciali: (staffCommerciale ?? []).map((x) => x.email as string),
      trattative: Object.fromEntries(
        (trattative ?? []).map((t) => [
          t.id as string,
          {
            id: t.id as string,
            stato: t.stato as StatoTrattativa,
            assegnato_a: t.assegnato_a as string | null,
            motivo_perso: t.motivo_perso as string | null,
          } satisfies DatiTrattativa,
        ])
      ),
    }
  }

  // Il filtro per stato si applica qui e non in SQL: lo stato sta su
  // `opportunita`, non su form_contatti, e le trattative si conoscono solo
  // dopo averle caricate qui sopra.
  const richiesteMostrate =
    statoRichiesto && contesto
      ? richieste.filter((x) => {
          const idTrattativa = x.opportunita_id
          if (!idTrattativa) {
            // Senza trattativa la richiesta è lavoro che nessuno ha ancora
            // preso: vale come "da prendere in carico", così non scompare dai
            // conti di chi apre quel riquadro.
            return statoRichiesto === 'nuovo'
          }
          return contesto!.trattative[idTrattativa]?.stato === statoRichiesto
        })
      : richieste

  const r = canale.responsabile

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Richieste dal sito · {canale.gruppo}</p>
        <h1>{canale.label}</h1>
        <p className="muted">{canale.descrizione}</p>
      </div>

      {/* La sezione è dell'attività, non della persona: il referente è
          un'informazione di servizio in coda, non l'intestazione — la sezione
          resta la stessa anche quando cambia chi la segue. */}
      <div className="card">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
            Referente: <strong>{r.nome}</strong> · {r.ruolo}
            {r.telefono && ` · ${r.telefono}`}
            {r.email && ` · ${r.email}`}
          </p>
          <span className={`badge ${daLavorare ? 'badge-warn' : 'badge-ok'}`}>
            {daLavorare ? `${daLavorare} da lavorare` : 'tutto lavorato'}
          </span>
        </div>
      </div>

      <div className="agenda-barra">
        <div className="agenda-nav">
          <Link
            className={`btn btn-sm ${soloDaLavorare ? '' : 'btn-ghost'}`}
            href={`/dashboard/richieste/${canale.chiave}`}
          >
            Da lavorare
          </Link>
          <Link
            className={`btn btn-sm ${!soloDaLavorare && !statoRichiesto ? '' : 'btn-ghost'}`}
            href={`/dashboard/richieste/${canale.chiave}?mostra=tutte`}
          >
            Tutte
          </Link>
        </div>

        {/* Gli stessi quattro stati dei riquadri del riepilogo: arrivando da
            un riquadro si vede quale filtro è attivo e si può cambiarlo senza
            tornare indietro. Solo dove esistono le trattative. */}
        {canale.inAgenda && (
          <div className="agenda-nav">
            {STATI.map((stato) => (
              <Link
                key={stato}
                className={`btn btn-sm ${statoRichiesto === stato ? '' : 'btn-ghost'}`}
                href={
                  statoRichiesto === stato
                    ? `/dashboard/richieste/${canale.chiave}`
                    : `/dashboard/richieste/${canale.chiave}?stato=${stato}`
                }
              >
                {ETICHETTE_STATO[stato]}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        {richiesteMostrate.length === 0 ? (
          <p className="vuoto">
            {statoRichiesto
              ? `Nessuna richiesta con trattativa «${ETICHETTE_STATO[statoRichiesto]}». `
              : soloDaLavorare
                ? 'Nessuna richiesta da lavorare. '
                : 'Nessuna richiesta per questa sezione. '}
            {(soloDaLavorare || statoRichiesto) && (
              <Link href={`/dashboard/richieste/${canale.chiave}?mostra=tutte`}>
                Guarda tutte le richieste
              </Link>
            )}
          </p>
        ) : (
          <ul className="richieste">
            {richiesteMostrate.map((riga) => (
              <RigaRichiesta
                r={riga}
                contesto={contesto}
                operatori={operatori}
                puoCancellare={possoCancellare}
                storico={storicoPersona.get(riga.id)}
                key={riga.id}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
