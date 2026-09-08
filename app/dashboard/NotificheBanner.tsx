'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useNotifiche } from './NotificheProvider'
import { ConfermaLetturaButton } from './notifiche/ConfermaLetturaButton'
import { RispondiNotifica } from './notifiche/RispondiNotifica'
import { getDestinatariBatch } from './notifiche/actions'

// L'avviso di un messaggio nuovo, sopra qualunque pagina del pannello (il
// polling che lo alimenta sta in NotificheProvider).
//
// È bloccante di proposito: finché non si conferma la lettura non c'è modo di
// chiuderlo — niente x, niente clic fuori. È la ragione per cui questa sezione
// esiste al posto del gruppo WhatsApp: una comunicazione di servizio non è
// "notificata", è letta, e la conferma deve costare un clic obbligato.
export function NotificheBanner() {
  const { ultimo, segnaLettoInLocale, chiudiUltimo } = useNotifiche()
  const [confermato, setConfermato] = useState(false)
  const [destinatariAperti, setDestinatariAperti] = useState(false)
  const [destinatari, setDestinatari] = useState<string[] | null>(null)
  const [caricamento, setCaricamento] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  // Un messaggio nuovo (id diverso) riparte sempre da "non confermato" e con
  // l'elenco dei destinatari richiuso, anche se il precedente era arrivato
  // fino alla risposta.
  useEffect(() => {
    setConfermato(false)
    setDestinatariAperti(false)
    setDestinatari(null)
    setErrore(null)
  }, [ultimo?.id])

  // Blocca lo scorrimento della pagina sotto: l'avviso copre tutto, non solo
  // la parte visibile senza scroll.
  useEffect(() => {
    if (!ultimo) return
    const precedente = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = precedente
    }
  }, [ultimo])

  function alternaDestinatari() {
    const prossimo = !destinatariAperti
    setDestinatariAperti(prossimo)
    if (prossimo && !destinatari && !caricamento && ultimo?.batchId) {
      setCaricamento(true)
      setErrore(null)
      getDestinatariBatch(ultimo.batchId).then((esito) => {
        setCaricamento(false)
        if (esito.ok) setDestinatari(esito.nomi)
        else setErrore(esito.errore)
      })
    }
  }

  if (!ultimo) return null

  return (
    <div
      className="msg-overlay"
      onClick={() => {
        // Il clic fuori chiude solo dopo la conferma: prima è bloccante.
        if (confermato) chiudiUltimo(ultimo.id)
      }}
    >
      <div
        className="msg-modale"
        role="alertdialog"
        aria-modal="true"
        aria-label="Nuovo messaggio interno"
        onClick={(e) => e.stopPropagation()}
      >
        {confermato && (
          <button
            type="button"
            className="msg-modale-chiudi"
            aria-label="Chiudi"
            onClick={() => chiudiUltimo(ultimo.id)}
          >
            ×
          </button>
        )}

        <div className="msg-modale-testa">
          <p className="eyebrow">Messaggio da {ultimo.daNome}</p>
          {ultimo.numeroDestinatari > 1 && (
            <button
              type="button"
              className="msg-modale-badge"
              onClick={alternaDestinatari}
              aria-expanded={destinatariAperti}
            >
              A {ultimo.numeroDestinatari} destinatari {destinatariAperti ? '▲' : '▼'}
            </button>
          )}
        </div>

        {destinatariAperti && (
          <p className="muted msg-modale-destinatari">
            {caricamento ? 'Carico i destinatari…' : (errore ?? destinatari?.join(', '))}
          </p>
        )}

        <p className="msg-testo">{ultimo.messaggio}</p>

        {!confermato && (
          <p className="field-hint">Conferma di aver letto per continuare a lavorare.</p>
        )}

        <div className="msg-modale-azioni">
          {confermato ? (
            <>
              <RispondiNotifica
                aEmail={ultimo.daEmail}
                nomeDestinatario={ultimo.daNome}
                onInviata={() => chiudiUltimo(ultimo.id)}
              />
              <Link
                href="/dashboard/notifiche"
                className="btn btn-sm btn-ghost"
                onClick={() => chiudiUltimo(ultimo.id)}
              >
                Vai ai messaggi
              </Link>
            </>
          ) : (
            <ConfermaLetturaButton
              id={ultimo.id}
              onConfermata={() => {
                segnaLettoInLocale()
                setConfermato(true)
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
