import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { VistaTabs } from '@/components/VistaTabs'
import { BUCKET_ALLEGATI } from '@/lib/allegati'
import {
  COLONNE,
  SEZIONE_NOTIFICHE,
  confrontaOperatori,
  nomeOperatore,
  type Notifica,
} from '@/lib/notifiche'
import { ComponiNotifica } from './ComponiNotifica'
import { RigaMessaggio } from './RigaMessaggio'

export const dynamic = 'force-dynamic'

// I messaggi interni fra operatori: si scrive da qui, si conferma la lettura
// da qui (o dall'avviso che compare su qualunque pagina), e da qui si vede se
// e quando un messaggio inviato è stato letto.
//
// La tabella la crea scripts/sql/2026-09-08-notifiche.sql.

/** Vita breve: il tempo di aprire la pagina e cliccare l'allegato. La pagina
 *  è force-dynamic, quindi le URL si rigenerano a ogni caricamento. */
const DURATA_URL_ALLEGATO_SECONDI = 300

const LIMITE = 200

export default async function NotifichePage({
  searchParams,
}: {
  searchParams: { vista?: string }
}) {
  if (!(await utenteHaSezione(SEZIONE_NOTIFICHE))) {
    redirect('/dashboard')
  }

  const email = emailCorrente()!
  const vista = searchParams.vista === 'inviati' ? 'inviati' : 'ricevuti'
  const supabase = createSupabaseServiceClient()

  const [{ data: staff }, { data: righeRicevute }, { data: righeInviate }] = await Promise.all([
    supabase.from('staff_users').select('email, nome, cognome, sezioni_consentite'),
    supabase
      .from('notifiche')
      .select(COLONNE)
      .eq('a_email', email)
      .order('created_at', { ascending: false })
      .limit(LIMITE),
    supabase
      .from('notifiche')
      .select(COLONNE)
      .eq('da_email', email)
      .order('created_at', { ascending: false })
      .limit(LIMITE),
  ])

  const ricevuti = (righeRicevute ?? []) as unknown as Notifica[]
  const inviati = (righeInviate ?? []) as unknown as Notifica[]

  const mappaStaff = new Map((staff ?? []).map((s) => [s.email, s]))
  const nome = (indirizzo: string) => nomeOperatore(mappaStaff.get(indirizzo), indirizzo)

  // Solo chi ha anche questo permesso può essere scelto come destinatario:
  // scrivere a chi non vede la sezione non servirebbe a niente, non lo
  // leggerebbe mai. Sempre in ordine di cognome, come ogni altro elenco di
  // operatori del pannello.
  const destinatari = (staff ?? [])
    .filter((s) => s.email !== email && (s.sezioni_consentite ?? []).includes(SEZIONE_NOTIFICHE))
    .sort(confrontaOperatori)
    .map((s) => ({ email: s.email, nome: nomeOperatore(s, s.email) }))

  // Chi altro ha ricevuto lo stesso invio: si legge solo per i messaggi che
  // hanno un batch_id, cioè quelli mandati a più persone.
  const batchIds = [
    ...new Set(
      [...ricevuti, ...inviati].map((n) => n.batch_id).filter((b): b is string => Boolean(b))
    ),
  ]

  const perBatch = new Map<string, string[]>()
  if (batchIds.length > 0) {
    const { data: righeBatch } = await supabase
      .from('notifiche')
      .select('batch_id, a_email')
      .in('batch_id', batchIds)

    for (const r of righeBatch ?? []) {
      if (!r.batch_id) continue
      const elenco = perBatch.get(r.batch_id) ?? []
      elenco.push(r.a_email)
      perBatch.set(r.batch_id, elenco)
    }
  }

  function altriDestinatari(n: Notifica): string[] {
    if (!n.batch_id) return []
    return (perBatch.get(n.batch_id) ?? [])
      // Sui ricevuti si toglie sé stessi (lo sa già); sugli inviati si toglie
      // il destinatario di questa riga, che è già nell'intestazione.
      .filter((indirizzo) => indirizzo !== (vista === 'ricevuti' ? email : n.a_email))
      .map(nome)
      .sort((a, b) => a.localeCompare(b, 'it'))
  }

  // Le URL firmate si generano in un colpo solo per tutti gli allegati della
  // vista: una chiamata per riga sarebbe una raffica verso lo Storage a ogni
  // caricamento della pagina.
  const inVista = vista === 'inviati' ? inviati : ricevuti
  const percorsi = inVista.map((n) => n.allegato_path).filter((p): p is string => Boolean(p))

  const urlAllegati = new Map<string, string>()
  if (percorsi.length > 0) {
    const { data: firmate } = await supabase.storage
      .from(BUCKET_ALLEGATI)
      .createSignedUrls(percorsi, DURATA_URL_ALLEGATO_SECONDI)

    for (const f of firmate ?? []) {
      if (f.signedUrl && f.path) urlAllegati.set(f.path, f.signedUrl)
    }
  }

  const daConfermare = ricevuti.filter((n) => !n.letta_il).length
  const nonLettiDeiMiei = inviati.filter((n) => !n.letta_il).length

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Amministrazione</p>
        <h1>Messaggi interni</h1>
        <p className="muted">
          Comunicazioni di servizio fra operatori del pannello. Chi riceve un messaggio lo trova in
          evidenza su qualunque pagina apra e deve confermare di averlo letto: la conferma resta con
          data e ora, così «gliel&apos;ho detto» diventa un fatto verificabile.
        </p>
      </div>

      <div className="griglia-stat">
        <div className="stat">
          <span className="stat-valore">{daConfermare}</span>
          <span className="stat-label">Da confermare</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{ricevuti.length}</span>
          <span className="stat-label">Ricevuti</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{nonLettiDeiMiei}</span>
          <span className="stat-label">Miei, non ancora letti</span>
        </div>
      </div>

      <ComponiNotifica destinatari={destinatari} />

      <VistaTabs
        vista={vista}
        base="/dashboard/notifiche"
        tabs={[
          { chiave: 'ricevuti', etichetta: 'Ricevuti', contatore: daConfermare },
          { chiave: 'inviati', etichetta: 'Inviati' },
        ]}
      />

      {inVista.length === 0 ? (
        <div className="card">
          <p className="vuoto">
            {vista === 'inviati'
              ? 'Nessun messaggio inviato.'
              : 'Nessun messaggio ricevuto.'}
          </p>
        </div>
      ) : (
        <div className="msg-elenco">
          {inVista.map((n) => (
            <RigaMessaggio
              key={n.id}
              messaggio={n}
              vista={vista}
              interlocutore={nome(vista === 'ricevuti' ? n.da_email : n.a_email)}
              urlAllegato={n.allegato_path ? (urlAllegati.get(n.allegato_path) ?? null) : null}
              altriDestinatari={altriDestinatari(n)}
            />
          ))}
        </div>
      )}
    </>
  )
}
