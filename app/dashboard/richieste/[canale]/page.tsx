import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import {
  COLONNE_ASSEGNAZIONE_RICHIESTA,
  COLONNE_NOTA_VINTA,
  conColonneNuove,
} from '@/lib/migrazioni'
import { emailCorrente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { eCommerciale, puoCancellare, puoRiassegnare } from '@/lib/auth/permessi'
import { COLONNE_RICHIESTA, canaleDaChiave, eGestioneSemplice } from '@/lib/richieste'
import type { StatoTrattativa } from '@/lib/pipeline'
import { voceDaTask } from '@/lib/agenda'
import { mappaNomiStaff, ordinaPerCognome, type RigaStaff } from '@/lib/staff'
import { GuidaModello } from '@/components/GuidaModello'
import { ElencoRichieste } from '../ElencoRichieste'
import { type ContestoTrattativa, type Richiesta } from '../RigaRichiesta'
import type { EventoCollegato } from '../EventiTrattativa'
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
  searchParams: { mostra?: string; richiesta?: string }
}) {
  const canale = canaleDaChiave(params.canale)
  if (!canale) notFound()

  // Il permesso è la chiave del canale: chi ha solo il padel non apre il
  // tennis nemmeno scrivendo l'indirizzo a mano.
  const sezioni = await getSezioniConsentite(emailCorrente())
  if (!sezioni.includes(canale.chiave)) redirect('/dashboard')

  // Come si lavora questo canale (vedi eGestioneSemplice in lib/richieste.ts).
  // Cambia il pannello di ogni riga — interruttore e nota invece di esito,
  // motivo e programmatore di eventi — e con esso le parole della pagina:
  // dove non si chiude niente con un esito, «da lavorare» prometteva una
  // lavorazione che non esiste.
  const semplice = eGestioneSemplice(canale)

  // Questa pagina è la casella delle **richieste**: da lavorare, o tutte. Lo
  // stato delle trattative (in gestione, vinte, perse, mancati rinnovi) e «le
  // mie» si guardano in un posto solo, la Dashboard: qui c'erano gli stessi
  // filtri, ma contavano le richieste e non le trattative, e la stessa domanda
  // dava due numeri diversi (48 in Dashboard, 20 qui, per le stesse in
  // gestione). I vecchi indirizzi con `stato` e `mie` si aprono lo stesso: i
  // parametri sono ignorati.
  const soloDaLavorare = searchParams.mostra !== 'tutte'

  const supabase = createSupabaseServiceClient()

  /**
   * L'elenco del canale, costruito da una funzione invece che pezzo per
   * pezzo su una variabile.
   *
   * Serve perché la lettura si può dover **ripetere** senza le colonne che
   * una migration non ancora eseguita non ha (vedi conColonneNuove): una
   * query costruita a incrementi su un `let` non si può ricostruire, e
   * riusare quella già eseguita non rifà la richiesta.
   */
  // Il canale con il tipo già ristretto: TypeScript non porta dentro una
  // funzione l'esclusione del null fatta dal `notFound()` qui sopra, e senza
  // questo alias ogni `canale.qualcosa` nella funzione sarebbe un errore.
  const suo = canale

  function elencoDelCanale(colonne: string) {
    let q = supabase
      .from('form_contatti')
      .select(colonne)
      .order('created_at', { ascending: false })
      .limit(200)

    // I form inline di pagina (Chinesis) non fanno scegliere un'attività: il
    // loro canale si aggancia all'origine del payload.
    q = suo.origine ? q.in('origine', suo.origine) : q.in('attivita', suo.attivita)

    // Il tennis è l'unica attività con due responsabili: il settore scelto
    // nel form decide di chi è la richiesta.
    if (suo.settore) q = q.eq('settore', suo.settore)
    if (soloDaLavorare) q = q.eq('gestito', false)
    return q
  }

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

  // Le righe che alimentano i numeri sui chip «Da lavorare» e «Tutte». Una
  // colonna sola e nessun ordinamento: un filtro che non dice quante cose
  // troverà si prova a caso, e provarlo a caso su un elenco di duecento righe
  // vuol dire caricare la pagina due volte per scoprire che era vuota.
  //
  // Sono più delle duecento righe mostrate, di proposito: i chip devono dire
  // quante ce ne sono, non quante ne sta guardando questa pagina. Il
  // .limit(2000) non basta da solo a difendere da questo: PostgREST tronca
  // comunque ogni singola risposta a 1000 righe, quindi serve paginare con
  // .range().
  async function conteggiDelCanale(): Promise<{ gestito: boolean }[]> {
    const righe: { gestito: boolean }[] = []
    for (let da = 0; da < 2000; da += 1000) {
      let q = supabase.from('form_contatti').select('gestito').range(da, da + 999)
      q = suo.origine ? q.in('origine', suo.origine) : q.in('attivita', suo.attivita)
      if (suo.settore) q = q.eq('settore', suo.settore)
      const { data } = await q
      righe.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
    return righe
  }

  /**
   * Tutte le trattative del canale, paginando con `.range()`: PostgREST
   * tronca comunque ogni risposta a 1000 righe, e leggere «la tabella
   * intera» (vedi il commento più sotto) senza paginare vuol dire troncarla
   * silenziosamente appena Club/Family superano quella soglia.
   */
  async function tutteLeOpportunitaDelCanale(): Promise<{ data: Record<string, any>[]; error: { message: string } | null }> {
    if (!suo.inAgenda) return { data: [], error: null }
    const colonneComplete =
      'id, stato, assegnato_a, chiuso_il, motivo_perso, motivo_annullato, motivo_vinto, valore_euro, triple_pack'
    const tutte: Record<string, any>[] = []
    let ultimoErrore: { message: string } | null = null
    for (let da = 0; ; da += 1000) {
      const risposta = await conColonneNuove<Record<string, any>>(colonneComplete, COLONNE_NOTA_VINTA, (colonne) =>
        supabase.from('opportunita').select(colonne).range(da, da + 999)
      )
      ultimoErrore = risposta.error
      const pagina = risposta.data ?? []
      tutte.push(...pagina)
      if (pagina.length < 1000) break
    }
    return { data: tutte, error: ultimoErrore }
  }

  // ── Prima ondata: tutto ciò che non dipende da nient'altro ────────────
  //
  // Ogni lettura è una richiesta HTTP a Supabase, e il database risponde in
  // frazioni di millisecondo: quello che si paga è il viaggio, non il lavoro.
  // Aspettarle una per volta sommava cinque andate e ritorni prima di
  // disegnare la pagina; qui partono insieme e si paga il più lento.
  const [
    { data, error },
    { count: daLavorare },
    righeDaContare,
    { data: statiTrattative },
    { data: tuttoLoStaff },
    possoCancellare,
    sonoCommerciale,
    possoRiassegnare,
    { data: staffCommerciale },
  ] = await Promise.all([
    conColonneNuove<Record<string, any>>(
      COLONNE_RICHIESTA,
      COLONNE_ASSEGNAZIONE_RICHIESTA,
      elencoDelCanale
    ),
    queryDaLavorare,
    conteggiDelCanale(),
    // Tutte le trattative del canale, in una lettura (paginata, vedi
    // tutteLeOpportunitaDelCanale). Le trattative esistono solo per Club e
    // Family (le crea trova_o_crea_opportunita dal trigger su form_contatti),
    // quindi leggere la tabella intera è leggere esattamente la pipeline di
    // questo canale.
    //
    // Serve due volte: per i numeri sui chip dei filtri e per il blocco
    // trattativa di ogni riga. Prima quest'ultimo era una lettura a parte
    // nella seconda ondata, filtrata sugli id delle righe mostrate: due
    // letture della stessa tabella, e un'ondata in più prima di disegnare.
    tutteLeOpportunitaDelCanale(),
    // Nome e cognome oltre all'email: le lavorazioni si firmano con l'email,
    // ma a schermo si legge il nome (vedi lib/staff.ts).
    supabase.from('staff_users').select('email, nome, cognome'),
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
  // Ordinati per cognome, come Gestione utenti: una tendina di colleghi
  // ordinata per email li mette in un ordine che nessuno ha in testa.
  const staffOrdinato = ordinaPerCognome((tuttoLoStaff ?? []) as RigaStaff[])
  const operatori = staffOrdinato.map((x) => x.email)
  const nomiStaff = mappaNomiStaff(staffOrdinato)

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

  // ── Seconda ondata: solo ciò che ha bisogno degli id appena letti ──────
  const { data: righeStessePersone } = personaIds.length
    ? await supabase
        .from('form_contatti')
        .select('id, persona_id, created_at')
        .in('persona_id', personaIds)
        .order('created_at', { ascending: true })
    : { data: [] as { id: string; persona_id: string; created_at: string }[] }

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

  // ── Terza ondata: gli eventi nati dalle richieste di queste persone ────
  //
  // Gli eventi di agenda si collegano alla richiesta da cui nascono
  // (task.entita = 'form_contatti', entita_id = id della richiesta), ma la
  // trattativa è della persona: si leggono quindi gli eventi di TUTTE le sue
  // richieste, non solo di quella in riga. Chi ha scritto tre volte ha una
  // trattativa sola, e il suo seguito è uno — spezzarlo fra tre righe
  // significherebbe non trovare mai il richiamo fissato la volta prima.
  //
  // Serve solo dove esistono le trattative: negli altri canali il
  // responsabile chiama e chiude, non c'è un seguito da programmare.
  // Due agganci, non uno: un evento nasce da una richiesta (chiudendola con
  // esito, o dal pannello Eventi) e allora porta il suo id; oppure è creato a
  // mano dall'agenda per un contatto, e allora porta l'id della persona.
  // Cercarne uno solo lasciava fuori metà del seguito — e proprio la metà
  // fissata a mano, che è quella che si ricorda meno.
  const idRichiesteDellePersone = (righeStessePersone ?? []).map((riga) => riga.id as string)
  const COLONNE_EVENTO =
    'id, titolo, tipo, data, ora, durata_minuti, note, assegnato_a, stato, esito_tipo, esito, esito_da, esito_il, entita, entita_id'

  const [{ data: eventiDaRichieste }, { data: eventiDaContatti }] =
    canale.inAgenda && idRichiesteDellePersone.length
      ? await Promise.all([
          supabase
            .from('task')
            .select(COLONNE_EVENTO)
            .eq('entita', 'form_contatti')
            .in('entita_id', idRichiesteDellePersone),
          supabase.from('task').select(COLONNE_EVENTO).eq('entita', 'persona').in('entita_id', personaIds),
        ])
      : [{ data: [] as Record<string, any>[] }, { data: [] as Record<string, any>[] }]

  // Dalla richiesta d'origine dell'evento alla persona, e da lì a tutti gli
  // eventi di quella persona: è la mappa con cui ogni riga riceve il seguito
  // dell'intera trattativa.
  const personaDiRichiesta = new Map<string, string>()
  for (const riga of righeStessePersone ?? []) {
    personaDiRichiesta.set(riga.id as string, riga.persona_id as string)
  }

  const eventiPerPersona = new Map<string, EventoCollegato[]>()
  function aggiungi(persona: string | undefined, riga: Record<string, any>, richiestaId: string | null) {
    if (!persona) return
    const elenco = eventiPerPersona.get(persona) ?? []
    elenco.push({ ...voceDaTask(riga), richiestaId })
    eventiPerPersona.set(persona, elenco)
  }

  for (const riga of eventiDaRichieste ?? []) {
    const richiestaId = (riga.entita_id as string) ?? null
    aggiungi(richiestaId ? personaDiRichiesta.get(richiestaId) : undefined, riga, richiestaId)
  }
  for (const riga of eventiDaContatti ?? []) {
    // Agganciato al contatto e non a una richiesta: nessuna riga da cui
    // dirlo «nato altrove».
    aggiungi(riga.entita_id as string, riga, null)
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
        (statiTrattative ?? []).map((t) => [
          t.id as string,
          {
            id: t.id as string,
            stato: t.stato as StatoTrattativa,
            assegnato_a: t.assegnato_a as string | null,
            chiuso_il: (t.chiuso_il as string) ?? null,
            motivo_perso: t.motivo_perso as string | null,
            motivo_annullato: t.motivo_annullato as string | null,
            motivo_vinto: (t.motivo_vinto as string) ?? null,
            valore_euro: t.valore_euro != null ? Number(t.valore_euro) : null,
            triple_pack: !!t.triple_pack,
          } satisfies DatiTrattativa,
        ])
      ),
    }
  }

  // I numeri sui chip: quante richieste ci sono da lavorare e quante in tutto.
  // Si contano sulle righe leggere di conteggiDelCanale, non su quelle
  // mostrate: le duecento in pagina sono una finestra.
  const conti = {
    daLavorare: (righeDaContare ?? []).filter((riga) => !riga.gestito).length,
    tutte: (righeDaContare ?? []).length,
  }

  // Catturata fuori dalla funzione: dentro una chiusura TypeScript non tiene
  // il restringimento fatto da notFound() qui sopra, e `canale` torna a essere
  // possibilmente undefined.
  const chiaveCanale = canale.chiave

  /** Un link che cambia il filtro. */
  function link(cambi: { mostra?: string | null }) {
    const params = new URLSearchParams()
    const mostra = cambi.mostra === undefined ? searchParams.mostra : cambi.mostra
    if (mostra) params.set('mostra', mostra)
    const qs = params.toString()
    return `/dashboard/richieste/${chiaveCanale}${qs ? `?${qs}` : ''}`
  }

  const r = canale.responsabile

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Richieste dal sito · {canale.gruppo}</p>
        <h1>{canale.label}</h1>
        <p className="muted">{canale.descrizione}</p>
      </div>

      {/* Quante richieste aspettano è la cosa più importante della pagina, e
          stava in un badge da dieci pixel in fondo a destra; il referente, che
          non cambia mai, occupava tutta la riga. Ribaltato: il numero è il
          titolo, il referente è la nota di servizio.

          La sezione resta dell'attività, non della persona: la sezione è la
          stessa anche quando cambia chi la segue. */}
      <div className={`canale-testa ${daLavorare ? 'is-arretrato' : 'is-pulita'}`}>
        <div className="canale-lavoro">
          <span className="canale-numero">{daLavorare ?? 0}</span>
          <span className="canale-frase">
            {daLavorare
              ? `${daLavorare === 1 ? 'richiesta' : 'richieste'} da ${semplice ? 'gestire' : 'lavorare'}`
              : semplice
                ? 'richieste da gestire: tutto gestito'
                : 'richieste da lavorare: tutto chiuso'}
          </span>
        </div>

        <p className="canale-referente muted">
          Referente: <strong>{r.nome}</strong>
          <br />
          {r.ruolo}
          {r.telefono && ` · ${r.telefono}`}
          {r.email && ` · ${r.email}`}
        </p>
      </div>

      {/* La guida solo qui. Il modello che spiega — evento scatenante,
          trattativa da prendere in carico, eventi che la fanno avanzare fino
          a vinta o persa — esiste soltanto su Club e Family: sugli altri
          canali non ci sono trattative, il responsabile chiama e chiude, e
          spiegargli una pipeline che non ha lo confonderebbe invece di
          aiutarlo. `inAgenda` è lo stesso discrimine che decide se le
          trattative esistono (vedi lib/richieste.ts). */}
      {canale.inAgenda && <GuidaModello />}

      {/* Un solo filtro: le richieste da lavorare, o tutte. Il numero sul chip
          è quello che si ottiene cliccandolo. Lo stato delle trattative e
          «assegnate a me» non sono qui: si guardano in Dashboard, l'unico
          posto dove un lead in gestione, vinto o perso — e un mancato rinnovo —
          ha un solo numero. */}
      <div className="filtri">
        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
            <legend>{semplice ? 'Gestione' : 'Lavorazione'}</legend>
            <Chip
              attivo={soloDaLavorare}
              quante={conti.daLavorare}
              href={link({ mostra: null })}
            >
              {semplice ? 'Da gestire' : 'Da lavorare'}
            </Chip>
            <Chip attivo={!soloDaLavorare} quante={conti.tutte} href={link({ mostra: 'tutte' })}>
              Tutte
            </Chip>
          </fieldset>
        </div>
      </div>

      {richieste.length === 0 ? (
        // Un elenco vuoto centrato in grigio si legge come un guasto. Qui i
        // due casi sono diversi e vanno detti diversi: non c'è niente da
        // lavorare (buona notizia), la sezione non ha ancora ricevuto niente
        // (fatto).
        <div className="card">
          <div className="vuoto-buono">
            <span className="vuoto-glifo" aria-hidden="true">
              ✓
            </span>
            <p className="vuoto-titolo">
              {soloDaLavorare
                ? semplice
                  ? 'Niente da gestire'
                  : 'Niente da lavorare'
                : 'Nessuna richiesta in questa sezione'}
            </p>
            <p className="vuoto-nota">
              {soloDaLavorare
                ? semplice
                  ? 'Tutte le richieste arrivate sono state segnate gestite.'
                  : 'Tutte le richieste arrivate sono state chiuse con un esito.'
                : 'Le richieste compariranno qui appena arrivano dal sito.'}
              {soloDaLavorare && (
                <>
                  {' '}
                  <Link className="link" href={link({ mostra: 'tutte' })}>
                    Guarda tutte le richieste
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>
      ) : (
        <ElencoRichieste
          richieste={richieste.map((riga) => ({
            ...riga,
            storico: storicoPersona.get(riga.id),
            eventi: riga.persona_id ? (eventiPerPersona.get(riga.persona_id) ?? []) : [],
          }))}
          contesto={contesto}
          nomiStaff={nomiStaff}
          operatori={operatori}
          puoCancellare={possoCancellare}
          gestioneSemplice={semplice}
          richiestaDalLink={searchParams.richiesta}
        />
      )}
    </>
  )
}

/**
 * Un chip di filtro: nome, quante cose troverà, e la spunta se è quello
 * attivo. La spunta non è decorazione — dice «questo è il filtro scelto»
 * anche a chi non percepisce il contrasto del fondo scuro, che da solo
 * sarebbe l'unico segno.
 */
function Chip({
  href,
  attivo,
  quante,
  children,
}: {
  href: string
  attivo: boolean
  quante: number
  children: React.ReactNode
}) {
  return (
    <Link
      className={`chip${attivo ? ' is-attivo' : ''}${quante === 0 ? ' is-zero' : ''}`}
      aria-current={attivo ? 'true' : undefined}
      href={href}
    >
      {attivo && (
        <span className="chip-spunta" aria-hidden="true">
          ✓
        </span>
      )}
      {children}
      <span className="chip-conteggio">{quante}</span>
    </Link>
  )
}
