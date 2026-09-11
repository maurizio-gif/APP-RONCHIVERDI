'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  CLASSE_TIPO,
  ETICHETTE_TIPO_BREVI,
  dataBreve,
  eAppuntamentoVero,
  intervalloOrario,
  type VoceAgenda,
} from '@/lib/agenda'
import { nomeDiEmail } from '@/lib/staff'
import { GestioneEsito } from '@/components/GestioneEsito'
import { GestioneSemplice } from '@/app/dashboard/richieste/GestioneSemplice'
import { ChiusuraTrattativa } from '@/app/dashboard/ChiusuraTrattativa'
import { ContattiRapidi } from '@/app/dashboard/ContattiRapidi'
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
  trattative = {},
  oggi,
  io,
  operatori,
  puoCancellare,
  sonoCommerciale = false,
  possoRiassegnare = false,
  nomiStaff = {},
}: {
  voci: VoceAgenda[]
  /** Nota e firme delle richieste dal sito, per chiave di voce. */
  gestioni?: Record<string, GestioneSemplicePerVoce>
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
}) {
  const [aperta, setAperta] = useState<string | null>(null)

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
        const trattativa = voce.personaId ? trattative[voce.personaId] : undefined

        // La banda a sinistra dice il peso della voce prima di leggerla: rossa
        // se è di un giorno passato, blu se è di oggi. Prima l'arretrato si
        // riconosceva solo da un badge ambra in mezzo alla riga, che in un
        // elenco di dodici voci si trova rileggendo.
        return (
          <li
            className={`op riga-stato ${arretrato ? 'is-arretrato' : 'is-oggi'}${
              inGestione ? ' is-aperta' : ''
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
                      {intervalloOrario(voce.ora, voce.durataMinuti) ?? 'in giornata'}
                    </span>

                    {arretrato && (
                      <span className="badge badge-ko badge-punto badge-stato">arretrato</span>
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
                </span>

                <span className="op-freccia" aria-hidden="true" />
              </button>
            </div>

            {inGestione && (
              <div className="op-espansione">
                {(voce.persona || voce.attivita || voce.note) && (
                  <div className="op-richiesta">
                    {voce.attivita && (
                      <p className="op-attivita">
                        <span className="muted">Ha chiesto:</span> {voce.attivita}
                      </p>
                    )}
                    {voce.persona && <p className="op-attivita">{voce.persona}</p>}
                    {/* La nota per intero: in riga sarebbe da troncare, e una
                        nota troncata è una nota che va riaperta comunque. */}
                    {voce.note && <p className="op-messaggio">{voce.note}</p>}
                  </div>
                )}

                {/* Chiamare senza cambiare pagina: su un appuntamento di oggi
                    è il gesto più probabile dopo averlo aperto. */}
                <ContattiRapidi email={voce.email} cellulare={voce.cellulare} />

                {conInterruttore ? (
                  <GestioneSemplice
                    id={voce.id}
                    gestito={!voce.daFare}
                    nota={gestione?.nota ?? null}
                    gestitoDa={
                      gestione?.gestitoDa ? nomeDiEmail(gestione.gestitoDa, nomiStaff) : null
                    }
                    gestitoIl={gestione?.gestitoIl ?? null}
                    notaDa={gestione?.notaDa ? nomeDiEmail(gestione.notaDa, nomiStaff) : null}
                    notaIl={gestione?.notaIl ?? null}
                  />
                ) : (
                <GestioneEsito
                  origine={voce.origine}
                  id={voce.id}
                  titolo={voce.titolo}
                  operatori={operatori}
                  puoCancellare={puoCancellare}
                  conOrario={eAppuntamentoVero(voce.tipo)}
                  dataCorrente={voce.data}
                  oraCorrente={voce.ora}
                  // Chiuso l'evento, il passo dopo si fissa qui. Una voce
                  // d'agenda (`task`) non è un collegamento valido, quindi il
                  // seguito si aggancia alla persona: la trattativa si apre e
                  // si chiude nel tempo, la persona resta. Senza persona non
                  // c'è niente a cui agganciarlo, e la domanda non si fa.
                  seguito={
                    voce.origine === 'form_contatti'
                      ? { entita: 'form_contatti', id: voce.id }
                      : voce.personaId
                        ? { entita: 'persona', id: voce.personaId }
                        : null
                  }
                />
                )}

                {/* Com'è finita la trattativa, se ce n'è una aperta: la
                    telefonata appena chiusa è quasi sempre il momento in cui
                    si sa anche questo. */}
                {trattativa && (
                  <div className="op-gestione">
                    <ChiusuraTrattativa
                      t={trattativa}
                      io={io}
                      sonoCommerciale={sonoCommerciale}
                      possoRiassegnare={possoRiassegnare}
                      nomiStaff={nomiStaff}
                    />
                  </div>
                )}

                {/* La scheda della persona, per chi deve sapere qualcosa in
                    più prima di chiamare: da qui non si vede la storia. */}
                {voce.personaId && (
                  <Link
                    className="btn btn-ghost btn-sm"
                    href={`/dashboard/persone/${voce.personaId}`}
                  >
                    Apri la scheda del contatto
                  </Link>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
