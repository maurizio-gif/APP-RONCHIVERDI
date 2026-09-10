'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  CLASSE_TIPO,
  ETICHETTE_ESITO,
  ETICHETTE_TIPO,
  dataBreve,
  eAppuntamentoVero,
  etichettaStato,
  intervalloOrario,
  type VoceAgenda,
} from '@/lib/agenda'
import { nomeDiEmail } from '@/lib/staff'
import { AzioniVoce } from '@/app/dashboard/agenda/AzioniVoce'
import { ContattiRapidi } from '@/app/dashboard/ContattiRapidi'
import { GestioneEsito } from './GestioneEsito'

/** "3 set 14:20" — quando una nota è stata scritta. */
function dataOraBreve(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// L'elenco delle voci di agenda, uguale nelle due viste: il calendario lo
// mostra sotto il giorno selezionato, la lista lo ripete per ogni giornata.
// Una tabella sola tenuta in un posto solo evita che le due viste dicano le
// stesse cose in due modi diversi.
const COLONNE = ['Data', 'Tipologia', 'Chi', 'Assegnato a', 'Stato'] as const

export function TabellaAgenda({
  voci,
  oggi,
  emailCorrente,
  operatori,
  puoCancellare,
  nomiStaff = {},
  mostraData = true,
}: {
  voci: VoceAgenda[]
  /**
   * Oggi a Roma. Serve a distinguere «da fare» da «in ritardo», che è la
   * differenza che decide cosa si guarda per primo: prima ogni voce aperta
   * era rossa, anche un appuntamento fra tre settimane, e col rosso su tutto
   * non risaltava più niente.
   */
  oggi: string
  emailCorrente: string | null
  /** Chi può essere assegnatario di un evento programmato. */
  operatori: string[]
  puoCancellare: boolean
  /**
   * Email → "Nome Cognome" dello staff. Sul database le lavorazioni sono
   * firmate con l'email, che è la chiave e sopravvive alla persona; qui si
   * legge il nome, perché su un pannello dove tutti sono @ronchiverdi.it
   * l'indirizzo è la forma meno riconoscibile di una persona.
   */
  nomiStaff?: Record<string, string>
  /** Nel calendario il giorno è già nell'intestazione: lì la colonna Data porta solo l'ora. */
  mostraData?: boolean
}) {
  // Una riga aperta per volta: due dettagli aperti insieme allontanano le
  // righe rimanenti fuori schermo e si perde il filo dell'elenco.
  const [apertaChiave, setApertaChiave] = useState<string | null>(null)

  return (
    <div className="tabella-wrap">
      <table className="tabella tabella-agenda">
        <thead>
          <tr>
            <th className="col-espandi" />
            {COLONNE.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {voci.map((voce) => (
            <RigaVoce
              key={voce.chiave}
              voce={voce}
              oggi={oggi}
              emailCorrente={emailCorrente}
              operatori={operatori}
              puoCancellare={puoCancellare}
              nomiStaff={nomiStaff}
              mostraData={mostraData}
              aperta={apertaChiave === voce.chiave}
              onApri={() => setApertaChiave(apertaChiave === voce.chiave ? null : voce.chiave)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RigaVoce({
  voce,
  oggi,
  emailCorrente,
  operatori,
  puoCancellare,
  nomiStaff,
  mostraData,
  aperta,
  onApri,
}: {
  voce: VoceAgenda
  oggi: string
  emailCorrente: string | null
  operatori: string[]
  puoCancellare: boolean
  nomiStaff: Record<string, string>
  mostraData: boolean
  aperta: boolean
  onApri: () => void
}) {
  const orario = intervalloOrario(voce.ora, voce.durataMinuti)
  const firma = nomeDiEmail(voce.esitoDa, nomiStaff)

  /**
   * Un messaggio arrivato dal sito: in agenda si vede, ma non si chiude con
   * un esito. Non si esegue e non fallisce — è il fatto che ha aperto la
   * trattativa. Si segna gestito dalla sua sezione, e quello che ne segue
   * sono gli eventi. La stessa regola vale lato server in chiudiConEsito:
   * qui decide cosa si disegna, là cosa si può salvare.
   */
  const messaggioDalSito = voce.origine === 'form_contatti' && !eAppuntamentoVero(voce.tipo)
  // Senza assegnatario la cella mostra una targhetta (vedi sotto): «dal sito»
  // e «di nessuno» non sono nomi di persone e non vanno letti come tali.
  const assegnatario =
    voce.assegnatoA === emailCorrente ? 'Te' : nomeDiEmail(voce.assegnatoA, nomiStaff)

  // Tre stati, non due. «Da fare» e «in ritardo» sono la stessa cosa solo per
  // il database: per chi lavora il richiamo mancato ieri è la cosa che scotta
  // e l'appuntamento di giovedì è programmato. Prima erano entrambi rossi, e
  // col rosso su tutto non risaltava più niente.
  const arretrata = voce.daFare && voce.data < oggi
  const classeRiga = arretrata ? 'is-arretrata' : voce.daFare ? 'is-dafare' : 'is-fatta'
  const puntino = arretrata ? 'rosso' : voce.daFare ? 'ambra' : 'verde'

  return (
    <>
      <tr
        className={`riga-agenda ${classeRiga}${aperta ? ' is-aperta' : ''}`}
        onClick={onApri}
      >
        {/* Il click sta anche sulla riga intera, perché è il bersaglio che si
            colpisce naturalmente col mouse. Ma un <tr> non si raggiunge da
            tastiera: il pulsante qui dentro è quello che rende la riga
            apribile con Tab e Invio, e che annuncia se è aperta. */}
        <td className="col-espandi">
          <button
            type="button"
            className="btn-espandi"
            aria-expanded={aperta}
            aria-label={`${aperta ? 'Chiudi' : 'Apri'} il dettaglio di ${voce.titolo}`}
            onClick={(e) => {
              e.stopPropagation()
              onApri()
            }}
          >
            {aperta ? '−' : '+'}
          </button>
        </td>

        <td data-label="Data" className="cella-data">
          <span className="puntino-riga">
            <span className={`puntino ${puntino}`} />
            <span>
              {mostraData && <span className="cella-data-giorno">{dataBreve(voce.data)}</span>}
              {/* «In giornata» su una richiesta senza appuntamento direbbe
                  che c'è qualcosa da fare entro oggi in un giorno che nessuno
                  ha scelto: quello è il giorno in cui è arrivata, ed è da lì
                  che la persona sta aspettando. */}
              <span className="cella-data-ora">
                {orario ?? (voce.dataDArrivo ? 'arrivata' : 'in giornata')}
              </span>
            </span>
          </span>
        </td>

        <td data-label="Tipologia">
          <span className={`badge-tipo ${CLASSE_TIPO[voce.tipo]}`}>{ETICHETTE_TIPO[voce.tipo]}</span>
        </td>

        <td data-label="Chi">
          <span className="cella-chi-nome">{voce.titolo}</span>
          {/* Per chi è: una voce della segreteria ha un titolo che dice cosa
              fare («Richiamare per il preventivo»), non con chi. */}
          {voce.persona && <span className="cella-chi-dettagli">{voce.persona}</span>}
          {/* L'attività richiesta sul sito è una classificazione, non un
              dettaglio in grigio: è la stessa targhetta di Club e Family. */}
          {voce.attivita && (
            <span className="tag-fila">
              <span className="tag tag-canale">{voce.attivita}</span>
            </span>
          )}
          {/* L'oggetto scritto da chi ha prenotato: sapere di cosa si parlerà
              serve scorrendo la giornata, non dopo aver aperto la riga. Una
              riga sola con i puntini, perché il testo può essere lungo — per
              intero sta nel dettaglio. */}
          {voce.note && <span className="cella-chi-oggetto">{voce.note}</span>}
          {/* Erano testo grigio sotto il nome, da ricopiare a mano per
              telefonare a chi si sta per chiamare: due passaggi per il gesto
              che l'agenda esiste per fare. */}
          <ContattiRapidi email={voce.email} cellulare={voce.cellulare} />
        </td>

        <td data-label="Assegnato a">
          {/* «Dal sito» non è un collega: nessuno ha quella voce in mano, e
              distinguerlo evita che due persone diano per fatto che ci pensi
              l'altra. */}
          {voce.assegnatoA ? (
            assegnatario
          ) : voce.origine === 'form_contatti' ? (
            <span className="tag cella-chi-targa">dal sito</span>
          ) : (
            <span className="tag tag-avviso cella-chi-targa">di nessuno</span>
          )}
        </td>

        <td data-label="Stato">
          <span
            className={`badge badge-punto badge-stato ${
              arretrata
                ? 'badge-ko'
                : voce.daFare
                  ? 'badge-warn'
                  : voce.esitoTipo === 'fallita'
                    ? 'badge-ko'
                    : 'badge-ok'
            }`}
          >
            {arretrata ? 'In ritardo' : etichettaStato(voce.stato, voce.esitoTipo)}
          </span>
        </td>
      </tr>

      {aperta && (
        <tr className="riga-dettaglio">
          <td colSpan={COLONNE.length + 1}>
            <div className="dettaglio-voce">
              <dl className="dettagli-lista">
                <Dato etichetta="Titolo" valore={voce.titolo} />
                <Dato
                  etichetta={voce.dataDArrivo ? 'Arrivata' : 'Quando'}
                  valore={
                    voce.dataDArrivo
                      ? dataBreve(voce.data)
                      : `${dataBreve(voce.data)} — ${orario ?? 'in giornata'}`
                  }
                />
                {/* Una richiesta senza appuntamento non dura niente: mostrarne
                    i minuti farebbe credere che un impegno sia stato fissato. */}
                {!voce.dataDArrivo && <Dato etichetta="Durata" valore={`${voce.durataMinuti} min`} />}
                <Dato etichetta="Contatto" valore={voce.persona} />
                <Dato etichetta="Email" valore={voce.email} />
                <Dato etichetta="Cellulare" valore={voce.cellulare} />
                <Dato etichetta="Attività" valore={voce.attivita} />
                {/* Per una richiesta dal sito il testo è l'oggetto che la
                    persona ha scritto prenotando: chiamarlo "Note" lo farebbe
                    sembrare un appunto della segreteria. */}
                <Dato
                  etichetta={voce.origine === 'form_contatti' ? 'Oggetto' : 'Note'}
                  valore={voce.note}
                />
                <Dato
                  etichetta="Origine"
                  valore={voce.origine === 'form_contatti' ? 'Richiesta dal sito' : 'Inserita in segreteria'}
                />
                {/* L'esito già scelto si rilegge qui: senza, chi riapre la voce
                    non sa se è stata eseguita o è fallita, né perché. */}
                <Dato
                  etichetta="Esito"
                  valore={voce.esitoTipo ? ETICHETTE_ESITO[voce.esitoTipo] : null}
                />
                <Dato etichetta="Nota di chiusura" valore={voce.esito} />
                {/* Chi l'ha scritta, sotto la nota: una nota di chiusura senza
                    firma costringeva ad andare nel registro operatori a
                    cercare l'azione con l'orario giusto. Le note scritte prima
                    che la firma esistesse lo dicono, invece di attribuirsi a
                    chi sta guardando. */}
                {voce.esito && (
                  <Dato
                    etichetta="Scritta da"
                    valore={
                      firma
                        ? `${firma}${voce.esitoIl ? ` — ${dataOraBreve(voce.esitoIl)}` : ''}`
                        : 'Firma non registrata'
                    }
                  />
                )}
              </dl>
              <AzioniVoce voce={voce} />
            </div>

            {messaggioDalSito ? (
              <p className="esito-firma" style={{ margin: '0.75rem 0 0' }}>
                Un messaggio non si chiude con un esito.{' '}
                <Link className="link" href="/dashboard/richieste/richieste-club">
                  Segnalo gestito fra le richieste
                </Link>
                , e il seguito programmalo dalla trattativa.
              </p>
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
              // Chiusa: il pannello passa da «chiudi» a «correggi», e la voce
              // non torna fra quelle da fare per cambiare una nota.
              chiusa={!voce.daFare && voce.stato !== 'annullato'}
              esitoCorrente={voce.esitoTipo}
              notaCorrente={voce.esito}
              firma={firma}
              firmaIl={voce.esitoIl}
            />
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// Un campo vuoto non si mostra: una lista di "—" fa sembrare incompleta una
// voce che invece non ha quel dato per costruzione (un task non ha un'email).
function Dato({ etichetta, valore }: { etichetta: string; valore: string | null }) {
  if (!valore) return null
  return (
    <>
      <dt>{etichetta}</dt>
      <dd>{valore}</dd>
    </>
  )
}
