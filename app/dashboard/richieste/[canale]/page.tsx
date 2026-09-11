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
import {
  ETICHETTE_STATO,
  PUNTO_STATO,
  STATI,
  STATI_IN_SINTESI,
  eStatoValido,
  type StatoTrattativa,
} from '@/lib/pipeline'
import { voceDaTask } from '@/lib/agenda'
import { mappaNomiStaff, ordinaPerCognome, type RigaStaff } from '@/lib/staff'
import { GuidaModello } from '@/components/GuidaModello'
import { RigaRichiesta, type ContestoTrattativa, type Richiesta } from '../RigaRichiesta'
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
  searchParams: { mostra?: string; stato?: string; mie?: string; richiesta?: string }
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

  // Lo stato arriva dai riquadri del riepilogo. Si accetta solo un valore
  // della pipeline: un parametro inventato non deve svuotare l'elenco senza
  // spiegazione, deve semplicemente non filtrare.
  const statoRichiesto = eStatoValido(searchParams.stato) ? searchParams.stato : null

  // Filtrando per stato si guarda tutta la storia, non solo il da lavorare:
  // «vinte» e «perse» sono per definizione richieste già chiuse, e col filtro
  // di default l'elenco sarebbe sempre vuoto — un link che promette un numero
  // e porta a una pagina vuota è peggio di nessun link.
  const soloDaLavorare = !statoRichiesto && searchParams.mostra !== 'tutte'

  // «Assegnate a me» guarda l'assegnatario della trattativa, perché la
  // richiesta in sé non ha un titolare: è la persona a essere seguita da
  // qualcuno, non il singolo modulo. Esiste solo dove esistono le trattative.
  const soloMie = !!canale.inAgenda && searchParams.mie === '1'

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

  // Le righe che alimentano i numeri sui chip dei filtri. Solo tre colonne e
  // nessun ordinamento: un filtro che non dice quante cose troverà si prova a
  // caso, e provarlo a caso su un elenco di duecento righe vuol dire caricare
  // la pagina due volte per scoprire che era vuota.
  //
  // Sono più delle duecento righe mostrate, di proposito: i chip devono dire
  // quante ce ne sono, non quante ne sta guardando questa pagina — e la riga
  // «N di M caricate» sopra l'elenco dice già la differenza.
  let queryConteggi = supabase
    .from('form_contatti')
    .select('gestito, opportunita_id')
    .limit(2000)
  queryConteggi = canale.origine
    ? queryConteggi.in('origine', canale.origine)
    : queryConteggi.in('attivita', canale.attivita)
  if (canale.settore) queryConteggi = queryConteggi.eq('settore', canale.settore)

  // ── Prima ondata: tutto ciò che non dipende da nient'altro ────────────
  //
  // Ogni lettura è una richiesta HTTP a Supabase, e il database risponde in
  // frazioni di millisecondo: quello che si paga è il viaggio, non il lavoro.
  // Aspettarle una per volta sommava cinque andate e ritorni prima di
  // disegnare la pagina; qui partono insieme e si paga il più lento.
  const [
    { data, error },
    { count: daLavorare },
    { data: righeDaContare },
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
    queryConteggi,
    // Tutte le trattative del canale, in una lettura. Le trattative esistono
    // solo per Club e Family (le crea trova_o_crea_opportunita dal trigger su
    // form_contatti), quindi leggere la tabella intera è leggere esattamente
    // la pipeline di questo canale.
    //
    // Serve due volte: per i numeri sui chip dei filtri e per il blocco
    // trattativa di ogni riga. Prima quest'ultimo era una lettura a parte
    // nella seconda ondata, filtrata sugli id delle righe mostrate: due
    // letture della stessa tabella, e un'ondata in più prima di disegnare.
    canale.inAgenda
      ? conColonneNuove<Record<string, any>>(
          'id, stato, assegnato_a, motivo_perso, motivo_annullato, motivo_vinto, valore_euro',
          COLONNE_NOTA_VINTA,
          (colonne) => supabase.from('opportunita').select(colonne)
        )
      : Promise.resolve({ data: [] as Record<string, any>[] }),
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
            motivo_perso: t.motivo_perso as string | null,
            motivo_annullato: t.motivo_annullato as string | null,
            motivo_vinto: (t.motivo_vinto as string) ?? null,
            valore_euro: t.valore_euro != null ? Number(t.valore_euro) : null,
          } satisfies DatiTrattativa,
        ])
      ),
    }
  }

  // Il filtro per stato si applica qui e non in SQL: lo stato sta su
  // `opportunita`, non su form_contatti, e le trattative si conoscono solo
  // dopo averle caricate qui sopra.
  const io = emailCorrente()
  const richiesteMostrate = richieste.filter((x) => {
    const trattativa = x.opportunita_id ? contesto?.trattative[x.opportunita_id] : undefined

    if (statoRichiesto) {
      // Senza trattativa la richiesta è lavoro che nessuno ha ancora preso:
      // vale come "da prendere in carico", così non scompare dai conti di chi
      // apre quel riquadro.
      const stato = trattativa?.stato ?? 'nuovo'
      if (stato !== statoRichiesto) return false
    }

    // Solo le proprie vuol dire proprie davvero: le libere non ci entrano,
    // perché per quelle c'è il filtro «Da prendere in carico» — un «mie» che
    // comprende anche quelle di nessuno non risponde più a nessuna domanda.
    if (soloMie && trattativa?.assegnato_a !== io) return false

    return true
  })

  // Quanti filtri sono attivi: serve a dire in pagina che si sta guardando un
  // sottoinsieme, e a offrire l'azzeramento solo quando ha senso.
  const filtriAttivi = [!soloDaLavorare, !!statoRichiesto, soloMie].filter(Boolean).length

  // ── I numeri sui chip dei filtri ───────────────────────────────────────
  //
  // Un filtro che non dice quante cose troverà si prova a caso: si clicca,
  // si aspetta la pagina, e spesso si scopre che era vuoto. I chip qui sotto
  // portano il loro conteggio, e ogni conteggio è calcolato **tenendo gli
  // altri filtri come sono adesso**: il numero sul chip è esattamente quello
  // che si otterrà cliccandolo, non un totale astratto che poi non torna.
  //
  // Si conta sulle righe leggere di queryConteggi, non su quelle mostrate: le
  // duecento in pagina sono una finestra, e un chip che contasse la finestra
  // direbbe una cosa diversa a ogni filtro.
  function contaRichieste(quali: {
    /** true = solo da lavorare, false = tutte. */
    soloAperte: boolean
    stato: StatoTrattativa | null
    mie: boolean
  }): number {
    let quante = 0
    for (const riga of righeDaContare ?? []) {
      if (quali.soloAperte && riga.gestito) continue

      const trattativa = riga.opportunita_id
        ? contesto?.trattative[riga.opportunita_id as string]
        : undefined

      // Senza trattativa la richiesta è lavoro che nessuno ha ancora preso:
      // vale come «da prendere in carico», la stessa regola dell'elenco.
      if (quali.stato && (trattativa?.stato ?? 'nuovo') !== quali.stato) continue
      if (quali.mie && trattativa?.assegnato_a !== io) continue

      quante += 1
    }
    return quante
  }

  const conti = {
    daLavorare: contaRichieste({ soloAperte: true, stato: null, mie: soloMie }),
    tutte: contaRichieste({ soloAperte: false, stato: statoRichiesto, mie: soloMie }),
    /** Con lo stato scelto la lavorazione non filtra (vedi soloDaLavorare). */
    perStato: Object.fromEntries(
      STATI.map((x) => [x, contaRichieste({ soloAperte: false, stato: x, mie: soloMie })])
    ) as Record<StatoTrattativa, number>,
    qualsiasiStato: contaRichieste({ soloAperte: soloDaLavorare, stato: null, mie: soloMie }),
    mie: contaRichieste({ soloAperte: soloDaLavorare, stato: statoRichiesto, mie: true }),
    tutteAssegnazioni: contaRichieste({
      soloAperte: soloDaLavorare,
      stato: statoRichiesto,
      mie: false,
    }),
  }

  // Catturata fuori dalla funzione: dentro una chiusura TypeScript non tiene
  // il restringimento fatto da notFound() qui sopra, e `canale` torna a essere
  // possibilmente undefined.
  const chiaveCanale = canale.chiave

  /** Un link che cambia un filtro e lascia stare gli altri. */
  function link(cambi: { mostra?: string | null; stato?: string | null; mie?: string | null }) {
    const params = new URLSearchParams()
    const mostra = cambi.mostra === undefined ? searchParams.mostra : cambi.mostra
    const stato = cambi.stato === undefined ? searchParams.stato : cambi.stato
    const mie = cambi.mie === undefined ? searchParams.mie : cambi.mie
    if (mostra) params.set('mostra', mostra)
    if (stato) params.set('stato', stato)
    if (mie) params.set('mie', mie)
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

        {/* La pipeline del canale in fila, cogli stessi colori dei chip e
            delle righe: è la fotografia che prima non c'era da nessuna parte
            se non tornando in dashboard. */}
        {canale.inAgenda && (
          <ul className="canale-conti muted">
            {STATI_IN_SINTESI.map((x) => (
              <li key={x}>
                <span className={`chip-punto ${PUNTO_STATO[x]}`} aria-hidden="true" />
                <b>{conti.perStato[x]}</b> {ETICHETTE_STATO[x].toLowerCase()}
              </li>
            ))}
          </ul>
        )}

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

      {/* I filtri erano pulsanti: maiuscoli, oro pieno quello attivo, identici
          ai comandi che agiscono sui dati — e muti su quante cose avrebbero
          trovato. Ora sono chip: tondi, in tondo minuscolo, ognuno col suo
          numero, e quello attivo pieno con una spunta. Il numero è calcolato
          tenendo fermi gli altri filtri, quindi è esattamente quello che si
          ottiene cliccando. */}
      <div className="filtri">
        <div className="filtri-testa">
          <span className="filtri-titolo">Filtra l&apos;elenco</span>
          {filtriAttivi > 0 && (
            <Link className="link filtri-azzera" href={link({ mostra: null, stato: null, mie: null })}>
              Azzera i filtri ({filtriAttivi})
            </Link>
          )}
        </div>

        <div className="filtri-gruppi">
          <fieldset className="filtro-gruppo">
            <legend>{semplice ? 'Gestione' : 'Lavorazione'}</legend>
            <Chip
              attivo={soloDaLavorare}
              quante={conti.daLavorare}
              href={link({ mostra: null, stato: null })}
            >
              {semplice ? 'Da gestire' : 'Da lavorare'}
            </Chip>
            <Chip attivo={!soloDaLavorare} quante={conti.tutte} href={link({ mostra: 'tutte' })}>
              Tutte
            </Chip>
          </fieldset>

          {/* Gli stessi quattro stati dei riquadri del riepilogo, col pallino
              del proprio colore: arrivando da un riquadro si vede quale filtro
              è attivo, di che colore è quello stato in elenco, e si può
              cambiarlo senza tornare indietro. Solo dove esistono le
              trattative. */}
          {canale.inAgenda && (
            <>
              <fieldset className="filtro-gruppo">
                {/* Qui gli stati ci sono tutti, annullate comprese: la
                    fotografia qui sopra dice quanto lavoro c'è, questi
                    servono a ritrovare una riga — e una riga che non si può
                    chiedere è una riga persa. */}
                <legend>Stato della trattativa</legend>
                <Chip
                  attivo={!statoRichiesto}
                  quante={conti.qualsiasiStato}
                  href={link({ stato: null })}
                >
                  Qualsiasi
                </Chip>
                {STATI.map((stato) => (
                  <Chip
                    key={stato}
                    attivo={statoRichiesto === stato}
                    quante={conti.perStato[stato]}
                    punto={PUNTO_STATO[stato]}
                    href={link({ stato: statoRichiesto === stato ? null : stato })}
                  >
                    {ETICHETTE_STATO[stato]}
                  </Chip>
                ))}
              </fieldset>

              <fieldset className="filtro-gruppo">
                <legend>Assegnazione</legend>
                <Chip attivo={!soloMie} quante={conti.tutteAssegnazioni} href={link({ mie: null })}>
                  Chiunque
                </Chip>
                <Chip attivo={soloMie} quante={conti.mie} href={link({ mie: '1' })}>
                  Assegnate a me
                </Chip>
              </fieldset>
            </>
          )}
        </div>
      </div>

      {/* Quante si stanno guardando su quante ce ne sono: senza, un elenco
          filtrato e un elenco corto si somigliano troppo. */}
      {filtriAttivi > 0 && richiesteMostrate.length > 0 && (
        <p className="filtri-esito muted">
          {richiesteMostrate.length} di {richieste.length}{' '}
          {richieste.length === 1 ? 'richiesta caricata' : 'richieste caricate'}
        </p>
      )}

      <div className="card">
        {richiesteMostrate.length === 0 ? (
          // Un elenco vuoto centrato in grigio si legge come un guasto. Qui i
          // tre casi sono diversi e vanno detti diversi: i filtri sono troppo
          // stretti (colpa dei filtri), non c'è niente da lavorare (buona
          // notizia), la sezione non ha ancora ricevuto niente (fatto).
          <div className="vuoto-buono">
            <span className="vuoto-glifo" aria-hidden="true">
              {filtriAttivi > 0 ? '⌕' : '✓'}
            </span>
            <p className="vuoto-titolo">
              {filtriAttivi > 0
                ? 'Nessuna richiesta con questi filtri'
                : soloDaLavorare
                  ? semplice
                    ? 'Niente da gestire'
                    : 'Niente da lavorare'
                  : 'Nessuna richiesta in questa sezione'}
            </p>
            <p className="vuoto-nota">
              {filtriAttivi > 0
                ? 'Allarga la ricerca togliendo un filtro.'
                : soloDaLavorare
                  ? semplice
                    ? 'Tutte le richieste arrivate sono state segnate gestite.'
                    : 'Tutte le richieste arrivate sono state chiuse con un esito.'
                  : 'Le richieste compariranno qui appena arrivano dal sito.'}
              {(soloDaLavorare || filtriAttivi > 0) && (
                <>
                  {' '}
                  <Link className="link" href={link({ mostra: 'tutte', stato: null, mie: null })}>
                    Guarda tutte le richieste
                  </Link>
                </>
              )}
            </p>
          </div>
        ) : (
          <ul className="richieste">
            {/* Il link puntava a una richiesta che qui non c'è: più vecchia
                delle ultime duecento, o nascosta da un filtro attivo. Dirlo è
                l'unico modo di distinguere «non l'ho trovata» da «il link non
                ha funzionato». */}
            {searchParams.richiesta &&
              !richiesteMostrate.some((x) => x.id === searchParams.richiesta) && (
                <li className="richiesta">
                  <p className="muted" style={{ margin: 0 }}>
                    La richiesta del link non è in questo elenco: può essere più vecchia delle
                    ultime 200, oppure esclusa dai filtri qui sopra.
                  </p>
                </li>
              )}
            {richiesteMostrate.map((riga) => (
              <RigaRichiesta
                r={riga}
                apriSubito={riga.id === searchParams.richiesta}
                contesto={contesto}
                nomiStaff={nomiStaff}
                operatori={operatori}
                puoCancellare={possoCancellare}
                storico={storicoPersona.get(riga.id)}
                eventi={riga.persona_id ? (eventiPerPersona.get(riga.persona_id) ?? []) : []}
                gestioneSemplice={semplice}
                key={riga.id}
              />
            ))}
          </ul>
        )}
      </div>
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
  /** La classe del pallino di stato, dove il chip filtra uno stato. */
  punto,
  children,
}: {
  href: string
  attivo: boolean
  quante: number
  punto?: string
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
      {punto && !attivo && <span className={`chip-punto ${punto}`} aria-hidden="true" />}
      {children}
      <span className="chip-conteggio">{quante}</span>
    </Link>
  )
}
