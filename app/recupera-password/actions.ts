'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/serverClient'
import { isStaffEmail } from '@/lib/auth/allowlist'
import { registraLog } from '@/lib/audit'

function urlErrore(messaggio: string): string {
  return `/recupera-password?error=${encodeURIComponent(messaggio)}`
}

/**
 * Chiede a Supabase di mandare il link per scegliere una password nuova.
 *
 * Il link porta a /auth/callback, che apre la sessione di recupero e manda a
 * /imposta-password: la stessa strada dell'invito, perché è la stessa cosa —
 * una sessione temporanea che serve solo a scrivere una password.
 */
export async function chiediRecupero(formData: FormData) {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()

  if (!email) redirect(urlErrore('Scrivi l’email con cui entri nel pannello.'))

  // Stesso controllo dell'invito, e per la stessa ragione: senza questa
  // variabile il redirectTo diventa la stringa "undefined/auth/callback",
  // Supabase la scarta e manda l'email comunque — con un link che porta al
  // Site URL di fallback invece che al pannello. Meglio non mandare niente
  // che mandare un link rotto a chi è già in difficoltà.
  const sito = process.env.NEXT_PUBLIC_SITE_URL
  if (!sito) {
    redirect(
      urlErrore(
        'Il pannello non è configurato: manca NEXT_PUBLIC_SITE_URL, e il link nell’email non porterebbe qui. Avvisa chi gestisce il pannello.'
      )
    )
  }

  // Il controllo sta fuori dal try/catch: redirect() segnala l'uscita
  // lanciando, e un catch lo scambierebbe per un guasto.
  let autorizzata = false
  try {
    autorizzata = await isStaffEmail(email)
  } catch (e) {
    console.error('recupero password: allowlist non verificabile', e)
    await registraLog(email, 'recupero_fallito', {
      dettagli: { motivo: 'controllo allowlist non riuscito' },
    })
    redirect(urlErrore('Non riusciamo a verificare l’indirizzo. Riprova fra un minuto.'))
  }

  // L'email parte solo a chi è davvero nel pannello, ma **la risposta è la
  // stessa in ogni caso**. Dire «questo indirizzo non esiste» trasformerebbe
  // questa pagina in uno strumento per scoprire chi lavora al club: la si
  // interroga con una lista di indirizzi e si guarda quale risponde diverso.
  if (!autorizzata) {
    // Registrato lo stesso: un tentativo su un indirizzo che non è nel
    // pannello è esattamente il segnale che si vuole vedere nel registro.
    await registraLog(email, 'recupero_non_autorizzato')
    redirect('/recupera-password?inviata=1')
  }

  const supabase = createSupabaseServerClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${sito}/auth/callback`,
  })

  // Il limite di invio di Supabase è l'unico errore che vale la pena
  // distinguere: dice di aspettare, non di riprovare subito, e senza
  // spiegarlo si finisce per premere il pulsante cinque volte.
  if (error && /rate|limit|too many/i.test(error.message)) {
    await registraLog(email, 'recupero_fallito', { dettagli: { motivo: 'limite di invio' } })
    redirect(urlErrore('Hai chiesto troppi invii di fila. Aspetta qualche minuto e riprova.'))
  }

  if (error) {
    console.error('recupero password non inviato:', error.message)
  }

  await registraLog(email, error ? 'recupero_fallito' : 'recupero_richiesto', {
    dettagli: error ? { errore: error.message } : undefined,
  })

  // Anche in caso di errore si risponde «controlla la posta»: la stessa
  // ragione di sopra — un messaggio diverso direbbe che quell'indirizzo
  // esiste. L'errore vero resta nei log e nel registro operatori.
  redirect('/recupera-password?inviata=1')
}
