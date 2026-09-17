'use client'

import { useEffect, useRef, useState } from 'react'
import {
  CLASSE_TIPO,
  ETICHETTE_TIPO_BREVI,
  dataBreve,
  eAppuntamentoVero,
  etichettaStato,
  intervalloOrario,
  type VoceAgenda,
} from '@/lib/agenda'
import { nomeDiEmail } from '@/lib/staff'
import { GestioneEsito } from '@/components/GestioneEsito'
import { GestioneEvento, type ContestoEvento } from '@/components/GestioneEvento'
import { SchedaContatto } from '@/components/SchedaContatto'
import { ContattiRapidi } from '@/app/dashboard/ContattiRapidi'
import type { EventoCollegato } from '@/app/dashboard/richieste/EventiTrattativa'
import type { Richiesta } from '@/app/dashboard/richieste/RigaRichiesta'
import type { DatiTrattativa } from '@/app/dashboard/richieste/Trattativa'

/**
 * I dati della gestione semplice di una richiesta dal sito: la nota
 * dell'operatore e le firme.
 *
 * Non stanno in VoceAgenda e non ci possono stare: là `note` è il messaggio
 * che ha scritto la persona (vedi voceDaContatto), che è un'altra cosa dalla
 * nota di chi la lavora. Dare due significati allo stesso campo vorrebbe dire
 * mostrare il testo del cliente dentro la casella in cui deve scrivere
 * l'operatore.
 */
export type GestioneSemplicePerVoce = {
  nota: string | null
  gestitoDa: string | null
  gestitoIl: string | null
  notaDa: string | null
  notaIl: string | null
}

// L'elenco degli eventi, gestibili sul posto. **Uno per tutto il pannello**:
// la dashboard e la vista a elenco dell'agenda mostrano lo stesso componente.
//
// Prima erano due. In dashboard la riga era compatta e si apriva su un
// pannello di gestione; in agenda era una tabella con una colonna per dato e
// un suo modo di aprirsi. Le stesse voci, gli stessi gesti, due forme da
// imparare — e alla prima aggiunta avrebbero preso strade diverse.
//
// La riga chiusa porta solo quello che serve a scegliere quale aprire: tipo,
// nome, quando, a chi è in carico, e se è in ritardo. Recapiti, messaggio,
// pannello di chiusura e chiusura della trattativa stanno nell'espansione —
// chiamare non è una cosa che si fa scorrendo un elenco, si fa su una riga
// sola, quella che si è scelta.

export function EventiElenco({
  voci,
  gestioni = {},
  richieste = {},
  eventiPerPersona = {},
  commerciali = [],
  trattative = {},
  oggi,
  io,
  operatori,
  puoCancellare,
  sonoCommerciale = false,
  possoRiassegnare = false,
  nomiStaff = {},
  apriChiave = null,
  apriPersonaId = null,
}: {
  voci: VoceAgenda[]
  /** Nota e firme delle richieste dal sito, per chiave di voce. */
  gestioni?: Record<string, GestioneSemplicePerVoce>
  /**
   * La richiesta dal sito che sta dietro la voce, per chiave di voce.
   *
   * È quello che rende l'espansione di questo elenco **la stessa** di Eventi
   * Core: con la richiesta intera in mano si apre GestioneEvento, che è un
   * componente solo per le tre pagine. Senza, l'espansione ripiega su quel
   * poco che VoceAgenda porta con sé — ed è il caso delle voci scritte in
   * segreteria (`task`), che una richiesta dal sito non ce l'hanno.
   */
  richieste?: Record<string, Richiesta>
  /** Gli eventi già nati dalla trattativa di una persona, per id di persona. */
  eventiPerPersona?: Record<string, EventoCollegato[]>
  /** Chi può essere assegnatario di una trattativa: la tendina del pannello. */
  commerciali?: string[]
  /**
   * La trattativa aperta del contatto di ogni voce, per id di persona.
   *
   * Serve a chiudere la trattativa **da qui**: si telefona, la persona dice
   * sì, e in quel minuto si sanno entrambe le cose — com'è andata la
   * telefonata e com'è finita la trattativa. Prima la seconda stava solo
   * nella tendina degli stati di un altro elenco.
   */
  trattative?: Record<string, DatiTrattativa>
  /** Oggi a Roma: serve a marcare gli arretrati. */
  oggi: string
  io: string | null
  operatori: string[]
  puoCancellare: boolean
  /** I diritti sulla pipeline: decidono quali chiusure si possono offrire. */
  sonoCommerciale?: boolean
  possoRiassegnare?: boolean
  /** Email → "Nome Cognome": nel tag si legge la persona, non il suo indirizzo. */
  nomiStaff?: Record<string, string>
  /**
   * La chiave di una voce da aprire subito, arrivando da un altro pannello —
   * «prendi in carico» dalla dashboard o dal popup deve portare dritti alla
   * trattativa in agenda, non lasciarla da ritrovare a mano in un elenco di
   * dodici voci.
   */
  apriChiave?: string | null
  /**
   * Ripiego quando non si conosce la voce esatta ma solo la persona (una
   * trattativa nata in agenda, senza una richiesta dal sito dietro): apre la
   * prima voce ancora da fare di quella persona, o la prima in assoluto se
   * non ce n'è nessuna aperta.
   */
  apriPersonaId?: string | null
}) {
  // Calcolata una sola volta, all'apertura della pagina: chi tocca «aperta»
  // dopo (aprendo o chiudendo un'altra riga a mano) non deve vedersela
  // ricalcolata da sotto i piedi.
  const [aperta, setAperta] = useState<string | null>(() => {
    if (apriChiave && voci.some((v) => v.chiave === apriChiave)) return apriChiave
    if (apriPersonaId) {
      const daFare = voci.find((v) => v.personaId === apriPersonaId && v.daFare)
      const qualunque = voci.find((v) => v.personaId === apriPersonaId)
      return (daFare ?? qualunque)?.chiave ?? null
    }
    return null
  })

  // La riga da aprire arriva scorrendo da un'altra pagina: senza scorrerci
  // sopra da soli, chi arriva la trova aperta ma magari fuori dallo schermo,
  // in fondo a un elenco di dodici voci.
  const righe = useRef<Record<string, HTMLLIElement | null>>({})
  useEffect(() => {
    if (aperta) righe.current[aperta]?.scrollIntoView({ block: 'center' })
    // Solo all'apertura della pagina: `aperta` cambia anche quando si apre o
    // si chiude una riga a mano, e quello scorrimento non deve ripetersi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ul className="op-elenco">
      {voci.map((voce) => {
        // In ritardo vuol dire **aperta** e di un giorno passato. Una voce
        // eseguita la settimana scorsa non è in ritardo: è fatta, e marcarla
        // rossa in un elenco di eseguite fa sembrare un problema ogni riga
        // che in realtà è la prova che il lavoro è stato fatto.
        const arretrato = voce.daFare && voce.data < oggi
        const mio = voce.assegnatoA === io
        const inGestione = aperta === voce.chiave

        /**
         * Come si chiude: con l'**interruttore** o con l'**esito**.
         *
         * Un messaggio dal sito non si esegue e non fallisce — o l'hai visto
         * o no: è il fatto che ha aperto la trattativa, e com'è andata lo
         * dicono gli eventi che ne seguono. Il server la pensa allo stesso
         * modo e **rifiuta** chiudiConEsito su quelle righe (vedi
         * eAppuntamentoPrenotato in agenda/esito-actions.ts), quindi offrire
         * qui i quattro esiti vorrebbe dire un pulsante che risponde con un
         * errore.
         *
         * Finora il caso non si vedeva perché i messaggi non arrivavano in
         * questo elenco: la query li scartava, non avendo una data. Erano
         * lavoro invisibile.
         */
        const conInterruttore =
          voce.origine === 'form_contatti' && !eAppuntamentoVero(voce.tipo)
        const gestione = gestioni[voce.chiave]

        /**
         * Chi l'ha effettivamente fatta. Esiste solo su una voce chiusa, ed è
         * un dato diverso dall'assegnatario: un appuntamento in carico a
         * Carola può essere stato tenuto da Marco, perché quel giorno al
         * banco c'era lui.
         *
         * Su una riga chiusa è **questo** il dato da mostrare, non
         * l'assegnatario. Le richieste già gestite non hanno un assegnatario
         * scritto — il backfill della migration le ha volutamente saltate,
         * perché attribuire adesso a qualcuno un lavoro chiuso mesi fa
         * sarebbe un'invenzione — e mostrarle «Non assegnato» accanto a una
         * trattativa che qualcuno segue si legge come un buco nei dati,
         * mentre il dato vero c'è e dice un'altra cosa.
         */
        const fatta = voce.esitoDa ?? gestione?.gestitoDa ?? null

        /**
         * Chiusa e com'è finita. Sono due domande diverse: `daFare` dice se
         * c'è ancora da lavorarci, l'esito dice se è andata a buon fine — una
         * telefonata fatta e una a cui non ha risposto nessuno sono entrambe
         * chiuse, e per la segreteria non sono la stessa cosa.
         *
         * Il verde va solo su quello che è stato **eseguito**: una fallita
         * verde direbbe il falso proprio a chi scorre l'elenco senza
         * leggerlo, che è tutto il punto di colorare le righe.
         */
        const chiusa = !voce.daFare
        const fallita = chiusa && voce.esitoTipo === 'fallita'
        const eseguita = chiusa && voce.stato === 'completato' && !fallita

        /**
         * Il commento della chiusura, in chiaro sulla riga.
         *
         * Due sorgenti perché le voci si chiudono in due modi: con l'esito —
         * e allora la nota è `voce.esito` — oppure con l'interruttore delle
         * richieste dal sito, dove quello che l'operatore ha scritto sta
         * nella gestione semplice. Senza il ripiego, metà delle righe chiuse
         * mostrerebbe un esito senza il perché.
         */
        const notaEsito = (voce.esito ?? gestione?.nota ?? '').trim() || null

        const trattativa = voce.personaId ? trattative[voce.personaId] : undefined
        // La richiesta dal sito dietro la voce: c'è per tutto quello che è
        // arrivato da un form, manca sulle voci scritte in segreteria.
        const richiesta = richieste[voce.chiave]

        /**
         * Il motivo di un annullamento, quando l'esito non ce l'ha.
         *
         * Un appuntamento annullato dal cliente (dal link nell'email di
         * conferma) non passa da chiudiConEsito: non c'è nessuna chiusura con
         * nota, e senza un ripiego la riga restava annullata e muta — proprio
         * il caso in cui chi la guarda ha più bisogno di sapere il perché. Si
         * prende dalla trattativa, quando è stata chiusa annullata anche lei
         * con un motivo scritto, e in mancanza dal messaggio che la persona
         * stessa aveva lasciato: è quanto di più vicino a un motivo esista.
         */
        const motivoAnnullato =
          voce.stato === 'annullato'
            ? (trattativa?.stato === 'annullato' ? trattativa.motivo_annullato : null) ??
              voce.note
            : null

        // La nota da mostrare in chiaro sulla riga chiusa: quella della
        // chiusura, o in mancanza quella dell'annullamento. Una riga chiusa
        // senza niente da leggere qui sotto costringe ad aprirla solo per
        // scoprire che non c'era nessun motivo scritto — e per un annullato,
        // quasi sempre c'è.
        const notaVisibile = notaEsito ?? motivoAnnullato

        // La banda a sinistra dice il peso della voce prima di leggerla: rossa
        // se è aperta e di un giorno passato, **verde se è stata eseguita**,
        // blu altrimenti. Prima l'arretrato si riconosceva solo da un badge
        // ambra in mezzo alla riga, che in un elenco di dodici voci si trova
        // rileggendo — e una eseguita aveva la stessa banda blu di una ancora
        // da fare: in un elenco misto il lavoro già fatto si distingueva solo
        // leggendo riga per riga il tag di chi l'aveva chiusa.
        const classeStato = arretrato
          ? 'is-arretrato'
          : eseguita
            ? 'is-eseguita'
            : fallita
              ? 'is-fallita'
              : 'is-oggi'

        return (
          <li
            ref={(el) => {
              righe.current[voce.chiave] = el
            }}
            className={`op riga-stato ${classeStato}${inGestione ? ' is-aperta' : ''}${
              apriChiave === voce.chiave || (!apriChiave && apriPersonaId === voce.personaId)
                ? ' is-indicata'
                : ''
            }`}
            key={voce.chiave}
          >
            <div className="op-riga">
              <button
                type="button"
                className="op-apri"
                aria-expanded={inGestione}
                onClick={() => setAperta(inGestione ? null : voce.chiave)}
              >
                <span className={`badge-tipo ${CLASSE_TIPO[voce.tipo]} op-tipo`}>
                  {ETICHETTE_TIPO_BREVI[voce.tipo]}
                </span>

                <span className="op-corpo">
                  <span className="op-nome">{voce.titolo}</span>

                  <span className="op-meta">
                    <span className="op-quando muted">
                      {dataBreve(voce.data)}
                      {' · '}
                      {/* Un messaggio non ha uno slot, ma è arrivato in un
                          momento preciso: "in giornata" è vero ma non dice
                          niente, l'ora d'arrivo sì. */}
                      {intervalloOrario(voce.ora, voce.durataMinuti) ?? voce.orarioArrivo ?? 'in giornata'}
                    </span>

                    {arretrato && (
                      <span className="badge badge-ko badge-punto badge-stato">arretrato</span>
                    )}

                    {/* Com'è andata, sulla riga chiusa e non dentro
                        l'espansione: «è stata fatta?» è la prima domanda su
                        una voce passata, e fin qui si rispondeva aprendola.
                        L'etichetta la dà etichettaStato — «Eseguita»,
                        «Fallita», e «Fatto» sulle voci chiuse prima che gli
                        esiti esistessero, che è tutto quello che di loro si
                        sa davvero. */}
                    {chiusa && (
                      <span
                        className={`badge badge-punto badge-stato ${
                          eseguita ? 'badge-ok' : fallita ? 'badge-ko' : 'badge-off'
                        }`}
                      >
                        {etichettaStato(voce.stato, voce.esitoTipo)}
                      </span>
                    )}

                    {/* A chi è assegnato, detto per esteso e su **ogni**
                        riga. Questo elenco mostra gli eventi di tutto il
                        club: senza il nome dell'operatore si legge come una
                        lista di cose proprie — e o ci si presenta in due alla
                        stessa telefonata, o si dà per scontato che ci pensi
                        qualcun altro.

                        «In carico a Carola Porcella» e non il solo nome: in
                        una riga che comincia col nome del contatto, un
                        secondo nome nudo si legge come un altro contatto. E
                        dove non c'è nessuno si scrive «Non assegnato», non si
                        lascia vuoto: un'assenza non si legge — prima il
                        proprietario compariva soltanto quando non eri tu,
                        quindi la mancanza del nome era essa stessa
                        l'informazione, e la si capiva solo sapendola già.

                        Il nome al posto dell'email: «c.porcella@ronchiverdi.it»
                        si legge lettera per lettera, «Carola Porcella» si
                        riconosce in un colpo d'occhio. */}
                    {/* Su una chiusa chi l'ha fatta, su una aperta a chi è in
                        carico: sono due domande diverse e solo una delle due
                        ha senso per volta. */}
                    {!voce.daFare && fatta ? (
                      <span className="tag-assegnato e-fatta">
                        {fatta === io ? 'Fatta da te' : `Fatta da ${nomeDiEmail(fatta, nomiStaff)}`}
                      </span>
                    ) : (
                      <span
                        className={`tag-assegnato${
                          mio ? ' e-mio' : voce.assegnatoA ? ' e-altrui' : ' e-nessuno'
                        }`}
                      >
                        {mio
                          ? 'In carico a te'
                          : voce.assegnatoA
                            ? `In carico a ${nomeDiEmail(voce.assegnatoA, nomiStaff)}`
                            : 'Non assegnato'}
                      </span>
                    )}

                    {/* Arrivato dal sito e non scritto in segreteria: senza
                        assegnatario è perché la sua trattativa non l'ha
                        ancora presa nessuno, non perché qualcuno si è
                        dimenticato di assegnarlo. */}
                    {voce.daFare && !voce.assegnatoA && voce.origine === 'form_contatti' && (
                      <span className="tag">dal sito</span>
                    )}

                    {/* Su una richiesta dal sito `note` è il **messaggio che
                        ha scritto la persona** (vedi voceDaContatto), non
                        l'appunto di un collega: chiamarlo «nota» farebbe
                        aprire la riga per leggere cosa ha detto la segreteria
                        e trovarci il testo del cliente. */}
                    {voce.note && (
                      <span className="tag tag-nota">
                        {voce.origine === 'form_contatti' ? 'con messaggio' : 'con nota'}
                      </span>
                    )}
                  </span>

                  {/* Il commento della chiusura, scritto per intero e senza
                      aprire niente: è il motivo per cui una voce chiusa si
                      riguarda — «non ha risposto, richiamare giovedì» vale
                      quanto il fatto che la telefonata sia stata fatta, e
                      costava un'apertura per riga. Per intero e non troncato:
                      una nota tagliata a metà va riaperta comunque, che è
                      esattamente il gesto che qui si voleva togliere. */}
                  {chiusa && notaVisibile && (
                    <span className="op-esito">{notaVisibile}</span>
                  )}
                </span>

                <span className="op-freccia" aria-hidden="true" />
              </button>
            </div>

            {inGestione && (
              <div className="op-espansione">
                {richiesta ? (
                  /* Esattamente l'espansione di Eventi Core: stato della
                     trattativa e come chiuderla, recapiti con numero e
                     indirizzo scritti, tutti i dettagli della richiesta, la
                     chiusura dell'evento, il seguito. Prima questa pagina ne
                     mostrava un terzo — niente riassegnazione, niente
                     cronologia, e dei dati del form solo l'attività e il
                     messaggio — e per il resto si cambiava pagina. */
                  <GestioneEvento
                    r={richiesta}
                    trattativa={trattativa}
                    contesto={{ io, sonoCommerciale, possoRiassegnare, commerciali }}
                    eventi={voce.personaId ? (eventiPerPersona[voce.personaId] ?? []) : []}
                    nomiStaff={nomiStaff}
                    operatori={operatori}
                    puoCancellare={puoCancellare}
                  />
                ) : (
                  /* Le voci scritte in segreteria: non vengono da un form, e
                     quindi non hanno né i dati del form né una trattativa da
                     far avanzare. Restano il perché della voce e come si
                     chiude. */
                  <>
                    {/* Chi è, in testa: da qui si apre la sua scheda — le
                        altre richieste, le trattative, le note di chi l'ha
                        già chiamato. Stesso pulsante e stesso posto
                        dell'espansione delle richieste dal sito (vedi
                        GestioneEvento): questa è più corta perché una voce
                        scritta in segreteria non ha né i dati di un form né
                        una trattativa, non perché i gesti cambino. */}
                    <SchedaContatto personaId={voce.personaId} />

                    {(voce.persona || voce.attivita || voce.note) && (
                      <div className="op-richiesta">
                        {voce.attivita && (
                          <p className="op-attivita">
                            <span className="muted">Ha chiesto:</span> {voce.attivita}
                          </p>
                        )}
                        {voce.persona && <p className="op-attivita">{voce.persona}</p>}
                        {/* La nota per intero: in riga sarebbe da troncare, e
                            una nota troncata è una nota che va riaperta
                            comunque. */}
                        {voce.note && <p className="op-messaggio">{voce.note}</p>}
                      </div>
                    )}

                    <ContattiRapidi email={voce.email} cellulare={voce.cellulare} />

                    <GestioneEsito
                      origine={voce.origine}
                      id={voce.id}
                      titolo={voce.titolo}
                      operatori={operatori}
                      puoCancellare={puoCancellare}
                      conOrario={eAppuntamentoVero(voce.tipo)}
                      dataCorrente={voce.data}
                      oraCorrente={voce.ora}
                      chiusa={!voce.daFare}
                      esitoCorrente={voce.esitoTipo}
                      notaCorrente={voce.esito}
                      firma={voce.esitoDa ? nomeDiEmail(voce.esitoDa, nomiStaff) : null}
                      firmaIl={voce.esitoIl}
                      // Chiuso l'evento, il passo dopo si fissa qui. Una voce
                      // d'agenda (`task`) non è un collegamento valido, quindi
                      // il seguito si aggancia alla persona: la trattativa si
                      // apre e si chiude nel tempo, la persona resta.
                      seguito={voce.personaId ? { entita: 'persona', id: voce.personaId } : null}
                    />
                  </>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
