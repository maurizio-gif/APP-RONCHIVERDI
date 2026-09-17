'use client'

import { useState, useTransition } from 'react'
import {
  ETICHETTE_ESITO,
  dataOra,
  eAppuntamentoVero,
  eEsitoValido,
  tipoDaAzione,
  voceDaContatto,
} from '@/lib/agenda'
import { nomeDiEmail } from '@/lib/staff'
import { riapriRichiesta } from '@/app/dashboard/richieste/actions'
import { GestioneEsito } from '@/components/GestioneEsito'
import { DettagliRichiesta } from '@/components/DettagliRichiesta'
import { SchedaContatto } from '@/components/SchedaContatto'
import { ContattiRapidi } from '@/app/dashboard/ContattiRapidi'
import { GestioneSemplice } from '@/app/dashboard/richieste/GestioneSemplice'
import { Trattativa, type DatiTrattativa } from '@/app/dashboard/richieste/Trattativa'
import { EventiTrattativa, type EventoCollegato } from '@/app/dashboard/richieste/EventiTrattativa'
import type { Richiesta } from '@/app/dashboard/richieste/RigaRichiesta'

/** I diritti di chi guarda sulla pipeline, e i colleghi a cui si può girare. */
export type ContestoEvento = {
  io: string | null
  sonoCommerciale: boolean
  possoRiassegnare: boolean
  /** Chi può essere assegnatario di una trattativa. */
  commerciali: string[]
}

/**
 * Cosa si può fare a una richiesta dal sito, una volta aperta la sua riga.
 *
 * **Uno per tutto il pannello**: Eventi Core, dashboard e agenda aprono
 * questo stesso blocco, nello stesso ordine e con gli stessi comandi. Prima
 * erano tre espansioni diverse sulla stessa richiesta — in dashboard si
 * chiudeva l'evento ma non si poteva riassegnare la trattativa né vedere il
 * suo seguito; in Eventi Core c'era tutto, diviso però in tre pannelli da
 * aprire uno per uno. Chi passava da una pagina all'altra doveva imparare
 * quale gesto esisteva dove, e le differenze non erano scelte: erano il
 * risultato di averle scritte in momenti diversi.
 *
 * L'ordine è quello del lavoro: **chi è** (la scheda in anagrafica), **a che
 * punto è** (la trattativa e come chiuderla), **chi chiamare** (i recapiti),
 * **cosa ha chiesto** (i dettagli), **come si chiude questo evento** (la
 * gestione), **cosa resta da fare** (il seguito).
 */
export function GestioneEvento({
  r,
  trattativa,
  contesto,
  eventi = [],
  nomiStaff = {},
  operatori = [],
  puoCancellare = false,
  gestioneSemplice = false,
}: {
  r: Richiesta
  /** La trattativa della persona, dove le trattative esistono (Club e Family). */
  trattativa?: DatiTrattativa
  /** Assente dove non c'è una pipeline: il pannello trattativa non si disegna. */
  contesto?: ContestoEvento
  /** Gli eventi già nati da questa trattativa: il suo seguito. */
  eventi?: EventoCollegato[]
  /** Email → "Nome Cognome": a schermo si legge il nome, non l'indirizzo. */
  nomiStaff?: Record<string, string>
  /** Chi può essere assegnatario di un evento programmato. */
  operatori?: string[]
  puoCancellare?: boolean
  /**
   * Vero sui canali senza trattativa (Young School, Summer Camp, Chinesis,
   * corsi padel, Fitness Manager): là la richiesta si gestisce con un
   * interruttore e una nota, non con un esito motivato.
   */
  gestioneSemplice?: boolean
}) {
  const nome = [r.nome, r.cognome].filter(Boolean).join(' ') || '—'

  /**
   * L'appuntamento preso dal sito. `tipoDaAzione` dà un tipo d'agenda anche a
   * un messaggio; qui serve sapere se c'è uno slot da tenere.
   */
  const tipo = tipoDaAzione(r.azione)
  const tipoAppuntamento = eAppuntamentoVero(tipo) ? tipo : null

  /**
   * Se si chiude con l'**interruttore** invece che con l'esito. Vero sui
   * canali senza trattativa, e vero anche sui **messaggi** di Club e Family:
   * un messaggio non si esegue e non fallisce — o l'hai visto o no. Com'è
   * andata lo dicono gli eventi che ne seguono, come è finita lo dice la
   * trattativa. La stessa regola sta lato server (vedi conInterruttore in
   * app/dashboard/richieste/actions.ts): qui decide cosa si disegna, là cosa
   * si può salvare.
   */
  const conInterruttore = gestioneSemplice || !tipoAppuntamento

  /** Chi ha firmato la nota di chiusura, col nome per esteso. */
  const firmaEsito = nomeDiEmail(r.esito_da, nomiStaff)

  /** Chi l'ha chiusa e quando: la firma della chiusura, non della nota. */
  const chiusaDa = nomeDiEmail(r.gestito_da, nomiStaff)

  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function riapri() {
    setErrore(null)
    startTransition(async () => {
      const esito = await riapriRichiesta(r.id)
      if (!esito.ok) setErrore(esito.errore)
    })
  }

  /**
   * La cronologia della trattativa, con **la richiesta stessa in testa**: è
   * il momento in cui questa persona si è fatta viva, ed è ciò che ha aperto
   * la trattativa. Proiettata da `form_contatti` e non copiata in `task`,
   * con la stessa proiezione che usa l'agenda — così le due viste non
   * possono divergere.
   */
  const cronologia: EventoCollegato[] = [...eventi, { ...voceDaContatto(r), richiestaId: r.id }]

  return (
    <div className="evento-espanso">
      {/* ── Chiuso ──────────────────────────────────────────────────────
          Detto in testa all'espansione, non lasciato dedurre.

          Su una voce chiusa i pannelli qui sotto cambiano verbo da soli — la
          gestione dice «correggi» invece di «chiudi» — ma è una differenza
          che si nota solo sapendola già: si apriva una riga, si trovava un
          modulo compilato, e restava da capire se fosse stata chiusa o se
          qualcuno avesse solo cominciato a scriverci dentro. E riaprirla si
          poteva da un pulsante in riga che c'era in Eventi Core e non in
          dashboard.

          Il perché c'è tutto qui: l'esito, chi ha chiuso, quando, e — dove
          esiste — il comando che la rimette fra le cose da fare. */}
      {r.gestito && (
        <div className="evento-chiuso">
          <p className="evento-chiuso-testo">
            <span className="badge badge-off badge-punto">
              {conInterruttore ? 'gestita' : 'chiusa'}
            </span>{' '}
            {eEsitoValido(r.esito_tipo) && <strong>{ETICHETTE_ESITO[r.esito_tipo]}</strong>}
            {eEsitoValido(r.esito_tipo) && ' · '}
            <span className="muted">
              {chiusaDa ? `da ${chiusaDa}` : 'firma non registrata'}
              {r.gestito_il && ` il ${dataOra(r.gestito_il)}`}
            </span>
          </p>

          {/* Dove si gestisce con l'interruttore non c'è: l'interruttore qui
              sotto va già nei due sensi, e due comandi che fanno la stessa
              cosa lasciano chiedersi in cosa differiscano. */}
          {!conInterruttore && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={inCorso}
              onClick={riapri}
            >
              {inCorso ? 'Riapro…' : 'Riapri'}
            </button>
          )}
        </div>
      )}

      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)' }}>
          {errore}
        </p>
      )}

      {/* Chi è: la sua scheda in anagrafica, dove sta tutto il resto — le
          altre richieste, le altre trattative, le note di chi l'ha già
          chiamato, il percorso sul sito. In testa perché è la domanda che si
          fa **prima** di telefonare, non dopo: in coda all'espansione ci si
          arrivava scorrendo la trattativa, i recapiti, i dettagli del form,
          la gestione e la cronologia. */}
      <SchedaContatto personaId={r.persona_id} />

      {/* A che punto è, chi la segue, e la tendina per chiuderla: vinta,
          persa o annullata sono voci di quella stessa tendina degli stati
          (vedi OPZIONI_STATO in lib/pipeline.ts), non un gesto a parte — i
          pulsanti di ChiusuraTrattativa duplicavano esattamente questo. */}
      {trattativa && contesto && (
        <Trattativa
          t={trattativa}
          io={contesto.io}
          sonoCommerciale={contesto.sonoCommerciale}
          possoRiassegnare={contesto.possoRiassegnare}
          commerciali={contesto.commerciali}
          nomiStaff={nomiStaff}
        />
      )}

      {/* Chi chiamare, con il numero e l'indirizzo scritti accanto ai
          pulsanti: è il gesto che in segreteria si ripete venti volte al
          giorno, e sta sempre nello stesso posto — in cima, subito sotto lo
          stato — invece che alla fine di una lista di lunghezza variabile. */}
      <ContattiRapidi email={r.email} cellulare={r.cellulare} spiegaSeVuoto />

      <DettagliRichiesta r={r} conInterruttore={conInterruttore} nomiStaff={nomiStaff} />

      {conInterruttore ? (
        <GestioneSemplice
          id={r.id}
          gestito={r.gestito}
          nota={r.note}
          gestitoDa={nomeDiEmail(r.gestito_da, nomiStaff)}
          gestitoIl={r.gestito_il}
          notaDa={nomeDiEmail(r.note_da, nomiStaff)}
          notaIl={r.note_il}
        />
      ) : (
        !trattativa && (
          // Un appuntamento vero senza trattativa non dovrebbe esistere (solo
          // Club e Family prenotano un orario, e lì la trattativa c'è
          // sempre) — resta come rete di sicurezza, non come percorso
          // normale: quello vive dentro Eventi della trattativa qui sotto.
          <GestioneEsito
            origine="form_contatti"
            id={r.id}
            titolo={nome}
            operatori={operatori}
            puoCancellare={puoCancellare}
            conOrario={!!tipoAppuntamento}
            dataCorrente={r.data_scelta}
            oraCorrente={r.ora_scelta ? String(r.ora_scelta).slice(0, 5) : null}
            chiusa={r.gestito}
            esitoCorrente={eEsitoValido(r.esito_tipo) ? r.esito_tipo : null}
            notaCorrente={r.esito}
            firma={firmaEsito}
            firmaIl={r.esito_il}
            seguito={{ entita: 'form_contatti', id: r.id }}
          />
        )
      )}

      {/* Il seguito della trattativa: cosa è già stato fatto e cosa resta.
          La richiesta stessa è il primo elemento della cronologia (vedi
          `cronologia` sopra), col suo stesso riquadro e — se è un
          appuntamento o una telefonata davvero presi — i comandi per
          chiuderla: non un pannello a parte staccato da qui, ma la prima
          voce di questa stessa lista. Solo dove le trattative esistono —
          altrove il responsabile chiama e chiude, e non c'è niente da
          programmare. */}
      {trattativa && (
        <EventiTrattativa
          eventi={cronologia}
          richiestaId={r.id}
          titoloSuggerito={nome}
          operatori={operatori}
          puoCancellare={puoCancellare}
          nomiStaff={nomiStaff}
        />
      )}
    </div>
  )
}
