// Service worker minimo, solo per le notifiche push: nessuna cache offline —
// non è l'obiettivo di questo pannello, i dati sono sempre live da Supabase e
// una copia in cache mostrerebbe richieste e appuntamenti vecchi.

self.addEventListener('push', (event) => {
  let dati = {}
  try {
    dati = event.data ? event.data.json() : {}
  } catch {
    dati = {}
  }

  const titolo = dati.titolo || 'CRM Ronchiverdi'
  const opzioni = {
    body: dati.corpo || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: dati.url || '/dashboard/notifiche' },
  }

  event.waitUntil(self.registration.showNotification(titolo, opzioni))
})

// Un tocco sulla notifica riusa una scheda del pannello già aperta, se c'è,
// invece di aprirne sempre una nuova: chi lavora col pannello davanti se ne
// ritroverebbe cinque a fine giornata.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/dashboard/notifiche'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((finestre) => {
      for (const finestra of finestre) {
        if (finestra.url.includes('/dashboard') && 'focus' in finestra) {
          if (typeof finestra.navigate === 'function') finestra.navigate(url)
          return finestra.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
