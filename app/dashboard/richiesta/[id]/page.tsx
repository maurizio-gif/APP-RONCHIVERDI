import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, getSezioniConsentite } from '@/lib/auth/sezioni-server'
import { canaleDiRichiesta } from '@/lib/richieste'

export const dynamic = 'force-dynamic'

// Un indirizzo per una richiesta sola: /dashboard/richiesta/<id>.
//
// Serve al pulsante «Accedi al CRM» delle email che il sito manda al
// responsabile dell'attività. Il sito conosce l'id della richiesta — l'ha
// appena scritta — ma non sa in quale canale finisce: quella è roba di questo
// pannello (vedi canaleDiRichiesta), e duplicarla di là avrebbe significato
// che il giorno in cui un corso cambia canale i link nelle email vecchie
// portano nel posto sbagliato, senza che nessuno se ne accorga.
//
// Qui invece la richiesta si cerca, si guarda di chi è, e si manda chi ha
// cliccato all'elenco giusto con la riga già aperta.
export default async function RichiestaPage({ params }: { params: { id: string } }) {
  const supabase = createSupabaseServiceClient()
  const { data: richiesta } = await supabase
    .from('form_contatti')
    .select('id, attivita, settore, origine')
    .eq('id', params.id)
    .maybeSingle()

  // Richiesta inesistente o cancellata: la dashboard, non un errore. Chi
  // arriva qui ha cliccato un link in un'email di mesi fa, e un 404 non gli
  // direbbe niente che possa usare.
  if (!richiesta) redirect('/dashboard')

  const canale = canaleDiRichiesta(richiesta)
  if (!canale) redirect('/dashboard')

  // Stesso permesso della pagina di destinazione: chi non ha quella sezione
  // non ci entra nemmeno passando da qui. Il redirect finale lo verificherà
  // di nuovo — questo controllo serve a non mandarcelo per niente.
  const sezioni = await getSezioniConsentite(emailCorrente())
  if (!sezioni.includes(canale.chiave)) redirect('/dashboard')

  // `mostra=tutte` perché la richiesta potrebbe essere già stata lavorata da
  // un collega nel frattempo, e con il filtro predefinito non comparirebbe:
  // chi apre il link vuole vedere *quella* richiesta, non scoprire che
  // l'elenco è vuoto.
  redirect(`/dashboard/richieste/${canale.chiave}?mostra=tutte&richiesta=${richiesta.id}`)
}
