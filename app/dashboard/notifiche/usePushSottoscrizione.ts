'use client'

import { useEffect, useState } from 'react'
import { rimuoviSottoscrizionePush, salvaSottoscrizionePush } from './push-actions'

// Il servizio push accetta la chiave VAPID solo come Uint8Array, non come
// stringa: stessa codifica base64url con cui web-push la genera.
function chiaveComeBytes(base64Url: string): Uint8Array {
  const riempimento = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + riempimento).replace(/-/g, '+').replace(/_/g, '/')
  const grezzo = atob(base64)
  return Uint8Array.from([...grezzo].map((c) => c.charCodeAt(0)))
}

export type StatoPush = 'verifica' | 'non-supportato' | 'attivo' | 'inattivo'

// Estratto dal componente perché la logica di accensione e spegnimento non
// dipende da dove sta il pulsante: oggi è nel menu laterale, sempre visibile.
export function usePushSottoscrizione() {
  const [stato, setStato] = useState<StatoPush>('verifica')
  const [inCorso, setInCorso] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  useEffect(() => {
    // Su iOS le push arrivano solo dall'app salvata sulla Home: da Safari
    // normale PushManager non esiste, e il pulsante lo dice invece di
    // fallire al primo clic.
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setStato('non-supportato')
      return
    }

    navigator.serviceWorker.getRegistration().then(async (registrazione) => {
      const sottoscrizione = await registrazione?.pushManager.getSubscription()
      setStato(sottoscrizione ? 'attivo' : 'inattivo')
    })
  }, [])

  async function attiva() {
    setErrore(null)
    setInCorso(true)
    try {
      const permesso = await Notification.requestPermission()
      if (permesso !== 'granted') {
        setErrore('Permesso negato: consenti le notifiche per questo sito dalle impostazioni del browser.')
        return
      }

      const chiavePubblica = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!chiavePubblica) {
        setErrore('Notifiche push non configurate sul server.')
        return
      }

      const registrazione = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      const sottoscrizione = await registrazione.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chiaveComeBytes(chiavePubblica) as BufferSource,
      })

      const json = sottoscrizione.toJSON()
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        setErrore('Sottoscrizione non valida: riprova.')
        return
      }

      const esito = await salvaSottoscrizionePush({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      })

      if (!esito.ok) {
        setErrore(esito.errore)
        return
      }

      setStato('attivo')
    } catch {
      setErrore('Non è stato possibile attivare le notifiche su questo dispositivo.')
    } finally {
      setInCorso(false)
    }
  }

  async function disattiva() {
    setErrore(null)
    setInCorso(true)
    try {
      const registrazione = await navigator.serviceWorker.getRegistration()
      const sottoscrizione = await registrazione?.pushManager.getSubscription()

      if (sottoscrizione) {
        // Prima la riga nel database, poi il browser: se si annullasse solo
        // lato browser resterebbe una sottoscrizione morta a cui il server
        // continuerebbe a spedire.
        await rimuoviSottoscrizionePush(sottoscrizione.endpoint)
        await sottoscrizione.unsubscribe()
      }

      setStato('inattivo')
    } catch {
      setErrore('Non è stato possibile disattivare le notifiche su questo dispositivo.')
    } finally {
      setInCorso(false)
    }
  }

  return { stato, inCorso, errore, attiva, disattiva }
}
