'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { inizialiPersona, nomePersona } from '@/lib/persone'
import { CLASSE_RIGA_STATO, eChiusa, eDaPrendere } from '@/lib/pipeline'
import { CLASSE_URGENZA, fraseAttesa, giorniDa, urgenzaAttesa } from '@/lib/attesa'
import {
  CLASSE_TIPO,
  ETICHETTE_TIPO_BREVI,
  dataBreve,
  eAppuntamentoVero,
  intervalloOrario,
  type Esito,
  type TipoVoce,
} from '@/lib/agenda'
import { provenienzaTrattativa } from '@/lib/provenienza'
import { nomeDiEmail } from '@/lib/staff'
import { GestioneEsito } from '@/components/GestioneEsito'
import { Trattativa, type DatiTrattativa } from './richieste/Trattativa'
import { ChiusuraTrattativa } from './ChiusuraTrattativa'
import { GestioneSemplice } from './richieste/GestioneSemplice'
import { ContattiRapidi } from './ContattiRapidi'
import { prendiInCarico } from './richieste/trattativa-actions'

/**
 * L'evento che ha aperto la trattativa: la richiesta dal sito o dal banco,
 * con tutto quello che serve a **chiuderla da qui**.
 *
 * Null quando la trattativa è nata da un evento scritto in agenda (vedi
 * trattativa_per_evento): lì non c'è nessuna richiesta dietro, e quegli
 * eventi si lavorano nella seconda sezione della dashboard.
 */
export type EventoDOrigine = {
  /** La riga di `form_contatti`: è quella che si gestisce. */
  richiestaId: string
  /** Tipo d'agenda: visita in sede, telefonata, o messaggio. */
  tipo: TipoVoce
  /** Giorno e ora prenotati dal sito, quando ci sono. */
  data: string | null
  ora: string | null
  durataMinuti: number
  /** Cosa ha chiesto: è la frase con cui si apre la telefonata. */
  attivita: string | null
  messaggio: string | null
  /** Quante richieste ha mandato in tutto: più di una vuol dire che è un ritorno. */
  quante: number
  /** Da quale form o banco arriva (`form_contatti.origine`). */
  origine: string | null
  gestito: boolean
  gestitoDa: string | null
  gestitoIl: string | null
  /**
   * Di chi è il lavoro su questo evento: l'assegnatario della trattativa nel
   * momento in cui l'ha presa, scritto dal trigger
   * assegna_eventi_della_trattativa. Distinto da `esitoDa`/`gestitoDa`, che
   * dicono chi l'ha effettivamente chiuso.
   */
  assegnatoA: string | null
  nota: string | null
  notaDa: string | null
  notaIl: string | null
  esitoTipo: Esito | null
  esito: string | null
  esitoDa: string | null
  esitoIl: string | null
}

/** Una trattativa con la persona che rappresenta, per l'elenco in dashboard. */
export type TrattativaConPersona = DatiTrattativa & {
  personaId: string | null
  /** Quando è nata: da qui esce «ferma da 9 giorni». */
  creatoIl?: string | null
  /** `opportunita.origine`: serve dove non c'è nessuna richiesta agganciata. */
  origine?: string | null
  nome: string | null
  cognome: string | null
  email: string | null
  cellulare: string | null
  evento: EventoDOrigine | null
}

// Le trattative in dashboard, una riga per una.
//
// Prima ogni riga era già aperta: nome, tre pastiglie di recapito, il blocco
// trattativa con due tendine e un pulsante. Una sola riga occupava mezzo
// schermo, e con sei trattative libere la domanda «quali sono e da dove
// arrivano» richiedeva di scorrere. Ma è quella la domanda con cui si apre la
// giornata, e deve avere una risposta a colpo d'occhio.
//
// Ora la riga chiusa porta le quattro cose che decidono chi si chiama per
// primo, e nient'altro:
//
//  - **il nome**, in chiaro;
//  - **da dove arriva** (vedi lib/provenienza.ts): Sito, Guest Register,
//    Agenda o Altro. Chi è passato dal banco ha già parlato con qualcuno, e
//    richiamarlo come un contatto freddo è il modo di sembrare
//    disorganizzati;
//  - **la tipologia di evento** che l'ha generata: una visita prenotata in
//    sede non è una telefonata da fare, e un messaggio non è nessuna delle
//    due;
//  - **da quanto aspetta**, colorata, più la banda di stato a sinistra.
//
// Tutto il resto — recapiti, messaggio, comandi della trattativa, chiusura
// dell'evento — sta nell'espansione. Chiamare o scrivere non è una cosa che
// si fa scorrendo un elenco: si fa su una riga sola, quella che si è scelta.
//
// «Prendi in carico» è l'eccezione e resta fuori: è il gesto per cui questo
// elenco esiste, e farlo costare un'apertura in più vorrebbe dire lasciare
// lì le trattative libere.

export function TrattativeDashboard({
  trattative,
  io,
  sonoCommerciale,
  possoRiassegnare,
  commerciali,
  operatori,
  puoCancellare,
  nomiStaff = {},
}: {
  trattative: TrattativaConPersona[]
  io: string | null
  sonoCommerciale: boolean
  possoRiassegnare: boolean
  commerciali: string[]
  /** Chi può essere assegnatario di un evento, per i pannelli di chiusura. */
  operatori: string[]
  puoCancellare: boolean
  /** Email → "Nome Cognome": nelle firme si legge la persona, non l'indirizzo. */
  nomiStaff?: Record<string, string>
}) {
  const [aperta, setAperta] = useState<string | null>(null)

  return (
    <ul className="op-elenco">
      {trattative.map((t) => (
        <RigaOpportunita
          key={t.id}
          t={t}
          aperta={aperta === t.id}
          apri={() => setAperta(aperta === t.id ? null : t.id)}
          io={io}
          sonoCommerciale={sonoCommerciale}
          possoRiassegnare={possoRiassegnare}
          commerciali={commerciali}
          operatori={operatori}
          puoCancellare={puoCancellare}
          nomiStaff={nomiStaff}
        />
      ))}
    </ul>
  )
}

function RigaOpportunita({
  t,
  aperta,
  apri,
  io,
  sonoCommerciale,
  possoRiassegnare,
  commerciali,
  operatori,
  puoCancellare,
  nomiStaff,
}: {
  t: TrattativaConPersona
  aperta: boolean
  apri: () => void
  io: string | null
  sonoCommerciale: boolean
  possoRiassegnare: boolean
  commerciali: string[]
  operatori: string[]
  puoCancellare: boolean
  nomiStaff: Record<string, string>
}) {
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  const nome = nomePersona(t)
  const giorni = giorniDa(t.creatoIl)
  // Su una chiusa l'attesa non vuol dire niente: è storia, non una cosa che
  // sta aspettando qualcuno.
  const giorniAttesa = giorni !== null && !eChiusa(t.stato) ? giorni : null

  const evento = t.evento
  const provenienza = provenienzaTrattativa({
    origineRichiesta: evento?.origine,
    origineTrattativa: t.origine,
    haRichiesta: !!evento,
  })

  // Da prendere in carico: il pulsante sta in riga chiusa, perché è il gesto
  // per cui questo elenco esiste.
  const daPrendere = eDaPrendere(t) && sonoCommerciale

  /**
   * Come si chiude l'evento d'origine: con l'**interruttore** o con
   * l'**esito**. È la stessa regola di conInterruttore in
   * app/dashboard/richieste/actions.ts, che lato server decide cosa si può
   * salvare — un appuntamento prenotato è un impegno preso per un giorno e
   * un'ora e si chiude dicendo com'è andato; un messaggio o l'hai visto o no.
   */
  const conInterruttore = !!evento && !eAppuntamentoVero(evento.tipo)

  const quando = evento?.data
    ? `${dataBreve(evento.data)}${
        evento.ora ? ` · ${intervalloOrario(evento.ora, evento.durataMinuti) ?? evento.ora}` : ''
      }`
    : null

  return (
    <li className={`op riga-stato ${CLASSE_RIGA_STATO[t.stato]}${aperta ? ' is-aperta' : ''}`}>
      <div className="op-riga">
        {/* Tutta la riga apre: su un elenco che si scorre col pollice un
            bersaglio di venti pixel in fondo a destra è un bersaglio che si
            manca. */}
        <button type="button" className="op-apri" aria-expanded={aperta} onClick={apri}>
          <span className="op-iniziali" aria-hidden="true">
            {inizialiPersona(t) || '·'}
          </span>

          <span className="op-corpo">
            <span className="op-nome">{nome}</span>

            <span className="op-meta">
              {/* Da dove arriva, prima di tutto il resto: decide come ci si
                  presenta al telefono. */}
              <span className={`tag-provenienza ${provenienza.classe}`}>
                {provenienza.etichetta}
              </span>

              {/* Che cosa l'ha generata. Senza richiesta dietro non si
                  inventa un tipo: lo dice la targhetta della provenienza. */}
              {evento && (
                <span className={`badge-tipo ${CLASSE_TIPO[evento.tipo]}`}>
                  {ETICHETTE_TIPO_BREVI[evento.tipo]}
                </span>
              )}

              {/* Un appuntamento con un giorno e un'ora: è il dato che
                  cambia la giornata di chi è al banco. */}
              {quando && <span className="op-quando muted">{quando}</span>}

              {giorniAttesa !== null && (
                <span className={`attesa ${CLASSE_URGENZA[urgenzaAttesa(giorniAttesa)]}`}>
                  {fraseAttesa(giorniAttesa, 'aperta')}
                </span>
              )}

              {/* Un ritorno va detto prima di chiamare: presentarsi come al
                  primo contatto a chi ha già scritto tre volte è il modo di
                  perderlo. */}
              {evento && evento.quante > 1 && (
                <span className="tag tag-avviso">{evento.quante}ª richiesta</span>
              )}

              {/* L'evento già chiuso: la riga resta qui perché la trattativa
                  è aperta, ma la telefonata è stata fatta. */}
              {evento?.gestito && <span className="tag tag-ok">evento gestito</span>}
            </span>
          </span>

          <span className="op-freccia" aria-hidden="true" />
        </button>

        {/* Fuori dal pulsante che apre: un pulsante dentro un pulsante non è
            cliccabile, e questo è il comando più usato dell'elenco. */}
        {daPrendere && (
          <button
            type="button"
            className="btn btn-sm op-prendi"
            disabled={inCorso}
            onClick={() => {
              setErrore(null)
              startTransition(async () => {
                const esito = await prendiInCarico(t.id)
                if (!esito.ok) setErrore(esito.errore)
              })
            }}
          >
            {inCorso ? 'Un attimo…' : 'Prendi in carico'}
          </button>
        )}
      </div>

      {errore && <p className="op-errore">{errore}</p>}

      {aperta && (
        <div className="op-espansione">
          {/* Cosa ha chiesto e cosa ha scritto: le due cose che si leggono
              con la cornetta già in mano. */}
          <div className="op-richiesta">
            <p className="op-provenienza muted">{provenienza.spiegazione}</p>
            {evento?.attivita && (
              <p className="op-attivita">
                <span className="muted">Ha chiesto:</span> {evento.attivita}
              </p>
            )}
            {evento?.messaggio && <p className="op-messaggio">{evento.messaggio}</p>}
          </div>

          {/* I recapiti stanno solo qui: chiamare è un gesto che si fa su una
              riga scelta, non scorrendo un elenco. */}
          <ContattiRapidi email={t.email} cellulare={t.cellulare} spiegaSeVuoto />

          {/* Lo stato e l'assegnazione: gli stessi comandi della sezione
              Eventi Core, stesso componente. La tendina degli stati serve a
              **tornare indietro** — rimettere in gestione, riaprire una
              chiusa — che è una correzione di percorso. */}
          <Trattativa
            t={t}
            io={io}
            sonoCommerciale={sonoCommerciale}
            possoRiassegnare={possoRiassegnare}
            commerciali={commerciali}
            nomiStaff={nomiStaff}
          />

          {/* La chiusura, con gli stessi tre pulsanti e gli stessi campi che
              si trovano a margine di un evento: nome dell'abbonamento e
              importo sulla vinta, il motivo sulle altre due. Chiudere una
              trattativa deve funzionare allo stesso modo da qualunque parte
              del pannello ci si arrivi — la tendina lo faceva già, ma con un
              gesto diverso, e due gesti per la stessa cosa si imparano
              entrambi male. */}
          <div className="op-gestione">
            <ChiusuraTrattativa
              t={t}
              io={io}
              sonoCommerciale={sonoCommerciale}
              possoRiassegnare={possoRiassegnare}
              conIntestazione={false}
              nomiStaff={nomiStaff}
            />
          </div>

          {/* L'evento d'origine si chiude da qui. Era il passaggio che
              costava una pagina: si leggeva la trattativa in dashboard e si
              andava in Club e Family a segnare la telefonata fatta. */}
          {evento && (
            <div className="op-gestione">
              <p className="op-gestione-titolo">
                {conInterruttore ? 'La richiesta' : "L'appuntamento"}
              </p>

              {/* Di chi è e, se è chiuso, chi l'ha fatto. Sono due fatti
                  diversi e veri insieme: un appuntamento in carico a Carola
                  può essere stato tenuto da Marco, perché quel giorno al
                  banco c'era lui. Tenerne uno solo vuol dire non poter più
                  rispondere né a «di chi era» né a «chi l'ha fatto». */}
              <p className="op-gestione-chi muted">
                {evento.assegnatoA
                  ? `In carico a ${nomeDiEmail(evento.assegnatoA, nomiStaff)}`
                  : 'Non assegnato'}
                {evento.gestito &&
                  (evento.esitoDa || evento.gestitoDa) &&
                  ` · eseguito da ${nomeDiEmail((evento.esitoDa ?? evento.gestitoDa)!, nomiStaff)}`}
              </p>
              {conInterruttore ? (
                <GestioneSemplice
                  id={evento.richiestaId}
                  gestito={evento.gestito}
                  nota={evento.nota}
                  gestitoDa={evento.gestitoDa ? nomeDiEmail(evento.gestitoDa, nomiStaff) : null}
                  gestitoIl={evento.gestitoIl}
                  notaDa={evento.notaDa ? nomeDiEmail(evento.notaDa, nomiStaff) : null}
                  notaIl={evento.notaIl}
                />
              ) : (
                <GestioneEsito
                  origine="form_contatti"
                  id={evento.richiestaId}
                  titolo={nome}
                  operatori={operatori}
                  puoCancellare={puoCancellare}
                  conOrario
                  dataCorrente={evento.data}
                  oraCorrente={evento.ora}
                  chiusa={evento.gestito}
                  esitoCorrente={evento.esitoTipo}
                  notaCorrente={evento.esito}
                  firma={evento.esitoDa ? nomeDiEmail(evento.esitoDa, nomiStaff) : null}
                  firmaIl={evento.esitoIl}
                  // Chiuso l'appuntamento, il passo dopo si fissa qui: si
                  // aggancia alla richiesta, come fa il pannello Eventi di
                  // Club e Family — la trattativa lì c'è per definizione.
                  seguito={{ entita: 'form_contatti', id: evento.richiestaId }}
                />
              )}
            </div>
          )}

          {/* La storia della persona, per chi vuole sapere qualcosa in più
              prima di chiamare: da qui non si vede. */}
          {t.personaId && (
            <Link className="btn btn-ghost btn-sm" href={`/dashboard/persone/${t.personaId}`}>
              Apri la scheda del contatto
            </Link>
          )}
        </div>
      )}
    </li>
  )
}
