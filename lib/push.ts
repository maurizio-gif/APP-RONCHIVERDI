import webpush from 'web-push'

// Server-only: usa VAPID_PRIVATE_KEY, che non deve mai finire nel bundle del
// browser. Importare solo da Server Action o Route Handler.

let configurato = false

// Le chiavi si leggono alla prima spedizione e non all'import: senza le
// variabili d'ambiente il modulo deve poter essere caricato comunque — le
// push sono un extra, e il pannello funziona (badge, avviso, elenco) anche
// se non sono configurate.
function assicuraConfigurazione(): boolean {
  if (configurato) return true

  const pubblica = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privata = process.env.VAPID_PRIVATE_KEY
  if (!pubblica || !privata) return false

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:digital@ronchiverdi.it',
    pubblica,
    privata
  )
  configurato = true
  return true
}

export type SottoscrizionePush = { endpoint: string; p256dh: string; auth: string }

export type PayloadPush = { titolo: string; corpo: string; url: string }

/**
 * `scaduta` a true (404 o 410 dal servizio push del browser) significa che
 * quel dispositivo ha disinstallato o revocato le notifiche altrove: la riga
 * in push_subscriptions va cancellata, riprovare non ha senso.
 */
export type EsitoPush = { ok: true } | { ok: false; scaduta: boolean; errore: string }

export async function inviaPush(
  sottoscrizione: SottoscrizionePush,
  payload: PayloadPush
): Promise<EsitoPush> {
  if (!assicuraConfigurazione()) {
    return { ok: false, scaduta: false, errore: 'Notifiche push non configurate sul server.' }
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: sottoscrizione.endpoint,
        keys: { p256dh: sottoscrizione.p256dh, auth: sottoscrizione.auth },
      },
      JSON.stringify(payload)
    )
    return { ok: true }
  } catch (e: unknown) {
    const codice = (e as { statusCode?: number })?.statusCode
    return {
      ok: false,
      scaduta: codice === 404 || codice === 410,
      errore: (e as Error)?.message ?? 'Invio della notifica push non riuscito.',
    }
  }
}
