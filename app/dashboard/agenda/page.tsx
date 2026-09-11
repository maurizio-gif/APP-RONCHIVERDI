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
import { nomePersona } from '@/lib/persone'
import { mappaNomiStaff, ordinaPerCognome, type RigaStaff } from '@/lib/staff'
import { CalendarioAgenda } from '@/components/CalendarioAgenda'
import { EventiElenco, type GestioneSemplicePerVoce } from '@/components/EventiElenco'
import { eCommerciale, puoRiassegnare } from '@/lib/auth/permessi'
import type { DatiTrattativa } from '../richieste/Trattativa'
import { VistaTabs } from '@/components/VistaTabs'
import { NuovaVoce, type ContattoScegliibile } from './NuovaVoce'

export const dynamic = 'force-dynamic'

/**
 * Quanto guarda avanti e indietro la vista a lista. Indietro serve solo a
 * ripescare gli arretrati ancora da fare — il passato già chiuso non si
 * elenca, si consulta dal calendario andando al suo mese.
 */
const GIORNI_AVANTI = 90
const GIORNI_INDIETRO = 180

/**
 * Quanti contatti si caricano per la tendina del form. Oggi l'anagrafica ne
 * ha una manciata; il limite c'è perché il giorno in cui saranno diecimila
 * questa pagina non deve scaricarli tutti a ogni apertura. Chi cerca un
 * contatto fuori dall'elenco lo trova scrivendone il nome — e il form dice
 * che l'elenco è parziale invece di far credere che manchi.
 */
const CONTATTI_NEL_FORM = 300

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: { vista?: string; da?: string; solo?: string; chi?: string }
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

  // Tre stati e non più l'orario. «Solo con orario» divideva le voci per una
  // proprietà che non è il motivo per cui si apre l'agenda: chi la guarda
  // vuole sapere cosa è in ritardo, cosa c'è da fare e cosa è già stato
  // fatto — non quali cose hanno un'ora e quali no. Un appuntamento alle 17 e
  // una telefonata «in giornata» sono due cose da fare, e separarle metteva
  // fra loro una linea che nessuno ha in testa.
  const soloStato =
    searchParams.solo === 'ritardo' ||
    searchParams.solo === 'dafare' ||
    searchParams.solo === 'eseguite'
      ? searchParams.solo
      : null
  // Di chi è l'agenda che si sta guardando. È un asse suo, indipendente da
  // «cosa mostrare»: prima era uno dei tre valori dello stesso parametro, e
  // scegliere «le mie» spegneva «solo con orario» — le due domande («di chi?»
  // e «cosa?») si escludevano a vicenda senza motivo, e non si poteva vedere
  // *i miei appuntamenti di oggi*, che è la domanda con cui si apre l'agenda.
  const soloMie = searchParams.chi === 'mie'
  const email = emailCorrente()

  const supabase = createSupabaseServiceClient()
  const [
    { data: task, error: erroreTask },
    { data: contatti, error: erroreRichieste },
    { data: staff },
    possoCancellare,
    { data: persone, error: errorePersone },
    sonoCommerciale,
    possoRiassegnareTrattative,
  ] = await Promise.all([
    supabase
      .from('task')
      .select(
        'id, titolo, tipo, data, ora, durata_minuti, stato, note, assegnato_a, esito_tipo, esito, esito_da, esito_il, entita, entita_id'
      )
      .gte('data', inizio)
      .lte('data', fine),
    supabase
      .from('form_contatti')
      .select(
        'id, created_at, azione, data_scelta, ora_scelta, nome, cognome, email, cellulare, attivita_label, messaggio, gestito, gestito_da, gestito_il, assegnato_a, note, note_da, note_il, esito_tipo, esito, esito_da, esito_il, persona_id, appuntamento_annullato_il'
      )
      // Due finestre, non una: le richieste che hanno preso un appuntamento
      // si cercano sul giorno scelto, i messaggi — che una data non ce
      // l'hanno — sul giorno in cui sono arrivati. Con il solo confronto su
      // `data_scelta` i messaggi sparivano tutti: su una colonna nulla `gte`
      // non è vero, e quelle righe non tornavano mai indietro.
      //
      // Il limite alto su created_at è esclusivo e sul giorno dopo:
      // `created_at` è un timestamp, e `lte` sulla data secca taglierebbe via
      // tutto quello che è arrivato dopo la mezzanotte dell'ultimo giorno.
      .or(
        `and(data_scelta.gte.${inizio},data_scelta.lte.${fine}),` +
          `and(data_scelta.is.null,created_at.gte.${inizio},created_at.lt.${giornoPiu(fine, 1)})`
      )
      // Solo Club e Family: sono le richieste che passano dalla segreteria.
      // Le altre vanno diritte al responsabile del corso e vivono nella sua
      // sezione (lib/richieste.ts), non in questo calendario.
      .in('attivita', ATTIVITA_IN_AGENDA),
    // Nome e cognome oltre all'email: l'email è la firma scritta sulle righe,
    // il nome è quello che si legge. La traduzione sta in lib/staff.ts.
    supabase.from('staff_users').select('email, nome, cognome'),
    puoCancellare(email),
    // I contatti per la tendina del form: una voce d'agenda è sempre
    // agganciata a qualcuno (vedi creaVoce). I più mossi per primi — chi si
    // sta lavorando adesso è quasi sempre chi ha scritto di recente.
    //
    // Dalla vista e non dalla tabella: `ultima_richiesta` è un conto sulle
    // richieste e sta lì. Chiesta a `persone` faceva fallire la lettura, e
    // con l'errore ignorato la tendina dei contatti restava vuota — l'unico
    // modo di aggiungere qualcosa in agenda era non averne bisogno. Lo stesso
    // inciampo era già stato corretto in dashboard/page.tsx.
    //
    // nullsFirst: false tiene in fondo chi non ha richieste — i contatti
    // inseriti a mano ci restano finché non scrivono, ed è giusto: si
    // trovano cercandoli per nome, che è come li si è appena creati.
    supabase
      .from('persone_con_richieste')
      .select('id, nome, cognome, email, cellulare')
      .order('ultima_richiesta', { ascending: false, nullsFirst: false })
      .limit(CONTATTI_NEL_FORM),
    // I diritti sulla pipeline: l'elenco degli eventi permette di chiudere la
    // trattativa collegata, e quali chiusure offrire lo decidono questi.
    eCommerciale(email),
    puoRiassegnare(email),
  ])

  // Senza i contatti il form non si può usare: va detto nei log, invece di
  // lasciare una tendina vuota che sembra un'anagrafica vuota.
  if (errorePersone) {
    console.error('Contatti per il form dell’agenda non letti:', errorePersone.message)
  }

  // Le due letture che *sono* l'agenda. Erano le uniche due senza controllo
  // dell'errore, e con l'errore ignorato una query fallita disegnava
  // un'agenda vuota — indistinguibile da una giornata libera, e senza una
  // riga nei log da cui accorgersene. Una colonna aggiunta al codice e non
  // ancora al database è bastata a far sparire tutto in silenzio.
  //
  // Il banner in pagina, non solo il log: chi sta guardando deve sapere che
  // quello che vede non è l'agenda, ma un guasto.
  const guasto = erroreTask ?? erroreRichieste
  if (erroreTask) console.error('Voci di agenda non lette:', erroreTask.message)
  if (erroreRichieste) console.error('Richieste in agenda non lette:', erroreRichieste.message)

  // I nomi dei contatti agganciati alle voci della segreteria: `task.entita_id`
  // è un id, e senza il nome in elenco l'obbligo di agganciare una voce a
  // qualcuno non servirebbe a niente — resterebbe un titolo senza il perché.
  const idContattiDelleVoci = [
    ...new Set(
      (task ?? [])
        .filter((t) => t.entita === 'persona' && t.entita_id)
        .map((t) => t.entita_id as string)
    ),
  ]

  const { data: contattiDelleVoci, error: erroreContatti } = idContattiDelleVoci.length
    ? await supabase
        .from('persone')
        .select('id, nome, cognome, email, cellulare')
        .in('id', idContattiDelleVoci)
    : { data: [] as Record<string, any>[], error: null }

  if (erroreContatti) {
    console.error('Nomi dei contatti delle voci non letti:', erroreContatti.message)
  }

  const perId = new Map(
    (contattiDelleVoci ?? []).map((p) => [
      p.id as string,
      {
        id: p.id as string,
        nome: nomePersona(p),
        email: (p.email as string) ?? null,
        cellulare: (p.cellulare as string) ?? null,
      },
    ])
  )

  let voci: VoceAgenda[] = [
    ...(task ?? []).map((riga) =>
      voceDaTask(riga, riga.entita === 'persona' && riga.entita_id ? perId.get(riga.entita_id) : undefined)
    ),
    // Tutte le richieste, non solo quelle che hanno prenotato uno slot: i
    // messaggi e gli appuntamenti senza data si collocano nel giorno in cui
    // sono arrivati (vedi voceDaContatto). Prima sparivano, e chi apriva
    // l'agenda per sapere cosa c'era da fare non li vedeva.
    ...(contatti ?? []).map(voceDaContatto),
  ]

  // Le voci annullate restano fuori dalla vista normale: sono lì per storia,
  // non per lavorarle.
  voci = voci.filter((v) => v.stato !== 'annullato')

  /**
   * Le voci che sono in mano a chi sta guardando: quelle assegnate a lui.
   *
   * Le richieste dal sito non ci sono: non sono assegnate a nessuno — in
   * elenco portano la targhetta «dal sito» proprio per dirlo — e contarle come
   * proprie faceva sì che «le mie» mostrasse a tutti le stesse righe. Chi le
   * vuole vedere guarda l'agenda di tutti, che è dove stanno finché qualcuno
   * non se le prende.
   */
  const eMia = (v: VoceAgenda) => v.assegnatoA === email

  // Quante ne troverebbe ogni filtro, prima di applicarne uno. Un filtro che
  // non dice quante cose troverà si prova a caso — e provarlo qui vuol dire
  // ricaricare la pagina per scoprire che era vuoto.
  //
  // I due assi si incrociano, quindi ogni conteggio tiene conto dell'altro:
  // «solo con orario» dice quanti ne troverà *nell'agenda che stai
  // guardando*, non nel club intero.
  const diChi = soloMie ? voci.filter(eMia) : voci

  // I tre stati, come predicati: si usano per i conteggi dei chip e per il
  // filtro, così un chip non può mai promettere un numero diverso da quello
  // che mostra.
  const eInRitardo = (v: VoceAgenda) => v.daFare && v.data < oggi
  const eDaFare = (v: VoceAgenda) => v.daFare && v.data >= oggi
  const eEseguita = (v: VoceAgenda) => !v.daFare

  const contiFiltri = {
    tutti: voci.length,
    mie: voci.filter(eMia).length,
    tutto: diChi.length,
    ritardo: diChi.filter(eInRitardo).length,
    dafare: diChi.filter(eDaFare).length,
    eseguite: diChi.filter(eEseguita).length,
  }

  voci = diChi
  if (soloStato === 'ritardo') voci = voci.filter(eInRitardo)
  else if (soloStato === 'dafare') voci = voci.filter(eDaFare)
  else if (soloStato === 'eseguite') voci = voci.filter(eEseguita)

  const daFare = voci.filter((v) => v.daFare).length
  // Gli arretrati sono il numero che decide la giornata: aperti e di un
  // giorno già passato. Non c'erano da nessuna parte in questa pagina —
  // stavano dentro il conteggio generico di «Ancora da fare».
  const arretrati = voci.filter((v) => v.daFare && v.data < oggi).length

  // Per il datalist del form: chi può essere assegnatario di una voce.
  // Ordinati per cognome, come in Gestione utenti: una tendina di colleghi
  // ordinata per email li mette in un ordine che nessuno ha in testa.
  const staffOrdinato = ordinaPerCognome((staff ?? []) as RigaStaff[])
  const operatori = staffOrdinato.map((s) => s.email)
  const nomiStaff = mappaNomiStaff(staffOrdinato)

  const contattiForm = (persone ?? []) as unknown as ContattoScegliibile[]
  const contattiTroncati = contattiForm.length === CONTATTI_NEL_FORM

  // ── Quello che serve a lavorare una riga, non solo a leggerla ──────────
  //
  // L'elenco è lo stesso componente della dashboard (EventiElenco), e quel
  // componente chiude le richieste, scrive le note e chiude la trattativa.
  // Sono due letture in più rispetto alla vecchia tabella, ed è il prezzo di
  // non avere due elenchi che si comportano diversamente.

  // La nota dell'operatore e le firme delle richieste dal sito. Non stanno in
  // VoceAgenda e non ci possono stare: là `note` è il messaggio che ha
  // scritto la persona, che è un'altra cosa dalla nota di chi la lavora.
  const gestioni: Record<string, GestioneSemplicePerVoce> = {}
  for (const r of contatti ?? []) {
    gestioni[`contatto-${r.id}`] = {
      nota: (r.note as string) ?? null,
      gestitoDa: (r.gestito_da as string) ?? null,
      gestitoIl: (r.gestito_il as string) ?? null,
      notaDa: (r.note_da as string) ?? null,
      notaIl: (r.note_il as string) ?? null,
    }
  }

  // La trattativa aperta del contatto di ogni voce, per chiuderla da qui: si
  // telefona, la persona dice sì, e in quel minuto si sanno entrambe le cose.
  const idPersoneVoci = [...new Set(voci.map((v) => v.personaId).filter(Boolean))] as string[]
  const { data: trattativeAperte } = idPersoneVoci.length
    ? await supabase
        .from('opportunita')
        .select('id, persona_id, stato, assegnato_a, motivo_perso, motivo_annullato')
        .in('persona_id', idPersoneVoci)
        .in('stato', ['nuovo', 'in_gestione'])
    : { data: [] as Record<string, any>[] }

  const trattative: Record<string, DatiTrattativa> = {}
  for (const t of trattativeAperte ?? []) {
    trattative[t.persona_id as string] = {
      id: t.id as string,
      stato: t.stato,
      assegnato_a: (t.assegnato_a as string) ?? null,
      motivo_perso: (t.motivo_perso as string) ?? null,
      motivo_annullato: (t.motivo_annullato as string) ?? null,
    }
  }

  // Nella lista il passato conta solo se è ancora aperto: gli arretrati vanno
  // recuperati, le cose già fatte no — a meno che non si sia chiesto proprio
  // di vederle. Senza questa eccezione il filtro «Eseguite» mostrava un
  // elenco quasi vuoto: le eseguite sono per definizione nel passato, e il
  // filtro le trovava per poi lasciarle fuori.
  const vociLista =
    soloStato === 'eseguite' ? voci : voci.filter((v) => v.data >= oggi || v.daFare)
  const giorniLista = [...new Set(vociLista.map((v) => v.data))].sort()
  const perGiornata = perGiorno(vociLista)

  // Un parametro non nominato resta com'è: cambiare «di chi» non deve
  // spegnere «solo con orario», che è quello che succedeva quando i due assi
  // erano lo stesso parametro.
  function link(parametri: {
    vista?: string
    da?: string
    solo?: string | null
    chi?: string | null
  }) {
    const params = new URLSearchParams()
    params.set('vista', parametri.vista ?? vista)
    if (parametri.da) params.set('da', parametri.da)
    const filtro = parametri.solo === undefined ? searchParams.solo : parametri.solo
    if (filtro) params.set('solo', filtro)
    const chi = parametri.chi === undefined ? searchParams.chi : parametri.chi
    if (chi) params.set('chi', chi)
    return `/dashboard/agenda?${params.toString()}`
  }

  return (
    <>
      <div className="page-head">
        {/* Diceva «Agenda» sopra un titolo «Agenda»: due volte la stessa
            parola invece di dire di chi è la sezione. */}
        <p className="eyebrow">Segreteria</p>
        <h1>Agenda</h1>
        <p className="muted">
          Tutto quello che passa dalla segreteria in un calendario solo: appuntamenti e telefonate
          prenotati dal sito, i messaggi arrivati senza appuntamento — collocati nel giorno in cui
          sono arrivati — e le cose da fare della segreteria.
        </p>
      </div>

      {guasto && (
        <p className="error-banner">
          L’agenda non è stata letta: quello che vedi qui sotto è incompleto. {guasto.message}
        </p>
      )}

      <VistaTabs
        vista={vista}
        base="/dashboard/agenda"
        tabs={[
          { chiave: 'calendario', etichetta: 'Calendario' },
          { chiave: 'lista', etichetta: 'Lista', contatore: daFare },
        ]}
        altriParametri={{
          da: vista === 'calendario' ? searchParams.da : undefined,
          solo: searchParams.solo,
          chi: searchParams.chi,
        }}
      />

      {/* Erano tre pulsanti oro/fantasma, identici ai comandi che agiscono sui
          dati e muti su quante cose avrebbero trovato. Ora sono chip col loro
          numero, nello stesso riquadro dei filtri di Abbonamento Club e
          Family: chi passa da una sezione all'altra ritrova lo stesso gesto. */}
      <div className="filtri">
        <div className="filtri-testa">
          <span className="filtri-titolo">Filtra l&apos;agenda</span>
        </div>
        <div className="filtri-gruppi">
          {/* Due domande diverse, due gruppi. «Di chi» prima, perché è quella
              che si sceglie una volta e resta: l'agenda del club o la propria.
              Prima erano tre chip in fila e «Le mie» spegneva «Solo con
              orario» — i miei appuntamenti di oggi, che è la cosa che si
              guarda per prima al mattino, non si potevano chiedere. */}
          <fieldset className="filtro-gruppo">
            <legend>Di chi</legend>
            <ChipAgenda
              attivo={!soloMie}
              quante={contiFiltri.tutti}
              href={link({ da: daRichiesto, chi: null })}
            >
              Di tutti
            </ChipAgenda>
            <ChipAgenda
              attivo={soloMie}
              quante={contiFiltri.mie}
              href={link({ da: daRichiesto, chi: 'mie' })}
            >
              La mia
            </ChipAgenda>
          </fieldset>

          {/* Tre stati che si escludono e si sommano al totale: in ritardo,
              da fare, eseguite. Sono le tre domande vere di un'agenda, e
              messe in fila dicono anche in che stato è la giornata senza
              bisogno di premere niente. */}
          <fieldset className="filtro-gruppo">
            <legend>In che stato</legend>
            <ChipAgenda
              attivo={!soloStato}
              quante={contiFiltri.tutto}
              href={link({ da: daRichiesto, solo: null })}
            >
              Tutto
            </ChipAgenda>
            <ChipAgenda
              attivo={soloStato === 'ritardo'}
              quante={contiFiltri.ritardo}
              href={link({ da: daRichiesto, solo: 'ritardo' })}
            >
              In ritardo
            </ChipAgenda>
            <ChipAgenda
              attivo={soloStato === 'dafare'}
              quante={contiFiltri.dafare}
              href={link({ da: daRichiesto, solo: 'dafare' })}
            >
              Da fare
            </ChipAgenda>
            <ChipAgenda
              attivo={soloStato === 'eseguite'}
              quante={contiFiltri.eseguite}
              href={link({ da: daRichiesto, solo: 'eseguite' })}
            >
              Eseguite
            </ChipAgenda>
          </fieldset>
        </div>
      </div>

      {/* Due riquadri: in ritardo e ancora da fare, cogli stessi toni del
          resto del pannello. Il terzo contava gli appuntamenti «con orario»,
          ed è andato via con il filtro omonimo: divideva le voci per una
          proprietà che non è il motivo per cui si apre l'agenda — un
          appuntamento alle 17 e una telefonata «in giornata» sono due cose da
          fare, e il numero di quelle che hanno un'ora non risponde a nessuna
          domanda. Ciascuno dice cosa vuol dire, invece di lasciare un numero
          da interpretare. */}
      <div className="griglia-stat">
        <div className={`stat stat-error${arretrati > 0 ? ' is-azione' : ' is-vuoto'}`}>
          <span className="stat-testa">
            <span className="stat-label">
              {arretrati > 0 && <span className="stat-punto" aria-hidden="true" />}
              In ritardo
            </span>
          </span>
          <span className="stat-valore">{arretrati}</span>
          <span className="stat-nota">
            {arretrati > 0
              ? 'Aperte e di un giorno già passato: da recuperare oggi'
              : 'Niente rimasto indietro'}
          </span>
        </div>

        <div className={`stat stat-warn${daFare > 0 ? '' : ' is-vuoto'}`}>
          <span className="stat-testa">
            <span className="stat-label">Ancora da fare</span>
          </span>
          <span className="stat-valore">{daFare}</span>
          <span className="stat-nota">
            {vista === 'calendario'
              ? 'Aperte in questo mese, arretrati compresi'
              : 'Aperte in elenco, arretrati compresi'}
          </span>
        </div>

      </div>

      {vista === 'calendario' ? (
        <CalendarioAgenda
          voci={voci}
          gestioni={gestioni}
          trattative={trattative}
          mese={mese}
          oggi={oggi}
          emailCorrente={email}
          operatori={operatori}
          puoCancellare={possoCancellare}
          sonoCommerciale={sonoCommerciale}
          possoRiassegnare={possoRiassegnareTrattative}
          nomiStaff={nomiStaff}
          linkMesePrecedente={link({ da: mesePiu(mese, -1) })}
          linkMeseSuccessivo={link({ da: mesePiu(mese, 1) })}
          linkOggi={link({ da: oggi })}
          nuovaVoce={<NuovaVoce
              giornoPredefinito={oggi}
              operatori={operatori}
              contatti={contattiForm}
              contattiTroncati={contattiTroncati}
            />}
        />
      ) : (
        <>
          {giorniLista.map((giorno) => {
            const delGiorno = perGiornata.get(giorno) ?? []
            const arretrato = giorno < oggi
            const daFareOggi = delGiorno.filter((v) => v.daFare).length

            // La banda a sinistra dice il peso della giornata prima di
            // leggerne il titolo: rossa se è arretrata — è la sola che chiede
            // qualcosa adesso — blu se è oggi, niente se è futura. Prima oggi
            // aveva un filo d'oro e l'arretrato solo un badge dentro il
            // titolo, che in una lista di dieci giornate si trova rileggendo.
            return (
              <div
                className={`card agenda-giorno${
                  arretrato ? ' is-arretrato' : giorno === oggi ? ' is-oggi' : ''
                }`}
                key={giorno}
              >
                <div className="card-head">
                  <h2 className="agenda-giorno-titolo">
                    {dataLunga(giorno)}
                    {giorno === oggi && <span className="badge badge-info badge-punto">oggi</span>}
                    {arretrato && (
                      <span className="badge badge-ko badge-punto badge-stato">arretrato</span>
                    )}
                  </h2>
                  <span className="muted agenda-giorno-conti">
                    <span>
                      {delGiorno.length} {delGiorno.length === 1 ? 'voce' : 'voci'}
                    </span>
                    {/* Quante ne restano aperte in questa giornata: «4 voci»
                        non dice se sono tutte da fare o tutte già chiuse. */}
                    {daFareOggi > 0 && (
                      <span className={`badge badge-punto ${arretrato ? 'badge-ko' : 'badge-warn'}`}>
                        {daFareOggi} da fare
                      </span>
                    )}
                  </span>
                </div>
                {/* Lo stesso elenco della dashboard, non una tabella sua:
                    stesse righe compatte, stessa espansione, stessi comandi.
                    Prima erano due forme per le stesse voci e gli stessi
                    gesti, e chi passava da una pagina all'altra doveva
                    impararle entrambe. */}
                <EventiElenco
                  voci={delGiorno}
                  gestioni={gestioni}
                  trattative={trattative}
                  oggi={oggi}
                  io={email}
                  operatori={operatori}
                  puoCancellare={possoCancellare}
                  sonoCommerciale={sonoCommerciale}
                  possoRiassegnare={possoRiassegnareTrattative}
                  nomiStaff={nomiStaff}
                />
              </div>
            )
          })}

          {vociLista.length === 0 && (
            <div className="card">
              {/* «Niente in agenda» in grigio al centro si legge come un
                  guasto: qui i due casi sono diversi — i filtri sono troppo
                  stretti, oppure non c'è davvero niente, che è una buona
                  notizia. */}
              <div className="vuoto-buono">
                <span className="vuoto-glifo" aria-hidden="true">
                  {searchParams.solo || soloMie ? '⌕' : '✓'}
                </span>
                <p className="vuoto-titolo">
                  {searchParams.solo || soloMie
                    ? soloMie && !searchParams.solo
                      ? 'La tua agenda è libera'
                      : 'Niente con questo filtro'
                    : 'Agenda libera'}
                </p>
                <p className="vuoto-nota">
                  {searchParams.solo || soloMie ? (
                    <>
                      Nessuna voce corrisponde.{' '}
                      <Link className="link" href={link({ da: daRichiesto, solo: null, chi: null })}>
                        Guarda tutta l&apos;agenda
                      </Link>
                    </>
                  ) : (
                    'Nessun appuntamento e nessuna cosa da fare, né arretrata né in arrivo.'
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="agenda-nuova">
            <NuovaVoce
              giornoPredefinito={oggi}
              operatori={operatori}
              contatti={contattiForm}
              contattiTroncati={contattiTroncati}
            />
          </div>
        </>
      )}
    </>
  )
}

/**
 * Un chip di filtro dell'agenda: nome, quante voci troverà, e la spunta se è
 * quello attivo. La spunta non è decorazione — dice «questo è il filtro
 * scelto» anche a chi non percepisce il contrasto del fondo scuro, che da solo
 * sarebbe l'unico segno.
 *
 * È il gemello del Chip di Eventi Core: due copie di sei righe
 * di classi, invece di un componente condiviso, perché i due filtri non hanno
 * niente in comune oltre l'aspetto — e il giorno che uno dei due prende un
 * pallino di stato o un raggruppamento, il componente unico si spacca in due.
 */
function ChipAgenda({
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
