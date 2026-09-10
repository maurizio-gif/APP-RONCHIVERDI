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

// Gli impegni del giorno, gestibili qui.
//
// Prima erano un elenco da leggere: per chiudere una telefonata fatta si
// apriva l'agenda, si ritrovava la riga e si apriva il suo pannello — tre
// passaggi per un gesto che si ripete venti volte al giorno. Il pannello di
// chiusura è lo stesso dell'agenda e delle richieste: chi lavora non deve
// imparare tre schemi.

export function ImpegniDashboard({
  voci,
  oggi,
  io,
  operatori,
  puoCancellare,
  nomiStaff = {},
}: {
  voci: VoceAgenda[]
  /** Oggi a Roma: serve a marcare gli arretrati. */
  oggi: string
  io: string | null
  operatori: string[]
  puoCancellare: boolean
  /** Email → "Nome Cognome": nel tag si legge la persona, non il suo indirizzo. */
  nomiStaff?: Record<string, string>
}) {
  const [aperta, setAperta] = useState<string | null>(null)

  return (
    <ul className="impegni">
      {voci.map((voce) => {
        const arretrato = voce.data < oggi
        const mio = voce.assegnatoA === io
        const inGestione = aperta === voce.chiave

        // La banda a sinistra dice il peso della voce prima di leggerla: rossa
        // se è di un giorno passato, blu se è di oggi. Prima l'arretrato si
        // riconosceva solo da un badge ambra in mezzo alla riga, che in un
        // elenco di dodici voci si trova rileggendo.
        return (
          <li
            className={`impegno impegno-gestibile riga-stato ${
              arretrato ? 'is-arretrato' : 'is-oggi'
            }`}
            key={voce.chiave}
          >
            <div className="impegno-riga">
              <span className={`badge-tipo ${CLASSE_TIPO[voce.tipo]}`}>
                {ETICHETTE_TIPO_BREVI[voce.tipo]}
              </span>

              <span className="impegno-titolo">{voce.titolo}</span>

              <span className="muted impegno-quando">
                {dataBreve(voce.data)}
                {' · '}
                {intervalloOrario(voce.ora, voce.durataMinuti) ?? 'in giornata'}
              </span>

              {arretrato && (
                <span className="badge badge-ko badge-punto badge-stato">arretrato</span>
              )}

              {/* Di chi è. Questo elenco mostra gli impegni di **tutto il
                  club**, non solo i propri: senza dire di chi è ogni riga, si
                  legge come una lista di cose proprie — e o ci si presenta in
                  due alla stessa telefonata, o si dà per scontato che ci pensi
                  qualcun altro.

                  Un tag e non più testo grigio, e su **ogni** riga e non solo
                  su quelle altrui: prima il proprietario compariva soltanto
                  quando non eri tu, quindi l'assenza del nome era essa stessa
                  l'informazione — la si capiva solo sapendola già. E il nome
                  per esteso al posto dell'email: «c.porcella@ronchiverdi.it»
                  si legge lettera per lettera, «Carola Porcella» si riconosce
                  in un colpo d'occhio. */}
              <span
                className={`tag-assegnato${
                  mio ? ' e-mio' : voce.assegnatoA ? ' e-altrui' : ' e-nessuno'
                }`}
              >
                {mio
                  ? 'Tuo'
                  : voce.assegnatoA
                    ? nomeDiEmail(voce.assegnatoA, nomiStaff)
                    : voce.origine === 'form_contatti'
                      ? 'Dal sito'
                      : 'Di nessuno'}
              </span>

              <button
                type="button"
                className={`btn btn-sm${inGestione ? '' : ' btn-ghost'}`}
                aria-expanded={inGestione}
                onClick={() => setAperta(inGestione ? null : voce.chiave)}
              >
                Gestisci
              </button>
            </div>

            {(voce.persona || voce.note) && (
              <div className="impegno-dettagli muted">
                {voce.persona && <span>{voce.persona}</span>}
                {voce.persona && voce.note && ' · '}
                {voce.note && <span className="impegno-nota">{voce.note}</span>}
              </div>
            )}

            {inGestione && (
              <div className="impegno-gestione">
                <GestioneEsito
                  origine={voce.origine}
                  id={voce.id}
                  titolo={voce.titolo}
                  operatori={operatori}
                  puoCancellare={puoCancellare}
                  conOrario={eAppuntamentoVero(voce.tipo)}
                  dataCorrente={voce.data}
                  oraCorrente={voce.ora}
                />
                {/* La scheda della persona, per chi deve sapere qualcosa in
                    più prima di chiamare: da qui non si vede la storia. */}
                {voce.personaId && (
                  <Link className="btn btn-ghost btn-sm" href={`/dashboard/persone/${voce.personaId}`}>
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
