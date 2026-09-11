'use client'

import { ETICHETTE_ESITO, dataOra, eEsitoValido } from '@/lib/agenda'
import { dominioDi, percorsoBreve, primoContattoDi, provenienzaRichiesta } from '@/lib/percorsoSito'
import { nomeDiEmail } from '@/lib/staff'
import { PercorsoSito } from '@/components/PercorsoSito'
import type { Richiesta } from '@/app/dashboard/richieste/RigaRichiesta'

/**
 * Tutto quello che una richiesta dal sito porta con se': cosa ha chiesto, il
 * messaggio, il consenso, da quale pagina e' arrivata, com'e' stata chiusa.
 *
 * **Uno per tutto il pannello.** Lo mostrano Eventi Core, la dashboard e
 * l'agenda: e' la stessa richiesta guardata da tre elenchi diversi. Finche'
 * i dettagli sono esistiti solo dentro Eventi Core, dalla dashboard se ne
 * vedevano tre campi su venti - «ha chiesto», il messaggio, e basta - e per
 * sapere da quale pagina fosse arrivato qualcuno, se avesse dato il consenso
 * o cosa avesse risposto al questionario bisognava cambiare pagina.
 *
 * I recapiti non stanno qui: stanno accanto ai pulsanti che li usano (vedi
 * ContattiRapidi), che e' il posto dove servono.
 *
 * Il tipo `Richiesta` arriva da RigaRichiesta con un import di solo tipo:
 * niente al runtime, quindi nessun ciclo fra i due moduli.
 */
export function DettagliRichiesta({
  r,
  /**
   * Come si chiude questa richiesta. Cambia una parola sola - «Nota» contro
   * «Nota precedente» - ma e' la differenza fra la nota che si scrive adesso
   * e quella vecchia, leggibile e non piu' scrivibile.
   */
  conInterruttore,
  nomiStaff = {},
}: {
  r: Richiesta
  conInterruttore: boolean
  nomiStaff?: Record<string, string>
}) {
  const eQuestionario = r.origine === 'fitness-manager-inline'
  const minore = [r.minore_nome, r.minore_cognome].filter(Boolean).join(' ')
  const provenienza = provenienzaRichiesta(r)
  const primoContatto = primoContattoDi(r)
  const firmaEsito = nomeDiEmail(r.esito_da, nomiStaff)

  return (
    <>
        <dl className="dettagli-lista">
          {r.data_nascita && (
            <>
              <dt>Data di nascita</dt>
              <dd>{r.data_nascita}</dd>
            </>
          )}
          {minore && (
            <>
              <dt>Bambino/a</dt>
              <dd>
                {minore}
                {r.minore_data_nascita && ` · nato/a il ${r.minore_data_nascita}`}
              </dd>
            </>
          )}
          {r.azione && (
            <>
              <dt>Richiesta</dt>
              <dd>
                {r.azione}
                {r.data_scelta && ` · ${r.data_scelta}`}
                {r.ora_scelta && ` ore ${String(r.ora_scelta).slice(0, 5)}`}
              </dd>
            </>
          )}
          {r.dettagli && r.dettagli.length > 0 && (
            <>
              {/* Per il Fitness Manager quelle righe sono le risposte a
                  domande precise (obiettivo, livello, frequenza), non le
                  caselle "cosa ti interessa" del form generico: chiamarle
                  Interessi le farebbe leggere come preferenze vaghe. */}
              <dt>{eQuestionario ? 'Questionario' : 'Interessi'}</dt>
              <dd>
                {eQuestionario ? (
                  // Le risposte del questionario sono coppie domanda/valore:
                  // in fila su una riga sola si leggono come un elenco di
                  // interessi, e chi chiama deve rileggerle per capire quale
                  // e' l'obiettivo e quale la frequenza.
                  <ul className="dettagli-risposte">
                    {ordinaRisposte(r.dettagli).map((risposta, i) => {
                      const taglio = risposta.indexOf(':')
                      return taglio === -1 ? (
                        <li key={i}>{risposta}</li>
                      ) : (
                        <li key={i}>
                          <span className="muted">{risposta.slice(0, taglio + 1)}</span>{' '}
                          {risposta.slice(taglio + 1).trim()}
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  r.dettagli.join(', ')
                )}
              </dd>
            </>
          )}
          {r.messaggio && (
            <>
              {/* Se la persona ha prenotato, quel testo è l'oggetto che ha
                  scritto scegliendo giorno e ora: chiamarlo "Messaggio" lo
                  farebbe sembrare un commento in più, non la ragione
                  dell'incontro. */}
              <dt>
                {r.azione === 'appuntamento' || r.azione === 'telefonata' ? 'Oggetto' : 'Messaggio'}
              </dt>
              <dd>{r.messaggio}</dd>
            </>
          )}
          <dt>Marketing</dt>
          <dd>
            {r.marketing ? (
              <span className="tag tag-ok">acconsente</span>
            ) : (
              <span className="tag tag-avviso">nessun consenso</span>
            )}
          </dd>
          {/* Dove si trovava sul sito quando ha scritto, e cosa ha premuto.
              È la prima domanda di chi richiama — «mi ha scritto per il
              tennis o stava guardando gli abbonamenti?» — e finora era un
              dato che il sito mandava e il pannello buttava via. */}
          {(r.pagina || r.cta) && (
            <>
              <dt>Ha compilato</dt>
              <dd>
                {r.pagina ?? 'pagina non registrata'}
                {r.cta && ` · pulsante «${r.cta}»`}
              </dd>
            </>
          )}
          {r.audience && (
            <>
              <dt>Per chi</dt>
              <dd>{r.audience === 'junior' ? 'Young School (junior)' : r.audience}</dd>
            </>
          )}
          {(provenienza || r.referrer || r.landing_page) && (
            <>
              <dt>Provenienza</dt>
              <dd>
                {provenienza || (dominioDi(r.referrer) ? `da ${dominioDi(r.referrer)}` : 'diretto')}
                {/* Il primo contatto si dice solo se racconta un'altra
                    storia: quando coincide con l'ultimo è una ripetizione
                    che allunga la riga e non aggiunge niente. */}
                {primoContatto && primoContatto !== provenienza && (
                  <span className="muted"> · primo contatto: {primoContatto}</span>
                )}
                {r.landing_page && (
                  <span className="muted" title={r.landing_page}>
                    {' '}
                    · atterrato su {percorsoBreve(r.landing_page)}
                  </span>
                )}
              </dd>
            </>
          )}
          {eEsitoValido(r.esito_tipo) && (
            <>
              <dt>Esito</dt>
              <dd>{ETICHETTE_ESITO[r.esito_tipo]}</dd>
            </>
          )}
          {r.esito && (
            <>
              <dt>Nota di chiusura</dt>
              <dd>{r.esito}</dd>
              {/* Chi l'ha scritta. Le note chiuse prima che la firma
                  esistesse lo dicono, invece di attribuirsi a qualcuno. */}
              <dt>Scritta da</dt>
              <dd>
                {firmaEsito
                  ? `${firmaEsito}${r.esito_il ? ` — ${dataOra(r.esito_il)}` : ''}`
                  : 'Firma non registrata'}
              </dd>
            </>
          )}
          {/* «Nota precedente» solo sugli appuntamenti prenotati di Club e
              Family: là la nota che conta è quella della chiusura con
              esito, e questa è la vecchia nota libera — leggibile, non più
              scrivibile. Ovunque ci sia l'interruttore (i corsi, e i
              messaggi di Club) è *la* nota: quella che si scrive e si
              corregge dalla gestione. */}
          {r.note && (
            <>
              <dt>{conInterruttore ? 'Nota' : 'Nota precedente'}</dt>
              <dd>{r.note}</dd>
            </>
          )}
        </dl>

      {/* Le pagine viste prima di scrivere. Sta dopo la lista e non dentro
          perche' non e' una coppia etichetta/valore: e' un elenco, e in una
          griglia a due colonne si leggerebbe male. */}
      <PercorsoSito idRichiesta={r.id} paginaForm={r.pagina} apertoSubito />
    </>
  )
}

// L'ordine delle domande del questionario (il form del Fitness Manager, in
// src/pages/attivita/personal-training.astro nel repo del sito). Le risposte
// arrivano gia' in quest'ordine, ma il database non lo garantisce: qui si
// legge sempre obiettivo, poi livello, poi frequenza, e una voce che non
// riconosciamo resta in fondo invece di sparire.
const ORDINE_RISPOSTE = ['Obiettivo', 'Livello', 'Frequenza']

function ordinaRisposte(risposte: string[]): string[] {
  const posizione = (r: string) => {
    const i = ORDINE_RISPOSTE.findIndex((etichetta) => r.startsWith(`${etichetta}:`))
    return i === -1 ? ORDINE_RISPOSTE.length : i
  }
  return [...risposte].sort((a, b) => posizione(a) - posizione(b))
}
