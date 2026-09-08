'use client'

import { useState } from 'react'
import { pesoLeggibile } from '@/lib/allegati'
import { dataOraRoma, type Notifica } from '@/lib/notifiche'
import { useNotifiche } from '../NotificheProvider'
import { ConfermaLetturaButton } from './ConfermaLetturaButton'
import { RispondiNotifica } from './RispondiNotifica'

// Un messaggio nell'elenco. Chiuso mostra chi scrive (o a chi), quando e se è
// stato letto; aperto mostra il testo per intero, l'allegato e — sui ricevuti
// — la conferma di lettura o la risposta.
//
// Il testo si vede solo aperto anche quando è corto: l'elenco è una lista di
// comunicazioni di servizio, e mostrarle tutte distese renderebbe impossibile
// trovare quella che si cerca.

export function RigaMessaggio({
  messaggio,
  interlocutore,
  vista,
  urlAllegato,
  altriDestinatari,
}: {
  messaggio: Notifica
  /** Chi scrive, sui ricevuti; a chi è andato, sugli inviati. */
  interlocutore: string
  vista: 'ricevuti' | 'inviati'
  /** URL firmata di pochi minuti, generata dalla pagina. */
  urlAllegato: string | null
  /** Gli altri nomi dello stesso invio: vuoto quando il messaggio era singolo. */
  altriDestinatari: string[]
}) {
  const [aperto, setAperto] = useState(false)
  const [confermata, setConfermata] = useState(!!messaggio.letta_il)
  // Lo stesso stato che alimenta il badge nel menu: confermando da qui il
  // conteggio scende subito, invece di aspettare il prossimo giro di polling.
  const { segnaLettoInLocale } = useNotifiche()
  const peso = pesoLeggibile(messaggio.allegato_dimensione)

  return (
    <div className={`card msg-card${confermata ? '' : ' is-da-leggere'}`}>
      <div className="msg-testa">
        <button
          type="button"
          className="msg-apri"
          aria-expanded={aperto}
          onClick={() => setAperto((v) => !v)}
        >
          <span className="msg-chi">
            {vista === 'ricevuti' ? interlocutore : `A ${interlocutore}`}
          </span>
          {/* Un assaggio del testo sulla riga chiusa: senza, due messaggi
              della stessa persona nello stesso giorno sono indistinguibili. */}
          <span className="msg-anteprima">{messaggio.messaggio}</span>
        </button>

        <div className="msg-meta">
          <span className={confermata ? 'badge badge-off' : 'badge badge-warn'}>
            {confermata
              ? vista === 'ricevuti'
                ? 'Letto'
                : `Letto il ${dataOraRoma(messaggio.letta_il!)}`
              : vista === 'ricevuti'
                ? 'Da confermare'
                : 'Non ancora letto'}
          </span>
          <span className="msg-data">{dataOraRoma(messaggio.created_at)}</span>
        </div>
      </div>

      {aperto && (
        <div className="msg-corpo">
          <p className="msg-testo">{messaggio.messaggio}</p>

          {messaggio.allegato_nome && (
            <p className="msg-allegato">
              {urlAllegato ? (
                <a href={urlAllegato} target="_blank" rel="noopener noreferrer">
                  {messaggio.allegato_nome}
                </a>
              ) : (
                messaggio.allegato_nome
              )}
              {peso && <span className="muted"> · {peso}</span>}
            </p>
          )}

          {altriDestinatari.length > 0 && (
            <p className="muted">Inviato anche a: {altriDestinatari.join(', ')}</p>
          )}

          {vista === 'ricevuti' && (
            <div className="msg-azioni">
              {confermata ? (
                <RispondiNotifica
                  aEmail={messaggio.da_email}
                  nomeDestinatario={interlocutore}
                />
              ) : (
                <ConfermaLetturaButton
                  id={messaggio.id}
                  onConfermata={() => {
                    setConfermata(true)
                    segnaLettoInLocale()
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
